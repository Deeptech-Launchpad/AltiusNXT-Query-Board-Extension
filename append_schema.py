import pandas as pd
import psycopg2
import os
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

# Debugging: Ensure env is working
user = os.getenv('DB_USER')
if not user or user == 'postgres_user':
    print("❌ ERROR: .env not loaded or still has 'postgres_user'. Check your .env file content!")

DB_CONFIG = {
    "dbname": os.getenv("DB_NAME"),
    "user": os.getenv("DB_USER"),
    "password": os.getenv("DB_PASSWORD"),
    "host": os.getenv("DB_HOST", "localhost"),
    "port": os.getenv("DB_PORT", "5432")
}

FILE_PATH = "Consolidated Schema for Query board. to DB_10012026xlsx.xlsx"

def find_col(aliases, df_cols):
    for alias in aliases:
        if alias in df_cols:
            return alias
    return None

def append_data():
    conn = None
    try:
        print(f"Connecting to {DB_CONFIG['dbname']} as {DB_CONFIG['user']}...")
        conn = psycopg2.connect(**DB_CONFIG)
        cur = conn.cursor()

        print(f"Reading {FILE_PATH}...")
        df = pd.read_excel(FILE_PATH)
        df.columns = [str(c).strip() for c in df.columns]

        category_aliases = ['Category', 'Taxonomy', 'Node Name', 'Taxonomy Name']
        attribute_aliases = ['Attribute', 'Attribute Name', 'Field Name']
        project_aliases = ['Project Name', 'Project']

        actual_cat_col = find_col(category_aliases, df.columns)
        actual_attr_col = find_col(attribute_aliases, df.columns)
        actual_proj_col = find_col(project_aliases, df.columns)

        if not actual_cat_col or not actual_attr_col or not actual_proj_col:
            print(f"❌ Error: Required columns missing. Found: {df.columns.tolist()}")
            return

        print(f"Starting append for {len(df)} rows...")

        for index, row in df.iterrows():
            try:
                p_name = str(row[actual_proj_col]).strip()
                c_name = str(row[actual_cat_col]).strip()
                a_name = str(row[actual_attr_col]).strip()

                if p_name == 'nan' or c_name == 'nan': continue

                # 1. Upsert Project
                cur.execute("""
                    INSERT INTO projects (project_name) VALUES (%s)
                    ON CONFLICT (project_name) DO UPDATE SET project_name = EXCLUDED.project_name
                    RETURNING id
                """, (p_name,))
                project_id = cur.fetchone()[0]

                # 2. Sync to known_attributes (The main table used by the Extension)
                cur.execute("""
                    INSERT INTO known_attributes (project_name, category, attribute_name)
                    VALUES (%s, %s, %s)
                    ON CONFLICT (project_name, category, attribute_name) DO NOTHING
                """, (p_name, c_name, a_name))

                if index % 500 == 0:
                    conn.commit()
                    print(f"Progress: {index} rows processed...")

            except Exception as row_error:
                conn.rollback() 
                print(f"⚠️ Row {index} failed: {row_error}. Skipping...")
                continue

        conn.commit()
        print("✅ Data successfully appended.")

    except Exception as e:
        print(f"❌ Critical Error: {e}")
        if conn: conn.rollback()
    finally:
        if conn:
            cur.close()
            conn.close()

if __name__ == "__main__":
    append_data()