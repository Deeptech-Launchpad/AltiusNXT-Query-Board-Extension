-- ============================================================================
-- v2 migration: procedural renumber — fixes residual duplicates from v1.
--
-- v1 used a CTE + ROW_NUMBER UPDATE FROM. PostgreSQL appears to have given
-- duplicate sequence values within a single (prefix, year_month) bucket on
-- the Grainger rows (verified: GRA_012026_100..119 each had 11 copies). The
-- root cause was likely the PARTITION BY recomputing function expressions
-- inconsistently with the SELECT column expressions.
--
-- v2 walks every row in a strict ORDER BY (prefix, year_month, id) and keeps
-- explicit counters in PL/pgSQL — no window functions involved. Deterministic
-- and provably correct.
--
-- HOW TO RUN:
--   cd /root/Altius_Query_Board
--   PGPASSWORD='AltiusNXT' psql -h 127.0.0.1 -U postgres_user -d Rag_system_db -f migrate_query_ids_v2.sql
--
-- Creates a fresh backup (timestamped) before doing anything. Re-runnable.
-- ============================================================================

BEGIN;

-- Step 1: Fresh backup (timestamped).
DO $$
DECLARE
    backup_name TEXT := 'query_logs_backup_v2_' || to_char(now(), 'YYYYMMDD_HH24MISS');
BEGIN
    EXECUTE format('CREATE TABLE %I AS SELECT * FROM query_logs', backup_name);
    RAISE NOTICE 'v2 backup created: %', backup_name;
END $$;

-- Step 2: Procedurally renumber every row. Walk in (prefix, year_month, id)
-- order so rows in the same bucket are contiguous, then assign 1..N inside
-- each bucket as we encounter them.
DO $$
DECLARE
    rec RECORD;
    cur_prefix TEXT;
    cur_ym TEXT;
    last_prefix TEXT := NULL;
    last_ym TEXT := NULL;
    counter INTEGER := 0;
    updated_rows INTEGER := 0;
BEGIN
    FOR rec IN
        SELECT
            id,
            COALESCE(
                NULLIF(UPPER(LEFT(REGEXP_REPLACE(COALESCE(project_name, ''), '[^A-Za-z]', '', 'g'), 3)), ''),
                'UNK'
            ) AS prefix,
            TO_CHAR(COALESCE(created_at, NOW()), 'MMYYYY') AS year_month
        FROM query_logs
        -- Order so each bucket is contiguous: prefix first, year_month second,
        -- then id for stable ordering within a bucket.
        ORDER BY 2, 3, 1
    LOOP
        -- Reset counter on bucket change
        IF rec.prefix IS DISTINCT FROM last_prefix OR rec.year_month IS DISTINCT FROM last_ym THEN
            counter := 1;
            last_prefix := rec.prefix;
            last_ym := rec.year_month;
        ELSE
            counter := counter + 1;
        END IF;

        UPDATE query_logs
        SET custom_query_id = rec.prefix || '_' || rec.year_month || '_' || LPAD(counter::text, 3, '0')
        WHERE id = rec.id;

        updated_rows := updated_rows + 1;
    END LOOP;
    RAISE NOTICE 'v2 procedural renumber: % rows updated', updated_rows;
END $$;

-- Step 3: Re-seed counters from the corrected data.
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
GROUP BY 1, 2
ON CONFLICT (prefix, year_month) DO UPDATE
    SET counter = EXCLUDED.counter;

-- Step 4: Verify and FAIL the transaction if duplicates remain.
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
    RAISE NOTICE 'v2 Migration verification:';
    RAISE NOTICE 'Total rows in query_logs:      %', total_rows;
    RAISE NOTICE 'Rows still NULL after migrate: % (expect 0)', null_rows;
    RAISE NOTICE 'Distinct duplicate IDs left:   % (expect 0)', duplicate_rows;
    RAISE NOTICE '------------------------------------------------------------';

    IF duplicate_rows > 0 THEN
        RAISE EXCEPTION 'v2 migration FAILED: % duplicate IDs remain. Rolling back.', duplicate_rows;
    END IF;

    IF null_rows > 0 THEN
        RAISE EXCEPTION 'v2 migration FAILED: % NULL IDs remain. Rolling back.', null_rows;
    END IF;
END $$;

COMMIT;
