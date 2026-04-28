import psycopg2
import psycopg2.extras
import os
import time
import pandas as pd
from io import BytesIO
from flask import Flask, request, jsonify, send_from_directory, send_file
from flask_cors import CORS
from werkzeug.utils import secure_filename
from dotenv import load_dotenv
import os
import threading
import time
import re
try:
    import fcntl
except ImportError:
    fcntl = None
import google.generativeai as genai
#from flask_mail import Mail
from report_service import send_daily_report
from flask import send_from_directory
from datetime import datetime

# Load environment variables
load_dotenv()

app = Flask(__name__)
CORS(app)

GEMINI_KEY = os.getenv("GEMINI_API_KEY")
genai.configure(api_key=GEMINI_KEY)

def get_available_model():
    print("\n--- DIAGNOSING GEMINI MODELS ---")
    try:
        # List all models available to your specific API key
        available_models = []
        for m in genai.list_models():
            if 'generateContent' in m.supported_generation_methods:
                available_models.append(m.name)
                print(f"FOUND: {m.name}")

        # Priority 1: 1.5 Flash (Stable)
        if 'models/gemini-1.5-flash' in available_models:
            print("SUCCESS: SELECTING: gemini-1.5-flash")
            return genai.GenerativeModel('gemini-1.5-flash')
        
        # Priority 2: 1.5 Flash (Latest)
        if 'models/gemini-1.5-flash-latest' in available_models:
            print("SUCCESS: SELECTING: gemini-1.5-flash-latest")
            return genai.GenerativeModel('gemini-1.5-flash-latest')

        # Priority 3: 1.5 Pro
        if 'models/gemini-1.5-pro' in available_models:
            print("SUCCESS: SELECTING: gemini-1.5-pro")
            return genai.GenerativeModel('gemini-1.5-pro')

        # Fallback to the first one available
        if available_models:
            print(f"WARNING: PREFERRED MODELS NOT FOUND. USING FALLBACK: {available_models[0]}")
            return genai.GenerativeModel(available_models[0])
            
        raise Exception("No models found supporting generateContent.")

    except Exception as e:
        print(f"ERROR: DIAGNOSIS FAILED: {e}")
        # Final hardcoded fallback
        return genai.GenerativeModel('gemini-1.5-flash')

# Initialize the model once
model = get_available_model()
print("--- DIAGNOSIS COMPLETE ---\n")

# Configuration for File Uploads
UPLOAD_FOLDER = os.path.join(os.getcwd(), 'uploads')
os.makedirs(UPLOAD_FOLDER, exist_ok=True)
app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER

# Database Configuration
DB_CONFIG = {
    'host': os.getenv('DB_HOST'),
    'port': os.getenv('DB_PORT'),
    'dbname': os.getenv('DB_NAME'),
    'user': os.getenv('DB_USER'),
    'password': os.getenv('DB_PASSWORD')
}

# --- 1. CONFIGURATION & ROLE LISTS ---
def get_email_list(key):
    raw = os.getenv(key, '')
    # Splits comma-separated strings into a clean list
    return [email.strip().lower() for email in raw.split(',') if email.strip()]

# Define role-specific lists using the helper function
TL_LIST = get_email_list('TL_EMAILS')
PL_LIST = get_email_list('PL_EMAILS')
PM_LIST = get_email_list('PM_EMAILS')
SME_LIST = get_email_list('SME_EMAILS')

# Master Admin List for role checks
ADMIN_EMAILS = list(set(TL_LIST + PL_LIST + PM_LIST + SME_LIST))

def get_db_connection():
    try:
        return psycopg2.connect(**DB_CONFIG)
    except Exception as e:
        print(f"DB Error: {e}")
        return None
@app.route('/', methods=['GET'])
def health_check():
    # This ensures the background script gets valid JSON instead of an HTML error
    return jsonify({"status": "online", "message": "Query Board Server is running"}), 200


def create_system_notification(recipient_email, message, ref_id=None):
    try:
        conn = get_db_connection()
        cur = conn.cursor()
        sql = "INSERT INTO notifications (recipient_email, message, reference_id) VALUES (%s, %s, %s)"
        cur.execute(sql, (recipient_email, message, ref_id))
        conn.commit()
        conn.close()
    except Exception as e:
        print(f"Notification Error: {e}")

@app.route('/api/check_notifications', methods=['POST'], strict_slashes=False)
def check_notifications():
    try:
        data = request.json
        if not data:
            return jsonify([])
            
        email = data.get('userEmail', '').strip().lower()
        
        conn = get_db_connection()
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        
        notifications = []

        # Determine Role
        role = "USER"
        if email in TL_LIST: role = "TL"
        elif email in PL_LIST: role = "PL"
        elif email in PM_LIST: role = "PM"
        elif email in SME_LIST: role = "SME"

        # 1. Check for Admin Inbox (Queries assigned to them)
        if email in ADMIN_EMAILS:
            cur.execute("SELECT id, query_text FROM query_logs WHERE status = 'Pending' AND recipient_type = %s", (role,))
            pending = cur.fetchall()
            for p in pending:
                notifications.append({"id": f"q_{p['id']}", "message": f"New Query: {p['query_text'][:30]}..."})

        # 2. Check for User Responses
        cur.execute("SELECT id, query_text FROM query_logs WHERE user_email = %s AND status = 'Closed'", (email,))
        responses = cur.fetchall()
        for r in responses:
            notifications.append({"id": f"r_{r['id']}", "message": f"Response received for: {r['query_text'][:30]}..."})

        conn.close()
        return jsonify(notifications)
    except psycopg2.errors.InsufficientPrivilege as e:
        # DB user lacks GRANT on notifications table — return empty list so extension still works
        print(f"[check_notifications] DB permission error — run: GRANT SELECT, INSERT ON notifications TO <db_user>. Detail: {e}")
        return jsonify([]), 200
    except Exception as e:
        print(f"Error in check_notifications: {e}")
        return jsonify([]), 500       

@app.route('/uploads/<filename>')
def uploaded_file(filename):
    return send_from_directory('uploads', filename)

