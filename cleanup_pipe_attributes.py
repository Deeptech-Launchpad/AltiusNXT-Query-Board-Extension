import psycopg2
import os
from dotenv import load_dotenv

load_dotenv()

DB_CONFIG = {
    'host':     os.getenv('DB_HOST'),
    'port':     os.getenv('DB_PORT'),
    'dbname':   os.getenv('DB_NAME'),
    'user':     os.getenv('DB_USER'),
    'password': os.getenv('DB_PASSWORD')
}

def run():
    conn = None
    try:
        print("Connecting to database...")
        conn = psycopg2.connect(**DB_CONFIG)
        cur = conn.cursor()

        # ── STEP 1: PREVIEW ──────────────────────────────────────────────────
        print("\n📋 PREVIEW — rows that WILL be deleted (attribute_name contains '|'):\n")
        cur.execute("""
            SELECT id, project_name, category, attribute_name
            FROM known_attributes
            WHERE attribute_name LIKE '%|%'
            ORDER BY project_name, category, attribute_name;
        """)
        rows = cur.fetchall()

        if not rows:
            print("✅ No malformed rows found. Nothing to delete. Database is clean.")
            return

        print(f"{'ID':<8} {'Project':<25} {'Category':<30} {'Attribute (malformed)'}")
        print("-" * 100)
        for row in rows:
            print(f"{str(row[0]):<8} {str(row[1]):<25} {str(row[2]):<30} {row[3]}")

        print(f"\nTotal rows to delete: {len(rows)}")

        # ── STEP 2: CONFIRM ──────────────────────────────────────────────────
        answer = input("\n⚠️  Type 'DELETE' to permanently remove these rows, or anything else to cancel: ").strip()

        if answer != 'DELETE':
            print("❌ Cancelled. No changes made.")
            return

        # ── STEP 3: DELETE ───────────────────────────────────────────────────
        cur.execute("""
            DELETE FROM known_attributes
            WHERE attribute_name LIKE '%|%';
        """)
        deleted_count = cur.rowcount
        conn.commit()

        print(f"\n✅ SUCCESS: {deleted_count} malformed attribute row(s) deleted.")
        print("All other data (query_logs, decision_logs, feedback_logs, etc.) is untouched.")

    except Exception as e:
        if conn:
            conn.rollback()
        print(f"\n❌ ERROR: {e}")
    finally:
        if conn:
            cur.close()
            conn.close()

if __name__ == "__main__":
    run()
