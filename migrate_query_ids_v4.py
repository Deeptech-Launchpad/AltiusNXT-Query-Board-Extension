"""
v4 migration: assign custom_query_id sequentially per (project_prefix, year_month).

Format: PREFIX_MMYYYY_NNN — NNN is the row's position in its bucket, starting
at 001, zero-padded to at least 3 digits. If a bucket ever exceeds 999 the
number simply grows (e.g. 1000) without truncation.

Why Python and not SQL: the v1 (CTE ROW_NUMBER) and v2 (PL/pgSQL counter)
attempts both produced 40 duplicate IDs in the (GRA, 012026) bucket. The
root cause was never confirmed but appeared to involve PostgreSQL internals
on bulk-imported rows sharing identical microsecond timestamps. Python iterates
one row at a time with full control — no parallel execution, no MVCC quirks.

Run:
    cd /root/Altius_Query_Board
    source venv/bin/activate
    python migrate_query_ids_v4.py

Reads DB credentials from the same .env the server uses.
"""

import os
import re
import sys
from datetime import datetime, date

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
    # created_at may be a datetime or date; fall back to "now" if NULL.
    if created_at is None:
        created_at = datetime.now()
    return created_at.strftime("%m%Y")


def main():
    conn = get_connection()
    conn.autocommit = False
    cur = conn.cursor()

    try:
        # 1. Backup table (timestamped, like the SQL migrations do).
        backup_name = "query_logs_backup_v4_" + datetime.now().strftime("%Y%m%d_%H%M%S")
        cur.execute(f'CREATE TABLE "{backup_name}" AS SELECT * FROM query_logs')
        print(f"[v4] Backup created: {backup_name}")

        # 2. Read every row's id, project_name, created_at — we don't need
        #    anything else to compute the new ID.
        cur.execute(
            "SELECT id, project_name, created_at FROM query_logs ORDER BY id ASC"
        )
        rows = cur.fetchall()
        print(f"[v4] Fetched {len(rows)} rows.")

        # 3. Build an in-memory plan: for each row, decide its new
        #    custom_query_id by walking the rows in (prefix, year_month, id)
        #    order and assigning 1, 2, 3... within each bucket.
        annotated = []
        for row_id, project_name, created_at in rows:
            prefix = compute_prefix(project_name)
            ym = compute_year_month(created_at)
            annotated.append((prefix, ym, row_id))

        # Sort: bucket first (prefix, year_month), then id ASC within the bucket
        # so the assignment is in insertion order.
        annotated.sort(key=lambda t: (t[0], t[1], t[2]))

        new_ids = {}  # row_id -> new custom_query_id
        bucket_counts = {}  # (prefix, ym) -> running count
        for prefix, ym, row_id in annotated:
            count = bucket_counts.get((prefix, ym), 0) + 1
            bucket_counts[(prefix, ym)] = count
            # Format: 3-digit zero-pad; for >999 the number just grows (4+ chars).
            seq_str = f"{count:03d}"
            new_ids[row_id] = f"{prefix}_{ym}_{seq_str}"

        # 4. Sanity check the plan BEFORE writing back.
        if len(set(new_ids.values())) != len(new_ids):
            raise RuntimeError(
                "[v4] Plan failed sanity check: duplicate new IDs computed. "
                "Aborting before any UPDATE."
            )
        print(f"[v4] Plan verified: {len(new_ids)} unique IDs across {len(bucket_counts)} buckets.")

        # 5. Execute updates. psycopg2.extras.execute_batch is faster than
        #    a per-row execute, but we keep it simple with a single UPDATE
        #    using a temporary table + JOIN.
        cur.execute("CREATE TEMP TABLE tmp_new_ids (id INTEGER PRIMARY KEY, new_id TEXT NOT NULL)")
        psycopg2_extras_execute_values(cur, "INSERT INTO tmp_new_ids (id, new_id) VALUES %s", new_ids.items())
        cur.execute(
            "UPDATE query_logs q SET custom_query_id = t.new_id "
            "FROM tmp_new_ids t WHERE q.id = t.id"
        )
        affected = cur.rowcount
        print(f"[v4] UPDATE affected {affected} rows.")

        # 6. Re-seed query_counters with the final bucket counts so server.py's
        #    UPSERT continues sequentially from here.
        cur.execute("TRUNCATE query_counters")
        cur.executemany(
            "INSERT INTO query_counters (prefix, year_month, counter) VALUES (%s, %s, %s)",
            [(p, ym, c) for (p, ym), c in bucket_counts.items()],
        )
        print(f"[v4] Seeded query_counters with {len(bucket_counts)} bucket rows.")

        # 7. Post-write verification against the actual DB.
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
        print("[v4] verification:")
        print(f"  Total rows in query_logs:      {total}")
        print(f"  Rows still NULL after migrate: {nulls} (expect 0)")
        print(f"  Distinct duplicate IDs left:   {dups} (expect 0)")
        print("-" * 60)

        if nulls > 0 or dups > 0:
            raise RuntimeError("[v4] Verification failed. Rolling back.")

        conn.commit()
        print(f"[v4] COMMITTED. Backup kept as table: {backup_name}")

    except Exception as exc:
        conn.rollback()
        print(f"[v4] ABORTED — rolled back. Reason: {exc}", file=sys.stderr)
        raise
    finally:
        cur.close()
        conn.close()


def psycopg2_extras_execute_values(cur, sql_template, items):
    """Tiny helper so this script doesn't fail if psycopg2.extras isn't
    available; falls back to executemany for the rare case."""
    try:
        from psycopg2.extras import execute_values
        execute_values(cur, sql_template, list(items))
    except ImportError:
        # sql_template has "VALUES %s" — split to support executemany fallback.
        prefix_sql = sql_template.split("VALUES")[0] + "VALUES (%s, %s)"
        cur.executemany(prefix_sql, list(items))


if __name__ == "__main__":
    main()
