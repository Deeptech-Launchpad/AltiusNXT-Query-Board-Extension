-- ============================================================================
-- One-time migration: renumber all custom_query_id values cleanly.
--
-- For every (project prefix, year-month) bucket, assign sequential numbers
-- 001, 002, 003... ordered by id ASC (insertion order). Wipes duplicates and
-- gaps. Also fills in rows where custom_query_id is NULL.
--
-- Then seeds query_counters so the next INSERT via /api/post_query continues
-- from the correct number.
--
-- HOW TO RUN ON THE SERVER:
--   1. cd /root/Altius_Query_Board
--   2. PGPASSWORD='<your DB password>' psql -h 127.0.0.1 -U postgres_user -d Rag_system_db -f migrate_query_ids.sql
--   3. Read the NOTICEs that print — they show the row-count summary.
--
-- SAFE TO RE-RUN — idempotent. Backup table is created with a timestamp suffix
-- so each run keeps its own snapshot.
-- ============================================================================

BEGIN;

-- Step 1: Snapshot the current table so we can roll back if anything looks off.
-- Backup name includes a timestamp to keep multiple runs separate.
DO $$
DECLARE
    backup_name TEXT := 'query_logs_backup_' || to_char(now(), 'YYYYMMDD_HH24MISS');
BEGIN
    EXECUTE format('CREATE TABLE %I AS SELECT * FROM query_logs', backup_name);
    RAISE NOTICE 'Backup created: %', backup_name;
END $$;

-- Step 2: Make sure the counters table exists (matches what server.py creates on startup).
CREATE TABLE IF NOT EXISTS query_counters (
    prefix VARCHAR(10) NOT NULL,
    year_month VARCHAR(6) NOT NULL,
    counter INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (prefix, year_month)
);

-- Step 3: Renumber every row. For each (prefix, year_month), order by id ASC and
-- assign sequential 001, 002, 003... values. Replaces old format MKM_012026001
-- (single underscore) with new format MKM_012026_001 (double underscore separator).
WITH numbered AS (
    SELECT
        id,
        -- Strip non-alpha chars, take first 3, uppercase, fall back to UNK
        COALESCE(
            NULLIF(UPPER(LEFT(REGEXP_REPLACE(COALESCE(project_name, ''), '[^A-Za-z]', '', 'g'), 3)), ''),
            'UNK'
        ) AS prefix,
        TO_CHAR(COALESCE(created_at, NOW()), 'MMYYYY') AS year_month,
        ROW_NUMBER() OVER (
            PARTITION BY
                COALESCE(
                    NULLIF(UPPER(LEFT(REGEXP_REPLACE(COALESCE(project_name, ''), '[^A-Za-z]', '', 'g'), 3)), ''),
                    'UNK'
                ),
                TO_CHAR(COALESCE(created_at, NOW()), 'MMYYYY')
            ORDER BY id ASC
        ) AS seq
    FROM query_logs
)
UPDATE query_logs q
SET custom_query_id = numbered.prefix || '_' || numbered.year_month || '_' || LPAD(numbered.seq::text, 3, '0')
FROM numbered
WHERE q.id = numbered.id;

-- Step 4: Seed query_counters with the new max counter per (prefix, year_month).
-- This way the next /api/post_query knows where to continue from.
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

-- Step 5: Report what happened so the user can sanity-check.
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
    RAISE NOTICE 'Migration complete.';
    RAISE NOTICE 'Total rows in query_logs:      %', total_rows;
    RAISE NOTICE 'Rows still NULL after migrate: % (expect 0)', null_rows;
    RAISE NOTICE 'Distinct duplicate IDs left:   % (expect 0)', duplicate_rows;
    RAISE NOTICE '------------------------------------------------------------';
END $$;

COMMIT;