# --- NEW: ROUTE TO FIX ATTACHMENT PREVIEW/DOWNLOAD ---
@app.route('/api/attachment/<int:query_id>', methods=['GET'])
def get_query_attachment(query_id):
    conn = get_db_connection()
    if not conn:
        return "Database Connection Error", 500
        
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    try:
        # Fetch the attachment URL stored in the database for this specific query
        cur.execute("SELECT attachment_url FROM query_logs WHERE id = %s", (query_id,))
        result = cur.fetchone()
        
        if result and result['attachment_url']:
            # The URL in DB looks like ".../uploads/123_image.jpg"
            # We extract just the filename from the end of the URL
            filename = result['attachment_url'].split('/')[-1]
            
            # Serve the file from the AWS 'uploads' folder
            return send_from_directory(app.config['UPLOAD_FOLDER'], filename)
            
        return "Attachment not found in database", 404
    except Exception as e:
        print(f"Error fetching attachment: {e}")
        return "Internal Server Error", 500
    finally:
        cur.close()
        conn.close()

# --- API ENDPOINTS ---

@app.route('/api/admin/upload_schema', methods=['POST'])
def upload_schema():
    if 'file' not in request.files:
        return jsonify({"message": "No file part"}), 400

    file = request.files['file']
    if file.filename == '':
        return jsonify({"message": "No selected file"}), 400

    try:
        # Read Excel directly from the upload stream
        df = pd.read_excel(file, engine='openpyxl')
        df.columns = [str(c).strip() for c in df.columns]

        # --- Build clean rows list in Python (fast, no DB round-trips per row) ---
        col = lambda aliases: next((a for a in aliases if a in df.columns), None)
        proj_col = col(['Project Name', 'Project'])
        cat_col  = col(['Taxonomy', 'Category', 'Node Name', 'Taxonomy Name'])
        attr_col = col(['Attribute', 'Attribute Name', 'Field Name'])
        uom_col  = col(['Units of Measure', 'UOM', 'Unit'])
        defn_col = col(['Definition'])
        slov_col = col(['Sample LOV'])
        alov_col = col(['Allowed LOV'])
        dtyp_col = col(['Data Type'])

        if not proj_col or not cat_col or not attr_col:
            missing = [n for n, c in [('Project Name', proj_col), ('Taxonomy/Category', cat_col), ('Attribute', attr_col)] if not c]
            return jsonify({"status": "error", "message": f"Required columns missing: {', '.join(missing)}. Found: {df.columns.tolist()}"}), 400

        # Field length limits (match DB TEXT columns; cap LOV fields that can be huge)
        LIMITS = {
            'p_name':  500,
            'c_name':  500,
            'a_name':  500,
            'uom':     200,
            'defn':    5000,
            'slov':    5000,   # Sample LOV — Excel cells can hit 32 767 chars
            'alov':    5000,   # Allowed LOV — same risk
            'dtyp':    200,
        }

        def safe(row, col_name, limit=None):
            if col_name is None:
                return ''
            v = str(row.get(col_name, '')).strip()
            v = '' if v == 'nan' else v
            if limit and len(v) > limit:
                v = v[:limit]
            return v

        attribute_rows = []
        unique_projects = set()
        truncated_count = 0
        seen_keys = set()

        for _, row in df.iterrows():
            p_name = safe(row, proj_col, LIMITS['p_name'])
            c_name = safe(row, cat_col,  LIMITS['c_name'])
            a_name = safe(row, attr_col, LIMITS['a_name'])

            if not p_name or not c_name or not a_name:
                continue
        
            dedup_key = (p_name, c_name, a_name)
            if dedup_key in seen_keys:
                continue
            seen_keys.add(dedup_key)

            slov_raw = str(row.get(slov_col, '') if slov_col else '').strip()
            alov_raw = str(row.get(alov_col, '') if alov_col else '').strip()
            if len(slov_raw) > LIMITS['slov'] or len(alov_raw) > LIMITS['alov']:
                truncated_count += 1

            unique_projects.add(p_name)
            attribute_rows.append((
                p_name, c_name, a_name,
                safe(row, uom_col,  LIMITS['uom']),
                safe(row, defn_col, LIMITS['defn']),
                safe(row, slov_col, LIMITS['slov']),
                safe(row, alov_col, LIMITS['alov']),
                safe(row, dtyp_col, LIMITS['dtyp']),
            ))

        if not attribute_rows:
            return jsonify({"status": "error", "message": "No valid data rows found. Check that Project Name, Taxonomy, and Attribute columns are filled."}), 400

        conn = psycopg2.connect(**DB_CONFIG)
        cur = conn.cursor()

        # --- 1. Upsert all unique projects in one shot ---
        psycopg2.extras.execute_values(cur, """
            INSERT INTO projects (project_name, active)
            VALUES %s
            ON CONFLICT (project_name) DO NOTHING
        """, [(p, True) for p in unique_projects])

        # --- 2. Batch-upsert known_attributes in chunks of 500 rows ---
        BATCH_SIZE = 500
        processed_count = 0
        for i in range(0, len(attribute_rows), BATCH_SIZE):
            chunk = attribute_rows[i:i + BATCH_SIZE]
            psycopg2.extras.execute_values(cur, """
                INSERT INTO known_attributes (
                    project_name, category, attribute_name,
                    units_of_measure, definition, sample_lov, allowed_lov, data_type
                )
                VALUES %s
                ON CONFLICT (project_name, category, attribute_name)
                DO UPDATE SET
                    units_of_measure = EXCLUDED.units_of_measure,
                    definition       = EXCLUDED.definition,
                    sample_lov       = EXCLUDED.sample_lov,
                    allowed_lov      = EXCLUDED.allowed_lov,
                    data_type        = EXCLUDED.data_type
            """, chunk)
            conn.commit()
            processed_count += len(chunk)
            print(f"Schema upload progress: {processed_count}/{len(attribute_rows)}")

        cur.close()
        conn.close()

        msg = f"Successfully synced {processed_count} attributes from {len(unique_projects)} project(s)."
        if truncated_count > 0:
            msg += f" Note: {truncated_count} row(s) had oversized LOV fields (>5000 chars) that were automatically trimmed."
        return jsonify({"status": "success", "message": msg})

    except Exception as e:
        print(f"Upload Error: {e}")
        return jsonify({"status": "error", "message": str(e)}), 500

@app.route('/api/attachment/kb/<path:filename>')
def serve_kb_pdf(filename):
    try:
        # This sends the file from your local 'uploads' folder to the browser
        return send_from_directory(app.config['UPLOAD_FOLDER'], filename)
    except Exception as e:
        return str(e), 404

