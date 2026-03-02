import pandas as pd
import psycopg2
from psycopg2.extras import execute_values
import os
from dotenv import load_dotenv

load_dotenv()

DB_CONFIG = {
    'host': os.getenv('DB_HOST'),
    'port': os.getenv('DB_PORT'),
    'dbname': os.getenv('DB_NAME'),
    'user': os.getenv('DB_USER'),
    'password': os.getenv('DB_PASSWORD')
}

def update_db_schema(cur):
    """Ensures the database has all necessary columns."""
    cur.execute("ALTER TABLE decision_logs ADD COLUMN IF NOT EXISTS project_name VARCHAR(255);")
    cur.execute("ALTER TABLE decision_logs ADD COLUMN IF NOT EXISTS reference_url TEXT;")
    cur.execute("ALTER TABLE decision_logs ADD COLUMN IF NOT EXISTS status VARCHAR(100);")
    cur.execute("ALTER TABLE decision_logs ADD COLUMN IF NOT EXISTS proposed_by VARCHAR(255);")

def load_decisions():
    file_name = 'Decision_Log.xlsx'

    if not os.path.exists(file_name):
        print(f"❌ File '{file_name}' not found.")
        return

    try:
        print(f"Reading {file_name}...")
        df = pd.read_excel(file_name, engine='openpyxl')
        
        # 1. Clean headers: remove spaces and make lowercase for easier matching
        df.columns = df.columns.astype(str).str.strip()

        # 2. Flexible Mapping Logic
        # This handles cases where headers might be 'Project' or 'Project Name'
        rename_map = {}
        for col in df.columns:
            c_low = col.lower()
            if c_low in ['project', 'project name']: rename_map[col] = 'project_name'
            elif c_low in ['batch', 'npi batch name', 'batch name']: rename_map[col] = 'batch_name'
            elif c_low in ['node name', 'category']: rename_map[col] = 'category'
            elif c_low in ['attribute', 'attribute name']: rename_map[col] = 'attribute_name'
            elif c_low in ['decision', 'decision text']: rename_map[col] = 'decision_text'
            elif c_low in ['attribute value', 'issue', 'issue description']: rename_map[col] = 'issue_description'
            elif c_low in ['ref url/file', 'url', 'reference']: rename_map[col] = 'reference_url'
            elif c_low in ['status']: rename_map[col] = 'status'
            elif c_low in ['sku', 'sku id']: rename_map[col] = 'sku_id'
            elif c_low in ['mpn', 'mfr part no']: rename_map[col] = 'mfr_part_number'
            elif c_low in ['manufacturer', 'mfr']: rename_map[col] = 'manufacturer'

        df = df.rename(columns=rename_map)

        # 3. FORWARD FILL (CRITICAL FIX)
        # If cells are merged in Excel, only the top cell has data. 
        # ffill() pulls the project/batch name down to every row.
        fill_cols = ['project_name', 'batch_name', 'category']
        for col in fill_cols:
            if col in df.columns:
                df[col] = df[col].ffill()

        # 4. Define target DB columns
        db_cols = [
            'project_name', 'batch_name', 'category', 'attribute_name', 
            'issue_description', 'decision_text', 'reference_url', 'status',
            'sku_id', 'mfr_part_number', 'manufacturer', 'proposed_by'
        ]
        
        # Ensure all columns exist, if not, create them empty
        for col in db_cols:
            if col not in df.columns:
                if col == 'proposed_by':
                    df[col] = 'Bulk Load'  # Default for dashboard visibility
                elif col == 'status':
                    df[col] = 'Active'     # Default status
                else:
                    df[col] = ''

        # 5. Final Cleaning
        # Convert to string, remove 'nan' strings caused by pandas
        df = df.fillna('').astype(str).replace(['nan', 'NaN', 'None'], '').apply(lambda x: x.str.strip())
        
        # Only keep rows where there is an actual decision
        df_final = df[df['decision_text'] != ''].copy()

        # 6. Database Operation
        conn = psycopg2.connect(**DB_CONFIG)
        cur = conn.cursor()
        
        update_db_schema(cur)
        
        print(f"Truncating and inserting {len(df_final)} rows...")
        cur.execute("TRUNCATE TABLE decision_logs RESTART IDENTITY;")
        
        query = f"INSERT INTO decision_logs ({', '.join(db_cols)}) VALUES %s"
        execute_values(cur, query, [tuple(x) for x in df_final[db_cols].to_numpy()])
        
        conn.commit()
        print(f"✅ SUCCESS! Loaded {len(df_final)} decisions.")
        
    except Exception as e:
        print(f"❌ Error: {e}")
    finally:
        if 'conn' in locals() and conn: conn.close()

if __name__ == "__main__":
    load_decisions()