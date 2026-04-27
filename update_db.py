import psycopg2
import os
from dotenv import load_dotenv

# Load database credentials from .env file
load_dotenv()

DB_CONFIG = {
    'host': os.getenv('DB_HOST'),
    'port': os.getenv('DB_PORT'),
    'dbname': os.getenv('DB_NAME'),
    'user': os.getenv('DB_USER'),
    'password': os.getenv('DB_PASSWORD')
}

def update_database():
    conn = None
    try:
        print("Connecting to the database...")
        conn = psycopg2.connect(**DB_CONFIG)
        cur = conn.cursor()

        # 1. CLEAN DUPLICATES (Necessary before adding UNIQUE constraint)
        print("Step 1: Removing duplicate entries from 'known_attributes'...")
        deduplicate_sql = """
            DELETE FROM known_attributes a USING known_attributes b
            WHERE a.id > b.id 
            AND a.project_name = b.project_name 
            AND a.category = b.category 
            AND a.attribute_name = b.attribute_name;
        """
        cur.execute(deduplicate_sql)
        print(f"Removed {cur.rowcount} duplicate rows.")

        # 2. ADD UNIQUE CONSTRAINT (Fixes 'ON CONFLICT' error in popup.js)
        print("Step 2: Ensuring UNIQUE constraint on 'known_attributes'...")
        cur.execute("""
            SELECT count(*) FROM pg_constraint 
            WHERE conname = 'unique_project_category_attribute';
        """)
        if cur.fetchone()[0] == 0:
            cur.execute("""
                ALTER TABLE known_attributes 
                ADD CONSTRAINT unique_project_category_attribute 
                UNIQUE (project_name, category, attribute_name);
            """)
            print("SUCCESS: UNIQUE constraint added.")
        else:
            print("INFO: UNIQUE constraint already exists.")

        # 3. ADD MISSING COLUMNS TO DECISION_LOGS
        print("Step 3: Checking for missing columns in 'decision_logs'...")

        print("Step 4: Creating user_activity_logs table...")
        cur.execute("""
            CREATE TABLE IF NOT EXISTS user_activity_logs (
                id SERIAL PRIMARY KEY,
                timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                user_email TEXT,
                user_role TEXT,
                action_type TEXT, 
                project_name TEXT,
                batch_name TEXT,
                category TEXT,
                attribute_name TEXT,
                query_id TEXT,
                query_sent_to TEXT,
                kb_id TEXT,
                duration TEXT,
                turnaround_time TEXT
            );
        """)

        # Add example_value column required by create_decision endpoint
        cur.execute("ALTER TABLE decision_logs ADD COLUMN IF NOT EXISTS example_value TEXT;")
        # Ensure project_name exists as referenced in load_decisions.py
        cur.execute("ALTER TABLE decision_logs ADD COLUMN IF NOT EXISTS project_name VARCHAR(255);")
        
        conn.commit()
        print("SUCCESS: Database structure updated successfully.")

    except Exception as e:
        if conn:
            conn.rollback()
        print(f"ERROR: DATABASE ERROR: {e}")
    finally:
        if conn:
            cur.close()
            conn.close()

if __name__ == "__main__":
    update_database()