@app.route('/api/download_schema_template', methods=['GET'])
def download_schema_template():
    try:
        # Exact filename in your AWS uploads folder
        filename = "schema template 20-1-2026.xlsx"
        directory = app.config['UPLOAD_FOLDER']
        
        # Check if file exists to prevent a 500 error
        if not os.path.exists(os.path.join(directory, filename)):
            print(f"❌ File not found: {os.path.join(directory, filename)}")
            return jsonify({"error": "Template file not found on server"}), 404

        return send_from_directory(
            directory, 
            filename, 
            as_attachment=True,
            # This ensures the user gets a clean filename without spaces if preferred
            download_name="schema_template_2026.xlsx"
        )
    except Exception as e:
        print(f"❌ Server Error: {e}")
        return jsonify({"error": str(e)}), 500

@app.route('/api/projects', methods=['GET'])
def get_projects():
    conn = get_db_connection()
    cur = conn.cursor()
    cur.execute("SELECT project_name FROM projects WHERE active = TRUE ORDER BY project_name ASC")
    results = cur.fetchall()
    conn.close()
    return jsonify([row[0] for row in results])

@app.route('/api/my_history', methods=['POST'])
def get_my_history():
    data = request.json
    email = data.get('userEmail', '').strip().lower()
    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    
    # 1. Fetch Query History
    cur.execute("""
        SELECT id, custom_query_id, project_name, batch_name, category, attribute_name, 
               query_text as query, response_text as response, status, reference_url as url,
               attachment_url, attachment_type, answered_by,
               sku_id, mfr_part_number, manufacturer
        FROM query_logs 
        WHERE user_email = %s
        ORDER BY created_at DESC
    """, (email,))
    queries = cur.fetchall()
    for q in queries:
        q['is_user_view'] = True
        q['log_type'] = 'query'

    # 2. Fetch Decision Proposal History
    cur.execute("""
        SELECT id, project_name, category, attribute_name, 
               issue_description as query, decision_text as response, status,
               sku_id, mfr_part_number, manufacturer
        FROM decision_logs 
        WHERE proposed_by = %s
        ORDER BY id DESC
    """, (email,))
    decisions = cur.fetchall()
    for d in decisions:
        d['is_user_view'] = True
        d['is_decision_log'] = True
        d['log_type'] = 'decision'

    conn.close()
    # Combine and return both
    return jsonify(queries + decisions)

@app.route('/api/batches', methods=['POST'])
def get_batches():
    data = request.json
    project = data.get('project', '').strip()
    
    conn = get_db_connection()
    cur = conn.cursor()
    
    # We wrap the UNION in a subquery so we can sort the final combined list
    sql = """
        SELECT batch_name FROM (
            SELECT DISTINCT batch_name FROM query_logs 
            WHERE project_name ILIKE %s AND batch_name != ''
            UNION
            SELECT DISTINCT batch_name FROM decision_logs 
            WHERE project_name ILIKE %s AND batch_name != ''
        ) AS combined_batches
        ORDER BY 
            LENGTH(batch_name) ASC, 
            batch_name ASC
    """
    
    try:
        cur.execute(sql, (f"%{project}%", f"%{project}%"))
        results = cur.fetchall()
        # Return a flat list of batch names
        return jsonify([row[0] for row in results if row[0]])
    except Exception as e:
        print(f"❌ Batch Sort Error: {e}")
        return jsonify([]), 500
    finally:
        conn.close()

@app.route('/api/categories', methods=['POST'])
def get_categories():
    data = request.json
    project = data.get('project', '').strip()
    batch = data.get('batch', '').strip()

    conn = get_db_connection()
    cur = conn.cursor()
    
    if batch and batch != "":
        # If a batch is selected, find categories that exist in the LOGS for that specific batch
        sql = """
            SELECT DISTINCT category FROM query_logs 
            WHERE project_name ILIKE %s AND batch_name = %s AND category != ''
            UNION
            SELECT DISTINCT category FROM decision_logs 
            WHERE project_name ILIKE %s AND batch_name = %s AND category != ''
            ORDER BY category ASC
        """
        args = (f"%{project}%", batch, f"%{project}%", batch)
    else:
        # If NO batch is selected, show ALL categories from the Master Schema
        sql = """
            SELECT DISTINCT category FROM known_attributes 
            WHERE project_name ILIKE %s AND category != ''
            ORDER BY category ASC
        """
        args = (f"%{project}%",)
    
    cur.execute(sql, args)
    results = cur.fetchall()
    conn.close()
    
    db_cats = [row[0] for row in results if row[0]]
    special_cats = ['General-Schema Build', 'General-Sourcing', 'General-Data Build', 'General-Classification']
    return jsonify(special_cats + db_cats)

@app.route('/api/attributes', methods=['POST'])
def get_attributes():
    data = request.json
    project = data.get('project', '').strip()
    category = data.get('category', '').strip()

    conn = get_db_connection()
    cur = conn.cursor()
    
    # Exclusively pull attributes for the selected category
    sql = "SELECT DISTINCT attribute_name FROM known_attributes WHERE project_name ILIKE %s AND category = %s ORDER BY attribute_name ASC"
    
    try:
        cur.execute(sql, (f"%{project}%", category))
        results = cur.fetchall()
        return jsonify([row[0] for row in results if row[0]])
    except Exception as e:
        print(f"Error: {e}")
        return jsonify([])
    finally:
        conn.close()

# server.py snippet
@app.route('/api/save_attribute', methods=['POST'])
def save_attribute():
    data = request.json
    project = data.get('project', '').strip()
    category = data.get('category', '').strip()
    attribute_raw = data.get('attribute', '').strip()
    user_email = data.get('userEmail', '').strip().lower()

    if not (project and category and attribute_raw):
        return jsonify({"status": "error", "message": "Missing fields"}), 400

    # Handles both single and piped attributes (attr1 | attr2)
    attributes = [x.strip() for x in attribute_raw.split('|')] if '|' in attribute_raw else [attribute_raw]

    conn = get_db_connection()
    try:
        cur = conn.cursor()
        # This SQL requires the UNIQUE constraint mentioned above
        sql = """
            INSERT INTO known_attributes (project_name, category, attribute_name, created_by)
            VALUES (%s, %s, %s, %s)
            ON CONFLICT (project_name, category, attribute_name) DO NOTHING
        """
        for attr in attributes:
            if attr:
                cur.execute(sql, (project, category, attr, user_email))
        conn.commit()
        return jsonify({"status": "success", "saved_items": attributes})
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500
    finally:
        conn.close()

