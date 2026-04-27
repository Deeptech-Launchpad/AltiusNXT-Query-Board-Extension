import pandas as pd
import psycopg2

from dotenv import load_dotenv
import os

load_dotenv()

# --- CONFIGURATION ---
DB_CONFIG = {
    'host': os.getenv('DB_HOST'),
    'port': os.getenv('DB_PORT'),
    'dbname': os.getenv('DB_NAME'),
    'user': os.getenv('DB_USER'),
    'password': os.getenv('DB_PASSWORD')
}

FILENAME = '2025_Query Schema.xlsx - Schema.csv'

def main():
    try:
        print(f"--- Starting Full Data Load for {FILENAME} ---")

        # 1. Load the Excel File
        df = pd.read_excel(FILENAME, engine='openpyxl')
        
        # 2. Clean column names
        df.columns = df.columns.astype(str).str.strip()
        
        # 3. Database Connection
        conn = psycopg2.connect(**DB_CONFIG)
        cur = conn.cursor()

        # --- STEP A: Load Unique Projects ---
        unique_projects = df['Project Name'].dropna().unique()
        for project in unique_projects:
            cur.execute(
                "INSERT INTO projects (project_name) VALUES (%s) ON CONFLICT (project_name) DO NOTHING",
                (str(project).strip(),)
            )
        print(f"Loaded {len(unique_projects)} projects.")

        # --- STEP B: Load Taxonomy and Attributes ---
        # We store these in the known_attributes table
        count = 0
        for _, row in df.iterrows():
            project = str(row['Project Name']).strip()
            category = str(row['Taxonomy']).strip()
            attribute = str(row['Attribute']).strip()

            if pd.isna(row['Project Name']) or pd.isna(row['Taxonomy']):
                continue

            cur.execute("""
                INSERT INTO known_attributes (project_name, category, attribute_name)
                VALUES (%s, %s, %s)
                ON CONFLICT DO NOTHING
            """, (project, category, attribute))
            count += 1

        conn.commit()
        cur.close()
        conn.close()
        print(f"--- Success: {count} attributes loaded into database! ---")

    except Exception as e:
        print(f"--- Critical Error: {e} ---")

if __name__ == "__main__":
    main()
