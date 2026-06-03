"""
v5 migration: per-PROJECT sequential counter (continues across months).

Format: PREFIX_MMYYYY_NNN
- PREFIX = first 3 letters of project name (uppercase)
- MMYYYY = month and year of created_at (label only — does NOT reset the counter)
- NNN = per-project sequential counter. Starts at 001 for the project's first
        query and increments forever, never resets per month.

Example:
    1st MKM query (Jan 2026):  MKM_012026_001
    2nd MKM query (Jan 2026):  MKM_012026_002
   10th MKM query (Jan 2026):  MKM_012026_010
   11th MKM query (Feb 2026):  MKM_022026_011  ← continues from Jan's 010
   12th MKM query (Mar 2026):  MKM_032026_012  ← keeps continuing

This replaces v4 (which restarted the counter each month inside a project).

Run:
    cd /root/Altius_Query_Board
    source venv/bin/activate
    python migrate_query_ids_v5.py

The query_counters table is dropped and recreated with the new schema
(prefix as the only primary key). server.py uses the new schema too, so
restart gunicorn AFTER this script finishes.
"""

import os
import re
import sys
from datetime import datetime

import psycopg2
from dotenv import load_dotenv

load_dotenv()


def get_connection():
    return psycopg2.connect(
        host=os.getenv("DB_HOST"),
        port=os.getenv("DB_PORT"),
        dbname=os.getenv("DB_NAME"),
        user=os.getenv("DB_USER"),
        password=os.getenv("DB_PASSWORD"),
    )


def compute_prefix(project_name):
    clean = re.sub(r"[^A-Za-z]", "", project_name or "")
    return (clean[:3] or "UNK").upper()


def compute_year_month(created_at):
    if created_at is None:
        created_at = datetime.now()
    return created_at.strftime("%m%Y")


def main():
    conn = get_connection()
    conn.autocommit = False
    cur = conn.cursor()

    try:
        # 1. Backup
        backup_name = "query_logs_backup_v5_" + datetime.now().strftime("%Y%m%d_%H%M%S")
        cur.execute(f'CREATE TABLE "{backup_name}" AS SELECT * FROM query_logs')
        print(f"[v5] Backup created: {backup_name}")

        # 2. Read all rows, ordered by id (insertion order).
        cur.execute(
            "SELECT id, project_name, created_at FROM query_logs ORDER BY id ASC"
        )
        rows = cur.fetchall()
        print(f"[v5] Fetched {len(rows)} rows.")

        # 3. Build the plan: sort by (prefix, id) so each project's rows are
        #    contiguous in insertion order. Counter is per project only —
        #    the year_month in the final ID is just from each row's own created_at.
        annotated = []
        for row_id, project_name, created_at in rows:
            prefix = compute_prefix(project_name)
            ym = compute_year_month(created_at)
            annotated.append((prefix, ym, row_id))
        annotated.sort(key=lambda t: (t[0], t[2]))

        new_ids = {}
        project_counters = {}
        for prefix, ym, row_id in annotated:
            count = project_counters.get(prefix, 0) + 1
            project_counters[prefix] = count
            seq_str = f"{count:03d}"
            new_ids[row_id] = f"{prefix}_{ym}_{seq_str}"

        # 4. Sanity check the in-memory plan.
        if len(set(new_ids.values())) != len(new_ids):
            raise RuntimeError(
                "[v5] Plan failed sanity check: duplicate new IDs computed. Aborting."
            )
        print(
            f"[v5] Plan verified: {len(new_ids)} unique IDs across "
            f"{len(project_counters)} projects."
        )

        # 5. Replace query_counters with the new schema (prefix as the only PK).
        cur.execute("DROP TABLE IF EXISTS query_counters CASCADE")
        cur.execute(
            """
            CREATE TABLE query_counters (
                prefix VARCHAR(10) PRIMARY KEY,
                counter INTEGER NOT NULL DEFAULT 0
            )
            """
        )
        print("[v5] Recreated query_counters with prefix-only schema.")

        # 6. Apply the UPDATE via temp table + JOIN — fast and bounded.
        cur.execute(
            "CREATE TEMP TABLE tmp_new_ids "
            "(id INTEGER PRIMARY KEY, new_id TEXT NOT NULL)"
        )
        _execute_values(
            cur,
            "INSERT INTO tmp_new_ids (id, new_id) VALUES %s",
            new_ids.items(),
        )
        cur.execute(
            "UPDATE query_logs q SET custom_query_id = t.new_id "
            "FROM tmp_new_ids t WHERE q.id = t.id"
        )
        affected = cur.rowcount
        print(f"[v5] UPDATE affected {affected} rows.")

        # 7. Seed the per-project counters from our in-memory dict.
        cur.executemany(
            "INSERT INTO query_counters (prefix, counter) VALUES (%s, %s)",
            list(project_counters.items()),
        )
        print(f"[v5] Seeded query_counters with {len(project_counters)} project rows.")

        # 8. Post-write verification.
        cur.execute("SELECT COUNT(*) FROM query_logs")
        total = cur.fetchone()[0]
        cur.execute("SELECT COUNT(*) FROM query_logs WHERE custom_query_id IS NULL")
        nulls = cur.fetchone()[0]
        cur.execute(
            "SELECT COUNT(*) FROM ("
            "  SELECT custom_query_id FROM query_logs "
            "  WHERE custom_query_id IS NOT NULL "
            "  GROUP BY custom_query_id HAVING COUNT(*) > 1"
            ") d"
        )
        dups = cur.fetchone()[0]

        print("-" * 60)
        print("[v5] verification:")
        print(f"  Total rows in query_logs:      {total}")
        print(f"  Rows still NULL after migrate: {nulls} (expect 0)")
        print(f"  Distinct duplicate IDs left:   {dups} (expect 0)")
        print("-" * 60)

        if nulls > 0 or dups > 0:
            raise RuntimeError("[v5] Verification failed. Rolling back.")

        conn.commit()
        print(f"[v5] COMMITTED. Backup kept as table: {backup_name}")
        print("[v5] NEXT: restart queryboard.service so server.py picks up the new schema.")

    except Exception as exc:
        conn.rollback()
        print(f"[v5] ABORTED — rolled back. Reason: {exc}", file=sys.stderr)
        raise
    finally:
        cur.close()
        conn.close()


def _execute_values(cur, sql_template, items):
    """psycopg2.extras.execute_values when available; fallback to executemany."""
    try:
        from psycopg2.extras import execute_values
        execute_values(cur, sql_template, list(items))
    except ImportError:
        prefix_sql = sql_template.split("VALUES")[0] + "VALUES (%s, %s)"
        cur.executemany(prefix_sql, list(items))


if __name__ == "__main__":
    main()