@app.route('/api/check_role', methods=['POST'])
def check_role():
    data = request.json
    email = data.get('userEmail', '').strip().lower()
    
    role = "USER"
    if email in TL_LIST: role = "TL"
    elif email in PL_LIST: role = "PL"
    elif email in PM_LIST: role = "PM"
    elif email in SME_LIST: role = "SME"
    
    return jsonify({
        "is_admin": email in ADMIN_EMAILS, 
        "role": role
    })


@app.route('/api/kb/attribute_info', methods=['POST'])
def get_kb_attribute_info():
    data = request.json
    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    cur.execute("""
        SELECT attribute_name, definition, sample_lov, allowed_lov, data_type, units_of_measure 
        FROM known_attributes 
        WHERE project_name = %s AND category = %s
    """, (data.get('project'), data.get('category')))
    results = cur.fetchall()
    conn.close()
    return jsonify(results)

@app.route('/api/kb/upload_pdf', methods=['POST'])
def upload_kb_pdf():
    project = request.form.get('project', '').strip()
    category = request.form.get('category', '').strip()
    user_email = request.form.get('userEmail', '').strip().lower()
    
    if 'file' not in request.files:
        return jsonify({"status": "error", "message": "No file"}), 400
        
    file = request.files['file']
    
    # Sanitize category and project (removes special chars like > that break URLs)
    clean_proj = re.sub(r'[^a-zA-Z0-9]', '_', project)
    clean_cat = re.sub(r'[^a-zA-Z0-9]', '_', category)
    
    # Create a safe unique filename
    filename = f"KB_{clean_proj}_{clean_cat}_{secure_filename(file.filename)}"
    file_path = os.path.join(app.config['UPLOAD_FOLDER'], filename)
    file.save(file_path)
    
    # FIX: Use request.host_url so it works on localhost AND AWS automatically
    base_url = "https://qb.altiusnxt.tech" 
    try:
        if request:
            base_url = request.host_url.rstrip('/')
    except:
        pass
    
    conn = get_db_connection()
    cur = conn.cursor()
    cur.execute("""
        INSERT INTO category_kb_files (project_name, category_name, file_url, uploaded_by)
        VALUES (%s, %s, %s, %s)
        ON CONFLICT (project_name, category_name) 
        DO UPDATE SET file_url = EXCLUDED.file_url, uploaded_by = EXCLUDED.uploaded_by
    """, (project, category, file_url, user_email))
    conn.commit()
    conn.close()
    
    return jsonify({"status": "success", "url": file_url})

@app.route('/api/kb/ai_generate_guide', methods=['POST'])
def ai_generate_guide():
    data = request.json
    project = data.get('project')
    category = data.get('category')

    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    cur.execute("""
        SELECT attribute_name, definition 
        FROM known_attributes 
        WHERE project_name = %s AND category = %s
    """, (project, category))
    attributes = cur.fetchall()
    conn.close()

    if not attributes:
        return jsonify({"error": "No schema data found for this category."}), 404

    attr_context = "\n".join([f"- {a['attribute_name']}: {a['definition']}" for a in attributes])
    
    prompt = f"""
        Act as a Subject Matter Expert (SME) and Technical Mentor for Product Content Engineering. 
        Project: {project} | Category: {category}
        
        Task: Conduct an intensive technical onboarding for a 'Trainee Product Content Engineer' on the category '{category}'.
        
        CRITICAL DATA INSTRUCTIONS:
        1. Only process and explain attributes provided in the 'Schema Context'. 
        2. Do NOT show common or general attributes (like Brand, Model) unless they are explicitly present in the context.

        Schema Context (Attributes to cover):
        {attr_context}

        Requirements for the HTML Output:

        1. <h2 style="color: #6c5ce7; border-bottom: 2px solid #6c5ce7;">1. Category Overview: {category}</h2>
        <p><strong>Technical Definition:</strong> Provide a 2-paragraph engineering explanation of {category}[cite: 39, 40]. Explain its primary mechanical/chemical purpose and key structural characteristics (e.g., adjustability, portability)[cite: 42].</p>
        <p><strong>Common Use Environments:</strong> Detail where these products are typically deployed (e.g., Residential, Office, Retail, or Industrial) and the environmental factors the trainee must consider[cite: 41, 47].</p>
        
        <div style="text-align: center; margin: 20px 0; padding: 15px; border: 1px dashed #764ba2; border-radius: 8px; background: #fdfbff;">
                <p style="font-weight: bold; color: #764ba2;">[SME VISUAL TRAINING AID]</p>
                <p style="font-size: 13px; color: #333;"><strong>Visual Anatomy:</strong> Describe the 5 key physical components of {category} that a trainee must identify visually (e.g., base, motor housing, blades, safety grill)[cite: 87].</p>
                <a href="https://www.google.com/search?tbm=isch&q={category}+technical+diagram+labeled+parts" target="_blank" style="display: inline-block; padding: 10px 20px; background: #667eea; color: white; text-decoration: none; border-radius: 5px; font-weight: bold;">
                    <i class="fas fa-image"></i> Open Product Anatomy Gallery
                </a>
        </div>

        2. <h3>2. Product Naming Conventions (SOP)</h3>
        <p>Explain the structured pattern for naming: <strong>Brand + Key Feature / Performance + Product Type</strong>[cite: 53, 54]. Provide 5 market-ready example names for this category[cite: 64].</p>

        3. <h3>3. Technical Attribute Framework (Grouped by Function)</h3>
        <p>Trainee Note: Attributes must be categorized logically to ensure data integrity[cite: 71, 72]. These groups impact search filters and customer trust[cite: 93].</p>
        
        <table border="1" style="width:100%; border-collapse: collapse; font-size: 12px; margin-top: 10px;">
            <thead>
                <tr style="background-color: #f2f2f2;">
                    <th>Attribute Name</th>
                    <th>SME Definition & Importance</th>
                    <th>Sample LOV (Real-world Examples)</th>
                    <th>Allowed LOV (Standardized Values)</th>
                    <th>UOM</th>
                    <th>Data Type</th>
                </tr>
            </thead>
            <tbody>
            [Iterate ONLY through {attr_context}. Categorize them into these groups: Identification, Physical/Dimensional, Performance, Functional, Electrical, or Safety[cite: 74, 76, 78, 80, 82, 84].]
            <tr>
                <td><strong>Attribute Name</strong></td>
                <td>Explain why this field is captured and its impact on search filters[cite: 71, 93].</td>
                <td>Provide realistic examples found on manufacturer datasheets[cite: 92].</td>
                <td>List the standardized values allowed in the system[cite: 75].</td>
                <td>Mandatory UOM (e.g., mm, W, RPM, dB, V)[cite: 77, 79, 81, 83].</td>
                <td>String, Numeric, or Boolean.</td>
            </tr>
            </tbody>
        </table>

        4. <h3>4. Content Quality Guidelines for Trainees</h3>
        <ul>
            <li><strong>Standardization:</strong> Always use standardized attribute names and UOMs[cite: 89].</li>
            <li><strong>Data Purity:</strong> Do not mix numeric and descriptive values (e.g., use "400" not "400 mm")[cite: 90].</li>
            <li><strong>Consistency:</strong> Ensure identical formatting across similar product families[cite: 91].</li>
            <li><strong>Source of Truth:</strong> Always validate data against manufacturer specifications[cite: 92].</li>
        </ul>

        Constraint: Use professional HTML only. Do NOT use Markdown.
    """

    try:
        response = model.generate_content(prompt)
        if response and response.text:
            ai_html = response.text.replace("```html", "").replace("```", "").strip()
            return jsonify({"html_content": ai_html, "raw_attributes": attributes})
        return jsonify({"error": "Empty response from AI"}), 500
    except Exception as e:
        print(f"Gemini Error: {str(e)}")
        return jsonify({"error": str(e)}), 500

