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

def append_decisions():
    file_name = 'Decision_Log.xlsx'

    if not os.path.exists(file_name):
        print(f"❌ File '{file_name}' not found.")
        return

    try:
        print(f"Reading {file_name} for appending...")
        df = pd.read_excel(file_name, engine='openpyxl')
        
        # Clean headers to remove trailing spaces
        df.columns = df.columns.str.strip()

        # Mapping based on the Decision Log structure
        rename_map = {
            'Project': 'project_name',
            'NPI Batch Name': 'batch_name',
            'Node name': 'category',
            'Attribute Name': 'attribute_name',
            'Decision': 'decision_text',
            'Attribute Value': 'issue_description',
            'Ref URL/File': 'reference_url',
            'Status': 'status',
            'SKU': 'sku_id',
            'MPN': 'mfr_part_number', 
            'Manufacturer': 'manufacturer'
        }
        df = df.rename(columns=rename_map)

        db_cols = [
            'project_name', 'batch_name', 'category', 'attribute_name', 
            'issue_description', 'decision_text', 'reference_url', 'status',
            'sku_id', 'mfr_part_number', 'manufacturer'
        ]
        
        # Ensure all columns exist in the DataFrame
        for col in db_cols:
            if col not in df.columns:
                df[col] = ''

        # Convert to string and clean whitespace
        df = df.astype(str).apply(lambda x: x.str.strip())
        
        # Filter for valid decisions
        df_final = df[(df['decision_text'] != '') & (df['decision_text'] != 'nan')].copy()

        conn = psycopg2.connect(**DB_CONFIG)
        cur = conn.cursor()
        
        # Ensure the table supports long text
        cur.execute("ALTER TABLE decision_logs ALTER COLUMN decision_text TYPE TEXT;")
        
        print(f"Appending {len(df_final)} decisions to the database...")
        
        # Standard append logic
        query = f"INSERT INTO decision_logs ({', '.join(db_cols)}) VALUES %s"
        execute_values(cur, query, [tuple(x) for x in df_final[db_cols].to_numpy()])
        
        conn.commit()
        print(f"✅ SUCCESS! Appended {len(df_final)} decisions.")
        
    except Exception as e:
        print(f"❌ Error: {e}")
    finally:
        if 'conn' in locals() and conn: conn.close()

if __name__ == "__main__":
    append_decisions()