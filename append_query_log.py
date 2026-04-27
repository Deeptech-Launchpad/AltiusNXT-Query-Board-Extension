import pandas as pd
import psycopg2
import os
from psycopg2.extras import execute_values
from dotenv import load_dotenv

load_dotenv()

DB_CONFIG = {
    'host': os.getenv('DB_HOST'),
    'port': os.getenv('DB_PORT'),
    'dbname': os.getenv('DB_NAME'),
    'user': os.getenv('DB_USER'),
    'password': os.getenv('DB_PASSWORD')
}

def append_data():
    file_name = 'Query_Log_Batch2025.xlsx' 
    if not os.path.exists(file_name):
        print(f"❌ Error: File '{file_name}' not found.")
        return

    print(f"Reading {file_name} for appending...")
    try:
        df = pd.read_excel(file_name, engine='openpyxl')
    except Exception as e:
        print(f"❌ Excel read failed: {e}")
        return

    # 1. MAPPING (12-column structure)
    df_clean = pd.DataFrame()
    df_clean['project_name']    = df.iloc[:, 0]
    df_clean['batch_name']      = df.iloc[:, 2]
    df_clean['category']        = df.iloc[:, 3]
    df_clean['attribute_name']  = df.iloc[:, 4]
    df_clean['query_text']      = df.iloc[:, 5]
    df_clean['response_text']   = df.iloc[:, 6]
    df_clean['reference_url']   = df.iloc[:, 7]
    df_clean['status']          = df.iloc[:, 8]
    df_clean['sku_id']          = df.iloc[:, 9]
    df_clean['mfr_part_number'] = df.iloc[:, 10]
    df_clean['manufacturer']    = df.iloc[:, 11]

    # 2. FORWARD FILL
    cols_to_fill = ['project_name', 'batch_name', 'sku_id', 'mfr_part_number', 'manufacturer']
    for col in cols_to_fill:
        df_clean[col] = df_clean[col].ffill()

    # 3. CLEANING
    desired_cols = ['project_name', 'batch_name', 'category', 'attribute_name', 'query_text', 
                    'response_text', 'reference_url', 'status', 'sku_id', 'mfr_part_number', 'manufacturer']
    df_final = df_clean.fillna('').astype(str).replace(['nan', 'NaN', 'None'], '').apply(lambda x: x.str.strip())

    try:
        conn = psycopg2.connect(**DB_CONFIG)
        cur = conn.cursor()
        
        # NO TRUNCATE: This allows data to remain in the table
        print(f"Appending {len(df_final)} rows to the existing database...")
        
        query = f"INSERT INTO query_logs ({', '.join(desired_cols)}) VALUES %s"
        values = [tuple(x) for x in df_final[desired_cols].to_numpy()]
        execute_values(cur, query, values)
        
        conn.commit()
        print("✅ SUCCESS! New data appended.")
        
    except Exception as e:
        print(f"❌ Database Error: {e}")
    finally:
        if 'conn' in locals():
            cur.close()
            conn.close()

if __name__ == "__main__":
    append_data()