@app.route('/api/kb/get_pdf', methods=['POST'])
def get_kb_pdf():
    data = request.json
    project = data.get('project', '').strip()
    category = data.get('category', '').strip()

    conn = get_db_connection()
    cur = conn.cursor()
    # Use ILIKE and strip to ensure a perfect match for those long category names
    cur.execute("""
        SELECT file_url FROM category_kb_files 
        WHERE project_name ILIKE %s AND category_name ILIKE %s
    """, (project, category))
    res = cur.fetchone()
    conn.close()
    
    return jsonify({"url": res[0] if res else None})

@app.route('/api/pending_queries', methods=['POST'])
def get_pending_queries():
    data = request.json
    email = data.get('userEmail', '').strip().lower()
    if email not in ADMIN_EMAILS:
        return jsonify({"error": "Unauthorized"}), 403
    

    current_role = 'USER'
    if email in TL_LIST: current_role = 'TL'
    elif email in PL_LIST: current_role = 'PL'
    elif email in PM_LIST: current_role = 'PM'
    elif email in SME_LIST: current_role = 'SME'

    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

    # 1. Fetch Pending Queries with correct Aliases for frontend
    if current_role == 'PL':
        query_sql = """
            SELECT id, query_text AS query, reference_url AS url, status, user_email AS asker_email, 
                   category, attribute_name AS attribute, batch_name AS batch, 
                   recipient_type AS current_stage, forwarded_by, project_name AS project,
                   sku_id, mfr_part_number, manufacturer
            FROM query_logs 
            WHERE status = 'Pending' AND (recipient_type = 'PL' OR recipient_type = 'Client_PL')
            ORDER BY created_at DESC
        """
        cur.execute(query_sql)
    else:
        query_sql = """
            SELECT id, custom_query_id, query_text AS query, reference_url AS url, status, 
               user_email AS asker_email, category, attribute_name AS attribute, 
               batch_name AS batch, recipient_type AS current_stage, 
               forwarded_by, project_name AS project,
               sku_id, mfr_part_number, manufacturer
            FROM query_logs 
            WHERE status = 'Pending' AND recipient_type = %s
            ORDER BY created_at DESC
        """
        cur.execute(query_sql, (current_role,))
    
    queries = cur.fetchall()
    for q in queries:
        q['is_admin_view'] = True # Critical for frontend routing
        q['log_type'] = 'query'

    # 2. Fetch Proposed Decisions
    dec_sql = """
        SELECT id, 
               COALESCE(project_name, 'Unknown Project') AS project, 
               COALESCE(category, 'N/A') AS category, 
               attribute_name AS attribute, 
               issue_description AS issue, 
               decision_text AS decision, 
               sku_id, mfr_part_number, manufacturer, status, 
               COALESCE(proposed_by, 'Unknown') AS asker_email
        FROM decision_logs 
        WHERE status = 'Proposed'
        ORDER BY id DESC
    """
    cur.execute(dec_sql)
    decisions = cur.fetchall()
    for d in decisions:
        d['is_decision_log'] = True
        d['log_type'] = 'decision'

    conn.close()
    return jsonify(queries + decisions)

@app.route('/api/validate', methods=['POST'])
def validate_query():
    data = request.json
    project = data.get('project', '').strip()
    batch = data.get('batch', '').strip()
    category = data.get('category', '').strip()
    attributes = data.get('attributes', [])
    request_type = data.get('request_type', 'all') 

    # ILIKE project_name is critical for matching Excel imports with spaces
    if not batch:
        filter_clause = "WHERE project_name ILIKE %s AND category ILIKE %s"
        args = [f"%{project}%", f"%{category}%"]
    else:
        filter_clause = "WHERE project_name ILIKE %s AND batch_name = %s AND category ILIKE %s"
        args = [f"%{project}%", batch, f"%{category}%"]

    if attributes:
        attr_patterns = [f"%{attr}%" for attr in attributes]
        filter_clause += " AND attribute_name ILIKE ANY(%s)"
        args.append(attr_patterns)

    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    response_payload = {"queries": [], "decisions": [], "feedbacks": []}

    try:
        # UPDATED: We now fetch decisions if request_type is 'decision', 'all', OR 'query'
        # This ensures the frontend receives decision IDs to show the cross-reference banner.
        if request_type in ['decision', 'query', 'all']:
            # Use a separate filter for decisions that ignores the 'Batch' 
            # so rules from any batch can be used as references.
            dec_filter = "WHERE project_name ILIKE %s AND category ILIKE %s"
            dec_args = [f"%{project}%", f"%{category}%"]
            if attributes:
                dec_filter += " AND attribute_name ILIKE ANY(%s)"
                dec_args.append(attr_patterns)

            sql = """
                SELECT 
                    custom_decision_id, 
                    issue_description as issue, decision_text as decision, 
                    example_value as example, reference_url as ref_link,
                    status, sku_id, mfr_part_number, manufacturer, batch_name
                FROM decision_logs 
            """
            cur.execute(f"{sql} {dec_filter}", tuple(dec_args))
            response_payload["decisions"] = cur.fetchall()

        if request_type in ['feedback', 'all']:
            cur.execute(f"SELECT feedback_text as feedback, root_cause, status, reference_url FROM feedback_logs {filter_clause}", tuple(args))
            response_payload["feedbacks"] = cur.fetchall()

        if request_type in ['query', 'all']:
            sql = """
                SELECT 
                    query_text as query, response_text as response, reference_url as url, 
                    status, id, category, attribute_name as attribute,
                    sku_id, mfr_part_number, manufacturer,batch_name, answered_by
                FROM query_logs 
            """
            # Force the cursor to refresh and pull these specific columns
            cur.execute(f"{sql} {filter_clause} LIMIT 20", tuple(args))
            response_payload["queries"] = [dict(row, is_user_view=True) for row in cur.fetchall()]

    except Exception as e:
        print(f"❌ Validation Error: {e}")
    finally:
        conn.close()

    return jsonify(response_payload)

