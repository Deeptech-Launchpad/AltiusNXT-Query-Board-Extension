-- ============================================================================
-- v3 migration: id-based custom_query_id. Guaranteed unique by construction.
--
-- v1 (CTE + ROW_NUMBER) and v2 (procedural counter) both left 40 duplicate
-- groups of 11 rows each in the (GRA, 012026) bucket. The Grainger rows in
-- that bucket all share an identical microsecond-precision created_at (they
-- were bulk-imported in one transaction). Whatever PostgreSQL did under the
-- hood — likely parallel scan splitting the partition — neither approach
-- produced unique sequence values.
--
-- v3 sidesteps the sequencing problem entirely by using the row's PRIMARY KEY
-- id as the last segment. id is unique by definition, so the final string is
-- unique by construction. Format:
--
--     PREFIX_MMYYYY_NNNNNN     e.g. GRA_012026_000264 / GRA_012026_001164
--
-- Single UPDATE statement, no window functions, no PL/pgSQL loop, no cursor,
-- no counter table dependency for the renumber. Re-runnable; idempotent.
--
-- HOW TO RUN:
--   cd /root/Altius_Query_Board
--   PGPASSWORD='AltiusNXT' psql -h 127.0.0.1 -U postgres_user -d Rag_system_db -f migrate_query_ids_v3.sql
-- ============================================================================

BEGIN;

-- Step 1: Fresh backup.
DO $$
DECLARE backup_name TEXT := 'query_logs_backup_v3_' || to_char(now(), 'YYYYMMDD_HH24MISS');
BEGIN
    EXECUTE format('CREATE TABLE %I AS SELECT * FROM query_logs', backup_name);
    RAISE NOTICE 'v3 backup created: %', backup_name;
END $$;

-- Step 2: One big UPDATE. id is the PK so each row gets a distinct final
-- string regardless of project/month bucket.
UPDATE query_logs
SET custom_query_id =
    COALESCE(
        NULLIF(UPPER(LEFT(REGEXP_REPLACE(COALESCE(project_name, ''), '[^A-Za-z]', '', 'g'), 3)), ''),
        'UNK'
    )
    || '_'
    || TO_CHAR(COALESCE(created_at, NOW()), 'MMYYYY')
    || '_'
    || LPAD(id::text, 6, '0');

-- Step 3: Re-seed counters from the corrected data. (Kept around because the
-- server.py code references the table; we just won't depend on it for
-- uniqueness anymore.)
TRUNCATE query_counters;
INSERT INTO query_counters (prefix, year_month, counter)
SELECT
    COALESCE(
        NULLIF(UPPER(LEFT(REGEXP_REPLACE(COALESCE(project_name, ''), '[^A-Za-z]', '', 'g'), 3)), ''),
        'UNK'
    ) AS prefix,
    TO_CHAR(COALESCE(created_at, NOW()), 'MMYYYY') AS year_month,
    COUNT(*) AS counter
FROM query_logs
GROUP BY 1, 2;

-- Step 4: Verify with hard fail.
DO $$
DECLARE
    total_rows INTEGER;
    null_rows INTEGER;
    duplicate_rows INTEGER;
BEGIN
    SELECT COUNT(*) INTO total_rows FROM query_logs;
    SELECT COUNT(*) INTO null_rows FROM query_logs WHERE custom_query_id IS NULL;
    SELECT COUNT(*) INTO duplicate_rows
        FROM (
            SELECT custom_query_id FROM query_logs
            WHERE custom_query_id IS NOT NULL
            GROUP BY custom_query_id HAVING COUNT(*) > 1
        ) d;
    RAISE NOTICE '------------------------------------------------------------';
    RAISE NOTICE 'v3 verification:';
    RAISE NOTICE 'Total rows in query_logs:      %', total_rows;
    RAISE NOTICE 'Rows still NULL after migrate: % (expect 0)', null_rows;
    RAISE NOTICE 'Distinct duplicate IDs left:   % (expect 0)', duplicate_rows;
    RAISE NOTICE '------------------------------------------------------------';

    IF duplicate_rows > 0 THEN
        RAISE EXCEPTION 'v3 FAILED: % duplicates remain. Rolling back.', duplicate_rows;
    END IF;
    IF null_rows > 0 THEN
        RAISE EXCEPTION 'v3 FAILED: % NULL ids remain. Rolling back.', null_rows;
    END IF;
END $$;

COMMIT;
