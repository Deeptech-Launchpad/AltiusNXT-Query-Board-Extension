import pandas as pd
import psycopg2
from psycopg2.extras import execute_values
import os
from dotenv import load_dotenv

load_dotenv()

DB_CONFIG = {
    'host': os.getenv('DB_HOST', 'localhost'),
    'port': os.getenv('DB_PORT', '5432'),
    'dbname': os.getenv('DB_NAME', 'Rag_system_db'),
    'user': os.getenv('DB_USER', 'postgres'),
    'password': os.getenv('DB_PASSWORD', 'deeptech')
}

def load_feedback():
    print("--- STARTING FEEDBACK LOAD ---")
    
    # ⚠️ Ensure this matches your specific file name
    file_name = 'Check_Feedback_Report .xlsx - Feedback Status.csv'

    if not os.path.exists(file_name):
        # Fallback naming checks
        if os.path.exists('Check_Feedback_Report.xlsx - Feedback Status.csv'):
            file_name = 'Check_Feedback_Report.xlsx - Feedback Status.csv'
        elif os.path.exists('Check_Feedback_Report.xlsx'):
             file_name = 'Check_Feedback_Report.xlsx'
        else:
            print(f"❌ CRITICAL ERROR: File '{file_name}' not found.")
            return

    try:
        print(f"Reading {file_name}...")
        
        # Robust read logic
        if file_name.endswith('.xlsx'):
            df = pd.read_excel(file_name, engine='openpyxl')
        else:
            try:
                df = pd.read_csv(file_name, encoding='utf-8')
            except UnicodeDecodeError:
                print("⚠️ UTF-8 decoding failed. Trying 'latin1' encoding...")
                df = pd.read_csv(file_name, encoding='latin1')
        
        # Clean headers
        df.columns = df.columns.str.strip()
        print(f"Columns found: {df.columns.tolist()}")
        
        # --- 1. REMOVE DUPLICATES ---
        initial_count = len(df)
        df = df.drop_duplicates()
        if len(df) < initial_count:
            print(f"⚠️ Removed {initial_count - len(df)} duplicate rows from source file.")

        # --- 2. INTELLIGENT LINK MAPPING ---
        # Prioritize 'Query Ref Link', then others
        if 'reference_url' not in df.columns:
            if 'Query Ref Link' in df.columns:
                df['reference_url'] = df['Query Ref Link']
            elif 'Decision Ref Link' in df.columns:
                df['reference_url'] = df['Decision Ref Link']
            elif 'Example Value' in df.columns and df['Example Value'].astype(str).str.startswith('http').any():
                 df['reference_url'] = df['Example Value']
            else:
                 df['reference_url'] = ''

        # --- 3. COLUMN MAPPING ---
        rename_map = {
            'Batch':                 'batch_name',
            'Category':              'category',       
            'Attribute':             'attribute_name', 
            'Decision Text':         'feedback_text', 
            'Status':                'status'
        }
        
        df = df.rename(columns=rename_map)

        # Handle missing columns
        if 'root_cause' not in df.columns: df['root_cause'] = ''
        
        # Validation
        required_cols = ['batch_name', 'category', 'attribute_name', 'feedback_text']
        for col in required_cols:
            if col not in df.columns:
                print(f"❌ Error: Could not find '{col}' (mapped) in dataframe.")
                return

        # Prepare Data
        db_cols = ['batch_name', 'category', 'attribute_name', 'feedback_text', 'root_cause', 'status', 'reference_url']
        
        for col in db_cols:
            if col not in df.columns: df[col] = ''

        # Filter empty feedback
        df_final = df[db_cols].fillna('')
        df_final = df_final[df_final['feedback_text'].str.strip() != '']

        # Database Operations
        conn = psycopg2.connect(**DB_CONFIG)
        cur = conn.cursor()
        
        print("🛠 Resetting 'feedback_logs' table structure...")
        cur.execute("DROP TABLE IF EXISTS feedback_logs;")
        
        # Using TEXT type to prevent character limit errors
        cur.execute("""
            CREATE TABLE feedback_logs (
                id SERIAL PRIMARY KEY,
                batch_name TEXT,
                category TEXT,
                attribute_name TEXT,
                feedback_text TEXT,
                root_cause TEXT,
                status TEXT,
                reference_url TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        """)

        print(f"Inserting {len(df_final)} feedback rows...")
        
        query = """
            INSERT INTO feedback_logs (batch_name, category, attribute_name, feedback_text, root_cause, status, reference_url)
            VALUES %s
        """
        values = [tuple(x) for x in df_final.to_numpy()]
        execute_values(cur, query, values)
        
        conn.commit()
        print("✅ SUCCESS! Feedback loaded correctly.")
        
    except Exception as e:
        print(f"\n❌ SYSTEM ERROR: {e}")
    finally:
        if 'conn' in locals() and conn: conn.close()

if __name__ == "__main__":
    load_feedback()