@app.route('/api/submit_query', methods=['POST'])
def submit_query():
    data = request.json
    user_email = data.get('userEmail', '').strip().lower()
    project_name = data.get('project', 'GEN')
    
    # Process attributes to a single string for storage
    attribute_str = " | ".join(data.get('attributes', []))

    # --- 1. DYNAMIC ROUTING LOGIC ---
    if user_email in PM_LIST:
        recipient_type, notify_list = 'SME', SME_LIST
    elif user_email in PL_LIST:
        recipient_type, notify_list = 'PM', PM_LIST
    elif user_email in TL_LIST:
        recipient_type, notify_list = 'PL', PL_LIST
    else:
        recipient_type, notify_list = 'TL', TL_LIST

    conn = get_db_connection()
    cur = conn.cursor()
    
    try:
        # --- 2. UNIQUE ID GENERATION ---
        prefix = project_name[:3].upper()
        date_part = datetime.now().strftime("%m%Y")
        cur.execute("SELECT nextval('query_id_seq')")
        custom_id = f"{prefix}_{date_part}{str(cur.fetchone()[0]).zfill(3)}"

        # --- 3. DATABASE INSERTION ---
        sql = """
            INSERT INTO query_logs (
                custom_query_id, project_name, batch_name, category, 
                attribute_name, sku_id, mfr_part_number, manufacturer, 
                query_text, reference_url, status, user_email, recipient_type
            ) 
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, 'Pending', %s, %s) 
            RETURNING id
        """
        
        cur.execute(sql, (
            custom_id, project_name, data.get('batch', ''), data.get('category', ''), 
            attribute_str, data.get('sku', ''), data.get('mfr_part', ''), 
            data.get('mfr_name', ''), data.get('query', ''), data.get('url', ''), 
            user_email, recipient_type
        ))
        
        internal_id = cur.fetchone()[0]
        conn.commit()

        # --- 4. SYSTEM NOTIFICATIONS ---
        for admin_email in notify_list:
            create_system_notification(
                admin_email, 
                f"New Query {custom_id} from {user_email}", 
                internal_id
            )
            
        return jsonify({
            "status": "success", 
            "custom_id": custom_id, 
            "assigned_to": recipient_type
        })

    except Exception as e:
        conn.rollback()
        return jsonify({"status": "error", "message": str(e)}), 500
    finally:
        conn.close()

@app.route('/api/escalate_query', methods=['POST'])
def escalate_query():
    data = request.json
    query_id = data.get('queryId')
    next_role = data.get('nextRole')
    user_email = data.get('userEmail', '').lower()

    if user_email not in ADMIN_EMAILS:
        return jsonify({"status": "error", "message": "Unauthorized"}), 403

    conn = get_db_connection()
    cur = conn.cursor()
    
    # Update the recipient group and record the forwarder
    sql = "UPDATE query_logs SET recipient_type = %s, forwarded_by = %s, updated_at = NOW() WHERE id = %s"
    try:
        cur.execute(sql, (next_role, user_email, query_id))
        conn.commit()
        return jsonify({"status": "success", "message": f"Assigned to {next_role}"})
    except Exception as e:
        print(f"Escalation Error: {e}")
        return jsonify({"status": "error", "message": str(e)}), 500
    finally:
        conn.close()

@app.route('/api/respond', methods=['POST'])
def respond_query():
    responder_email = request.form.get('responderEmail', '').lower()
    query_id = request.form.get('queryId')
    response_text = request.form.get('response')
    external_link = request.form.get('link', '').strip()
    
    if responder_email not in ADMIN_EMAILS:
         return jsonify({"status": "error", "message": "Unauthorized"}), 403

    attachment_url = external_link if external_link else None
    attachment_type = 'link' if external_link else None

    if 'file' in request.files:
        file = request.files['file']
        if file and file.filename != '':
            filename = secure_filename(f"{int(time.time())}_{file.filename}")
            file.save(os.path.join(app.config['UPLOAD_FOLDER'], filename))
            attachment_url = f"https://qb.altiusnxt.tech/api/attachment/{query_id}"
            ext = filename.rsplit('.', 1)[1].lower()
            attachment_type = 'image' if ext in ['png', 'jpg', 'jpeg', 'gif'] else 'file'

    conn = get_db_connection()
    cur = conn.cursor()
    cur.execute("UPDATE query_logs SET response_text = %s, status = 'Closed', answered_by = %s, updated_at = NOW(), attachment_url = %s, attachment_type = %s WHERE id = %s RETURNING user_email, query_text", (response_text, responder_email, attachment_url, attachment_type, query_id))
    result = cur.fetchone()
    conn.commit()
    conn.close()

    if result:
        create_system_notification(result[0], f"Response Received for: {result[1][:30]}...", int(query_id))
    return jsonify({"status": "success"})

