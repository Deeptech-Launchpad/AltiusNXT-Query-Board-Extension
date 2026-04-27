import psycopg2
import os
from dotenv import load_dotenv

# Load environment variables for database configuration
load_dotenv()

DB_CONFIG = {
    'host': os.getenv('DB_HOST'),
    'port': os.getenv('DB_PORT'),
    'dbname': os.getenv('DB_NAME'),
    'user': os.getenv('DB_USER'),
    'password': os.getenv('DB_PASSWORD')
}

def clear_all_data():
    """
    Erases all records from the core tables and resets ID counters.
    """
    conn = None
    try:
        # Connect to the PostgreSQL database
        conn = psycopg2.connect(**DB_CONFIG)
        cur = conn.cursor()
        
        print("⚠️ Starting Master Reset of the database...")

        # The SQL command to clear all primary data tables
        # RESTART IDENTITY resets the SERIAL/BIGSERIAL ID columns to 1
        sql_reset = """
            TRUNCATE TABLE 
                query_logs, 
                decision_logs, 
                feedback_logs, 
                known_attributes 
            RESTART IDENTITY;
        """
        
        cur.execute(sql_reset)
        conn.commit()
        
        print("✅ SUCCESS: All tables cleared and ID counters reset.")
        print("You can now run your load_schema.py and load_data.py scripts.")

    except Exception as e:
        if conn:
            conn.rollback()
        print(f"❌ Error during database reset: {e}")
    finally:
        if conn:
            cur.close()
            conn.close()

if __name__ == "__main__":
    # Ask for a final confirmation to prevent accidental data loss
    confirm = input("This will PERMANENTLY erase all data in the database. Type 'YES' to proceed: ")
    if confirm == "YES":
        clear_all_data()
    else:
        print("Reset cancelled.")