@app.route('/api/edit_query', methods=['POST'])
def edit_query():
    data = request.json
    query_id = data.get('queryId')
    new_text = data.get('newQueryText')
    user_email = data.get('userEmail', '').lower()

    # Security check: Only admins can edit queries
    if user_email not in ADMIN_EMAILS:
        return jsonify({"status": "error", "message": "Unauthorized"}), 403

    conn = get_db_connection()
    try:
        cur = conn.cursor()
        # Updates the query text in the database
        cur.execute(
            "UPDATE query_logs SET query_text = %s, updated_at = NOW() WHERE id = %s",
            (new_text, query_id)
        )
        conn.commit()
        return jsonify({"status": "success", "message": "Query updated"})
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500
    finally:
        conn.close()

@app.route('/api/create_decision', methods=['POST'])
def create_decision():
    data = request.json
    user_email = data.get('userEmail', '').lower()
    is_admin = user_email in ADMIN_EMAILS
    
    conn = get_db_connection()
    try:
        cur = conn.cursor()
        project_name = data.get('project')
        custom_id = None
        status = 'Proposed'

        # If Admin creates it, generate ID immediately and set to Active
        if is_admin:
            prefix = project_name[:3].upper()
            date_part = datetime.now().strftime("%m%Y")
            cur.execute("SELECT nextval('decision_id_seq')")
            custom_id = f"{prefix}_{date_part}{str(cur.fetchone()[0]).zfill(3)}"
            status = 'Active'

        sql = """
            INSERT INTO decision_logs 
            (custom_decision_id, project_name, category, attribute_name, issue_description, 
             decision_text, example_value, sku_id, mfr_part_number, manufacturer, proposed_by, status)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
        """
        cur.execute(sql, (
            custom_id,
            project_name,
            data.get('category'),
            data.get('attribute'),
            data.get('issue'),
            data.get('decision'),
            data.get('example'),
            data.get('sku'),
            data.get('mfr_part'),
            data.get('mfr_name'),
            user_email,
            status
        ))
        conn.commit()
        msg = "Decision created and is now Active." if is_admin else "Decision submitted for Admin approval."
        return jsonify({"status": "success", "message": msg})
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500
    finally:
        conn.close()

@app.route('/api/approve_decision', methods=['POST'])
def approve_decision():
    data = request.json
    admin_email = data.get('userEmail', '').lower()
    
    if admin_email not in ADMIN_EMAILS:
        return jsonify({"status": "error", "message": "Unauthorized"}), 403

    conn = get_db_connection()
    try:
        cur = conn.cursor()
        # Generate ID during approval
        cur.execute("SELECT project_name FROM decision_logs WHERE id = %s", (data.get('dbId'),))
        project_name = cur.fetchone()[0]
        
        prefix = project_name[:3].upper()
        date_part = datetime.now().strftime("%m%Y")
        cur.execute("SELECT nextval('decision_id_seq')")
        custom_id = f"{prefix}_{date_part}{str(cur.fetchone()[0]).zfill(3)}"

        # Update with potential edits from Admin and set to Active
        sql = """
            UPDATE decision_logs SET 
                custom_decision_id = %s,
                issue_description = %s,
                decision_text = %s,
                example_value = %s,
                sku_id = %s,
                mfr_part_number = %s,
                manufacturer = %s,
                status = 'Active'
            WHERE id = %s
        """
        cur.execute(sql, (
            custom_id, data.get('issue'), data.get('decision'), 
            data.get('example'), data.get('sku'), data.get('mfr_part'), 
            data.get('mfr_name'), data.get('dbId')
        ))
        conn.commit()
        return jsonify({"status": "success", "message": f"Approved! ID: {custom_id}"})
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500
    finally:
        conn.close()

@app.route('/api/reject_decision', methods=['POST'])
def reject_decision():
    data = request.json
    if data.get('userEmail', '').lower() not in ADMIN_EMAILS:
        return jsonify({"status": "error", "message": "Unauthorized"}), 403

    conn = get_db_connection()
    try:
        cur = conn.cursor()
        # Change status to Rejected instead of deleting so user sees it in history
        cur.execute("UPDATE decision_logs SET status = 'Rejected' WHERE id = %s", (data.get('dbId'),))
        conn.commit()
        return jsonify({"status": "success", "message": "Decision Proposal Rejected"})
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500
    finally:
        conn.close()

@app.route('/api/log_activity', methods=['POST'])
def log_activity():
    data = request.json
    try:
        conn = get_db_connection()
        cur = conn.cursor()
        
        # 1. Ensure table exists
        cur.execute("""
            CREATE TABLE IF NOT EXISTS user_activity_logs (
                id SERIAL PRIMARY KEY,
                timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                user_email TEXT,
                action_type TEXT
            )
        """)
        
        # 2. AUTOMATIC REPAIR: Add missing columns if they don't exist
        columns_to_add = [
            ("user_role", "TEXT"),
            ("project_name", "TEXT"),
            ("batch_name", "TEXT"),
            ("category", "TEXT"),
            ("attribute_name", "TEXT"),
            ("query_id", "TEXT"),
            ("query_sent_to", "TEXT"),
            ("kb_id", "TEXT"),
            ("duration", "TEXT"),
            ("turnaround_time", "TEXT")
        ]
        
        for col_name, col_type in columns_to_add:
            cur.execute(f"""
                DO $$ 
                BEGIN 
                    BEGIN
                        ALTER TABLE user_activity_logs ADD COLUMN {col_name} {col_type};
                    EXCEPTION
                        WHEN duplicate_column THEN RAISE NOTICE 'column already exists';
                    END;
                END $$;
            """)
        
        # 3. Insert the data
        query = """
            INSERT INTO user_activity_logs 
            (user_email, user_role, action_type, project_name, batch_name, 
             category, attribute_name, query_id, query_sent_to, kb_id, duration, turnaround_time)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
        """
        
        cur.execute(query, (
            str(data.get('user_email', '')),
            str(data.get('user_role', 'User')),
            str(data.get('action_type', '')),
            str(data.get('project_name', '')),
            str(data.get('batch_name', '')),
            str(data.get('category', '')),
            str(data.get('attribute_name', '')),
            str(data.get('query_id', '')),
            str(data.get('query_sent_to', '')),
            str(data.get('kb_id', '')),
            str(data.get('duration', '')),
            str(data.get('turnaround_time', ''))
        ))
        
        conn.commit()
        cur.close()
        conn.close()
        return jsonify({"status": "success"}), 200
    except Exception as e:
        print(f"❌ LOGGING ERROR: {e}")
        return jsonify({"status": "error", "message": str(e)}), 500

@app.route('/api/export_logs', methods=['GET'])
def export_logs():
    project = request.args.get('project', '').strip()
    batch = request.args.get('batch', '').strip()
    log_type = request.args.get('type', 'query') 
    
    start_date = request.args.get('start_date')
    end_date = request.args.get('end_date')

    conn = get_db_connection()
    if not conn:
        return jsonify({"error": "Database connection failed"}), 500

    try:
        if log_type == "usage":
            sql = "SELECT * FROM user_activity_logs"
            params = []
            if start_date and end_date:
                sql += " WHERE timestamp::date BETWEEN %s AND %s"
                params = [start_date, end_date]
            
            sql += " ORDER BY timestamp ASC"
            df_usage = pd.read_sql_query(sql, conn, params=params)
            
            if not df_usage.empty:
                df_usage['timestamp'] = pd.to_datetime(df_usage['timestamp']).dt.strftime('%d-%m-%Y %I:%M:%S %p')

            output = BytesIO()
            with pd.ExcelWriter(output, engine='openpyxl') as writer:
                
                # --- SHEET 1: JUST OPENED ---
                df_opened = df_usage[df_usage['action_type'] == 'Just Opened'][['timestamp', 'user_email', 'user_role']].copy()
                df_opened.to_excel(writer, index=False, sheet_name='Just Opened')

                # --- SHEET 2: CHECKED QUERY ---
                df_checked = df_usage[df_usage['action_type'] == 'Checked Query'].copy()
                df_checked.to_excel(writer, index=False, sheet_name='Checked Query')

                df_posted = df_usage[df_usage['action_type'] == 'Posted Query'][['timestamp', 'user_email', 'user_role', 'project_name', 'batch_name', 'category', 'attribute_name', 'query_id', 'query_sent_to']].copy()
                # Mapping database internal names to your Excel headers
                df_posted.columns = ['Posted Date & Time', 'User email', 'Role', 'Project', 'Batch', 'Category', 'Attribute', 'User asked query', 'Query Sent to whom']
                df_posted.to_excel(writer, index=False, sheet_name='Posted Query')

                # --- SHEET 4: RESPONSE HISTORY (Fixes empty columns) ---
                df_resp = df_usage[df_usage['action_type'] == 'Admin Responded'].copy()

                if not df_resp.empty:
                    # Column E ('query_id' in DB) maps to 'Query ID' in Excel
                    df_resp = df_resp[[
                        'timestamp', 'user_email', 'turnaround_time', 'duration', 
                        'query_id', 'project_name', 'batch_name', 'category', 'attribute_name', 'kb_id'
                    ]]
                    df_resp.columns = [
                        'Responded Date & Time', 'Responded By', 'Posted By', 
                        'Turnaround Time', 'Query ID', 'Project', 'Batch', 
                        'Category', 'Attribute', 'Response Sended'
                    ]
                
                df_resp.to_excel(writer, index=False, sheet_name='Response History')

                # --- SHEET 5: KB LOG ---
                df_kb = df_usage[df_usage['action_type'] == 'KB Log'].copy()
                df_kb.to_excel(writer, index=False, sheet_name='KB Log')
            
            output.seek(0)
            return send_file(output, mimetype='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', as_attachment=True, download_name="Global_Usage_Report.xlsx")

        # Original logic for specific Decision/Query logs (Project-specific exports)
        table = "decision_logs" if log_type == "decision" else "query_logs"
        sql = f"SELECT * FROM {table} WHERE project_name ILIKE %s"
        df = pd.read_sql_query(sql, conn, params=(f"%{project}%",))
        
        output = BytesIO()
        with pd.ExcelWriter(output, engine='openpyxl') as writer:
            df.to_excel(writer, index=False, sheet_name=f'{log_type.capitalize()} Logs')
        output.seek(0)
        return send_file(output, mimetype='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', as_attachment=True, download_name=f"{project}_{log_type}_report.xlsx")

    except Exception as e:
        print(f"❌ EXPORT ERROR: {e}")
        return jsonify({"error": str(e)}), 500
    finally:
        conn.close()
    
def trigger_scheduled_report():
    """Attempts to send the daily report. Uses file locking to prevent duplicate emails 
    if multiple server workers are running."""
    lock_file_path = os.path.join(os.getcwd(), 'query_board_report.lock')
    
    # We open (or create) the file
    f = open(lock_file_path, 'a+') # Use a+ to avoid truncating existing log
    
    if fcntl is None:
        # Windows compatibility
        print("INFO: (Windows) Sending Scheduled Report...")
        try:
            send_daily_report()
        except Exception as e:
            print(f"⚠️ Scheduled Report Error: {e}")
        return

    # Unix locking logic for production (Hostinger)
    try:
        # Try to get an EXCLUSIVE lock. 
        fcntl.flock(f, fcntl.LOCK_EX | fcntl.LOCK_NB)
        
        print("[Worker ID: {}] Lock acquired. Sending Daily Report...".format(os.getpid()))
        
        try:
            send_daily_report()
            f.write(f"\nReport sent successfully at: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
            f.flush()
        except Exception as e:
            print(f"⚠️ Scheduled Report Error: {e}")
        
        # We release the lock after sending so it can be re-locked tomorrow
        fcntl.flock(f, fcntl.LOCK_UN)

    except (IOError, OSError):
        # This means another worker process already grabbed the lock for this minute
        pass

def run_scheduler():
    """Background thread that monitors time and triggers reports."""
    print("Background Scheduler Started. Monitoring for 09:30 AM daily...")
    last_sent_date = None
    
    while True:
        try:
            now = datetime.now()
            current_time = now.strftime("%H:%M")
            current_date = now.strftime("%Y-%m-%d")
            
            # Target time from .env or default to 09:30
            target_time = os.getenv('REPORT_TIME', '09:30')
            
            # If it's the target time and we haven't sent it today
            if current_time == target_time and last_sent_date != current_date:
                trigger_scheduled_report()
                last_sent_date = current_date
                
            # Sleep for 30 seconds to avoid high CPU usage but ensure we don't miss the minute
            time.sleep(30)
        except Exception as e:
            print(f"⚠️ Scheduler Loop Error: {e}")
            time.sleep(60)

# Start the background scheduler
scheduler_thread = threading.Thread(target=run_scheduler, daemon=True)
scheduler_thread.start()

if __name__ == '__main__':
    # When running locally (python server.py), this still works.
    app.run(host='0.0.0.0', port=5005, debug=True)
