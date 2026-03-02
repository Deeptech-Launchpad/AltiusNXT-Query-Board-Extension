📌 Altius Query Board

Altius Query Board is a full-stack Query & Decision Management System built with:

Frontend: Chrome Extension (Popup + Content Script)

Backend: Python Flask API

Database: PostgreSQL

Reporting: Excel-based exports (openpyxl + pandas)

The system enables structured query handling, decision tracking, escalation workflows, activity logging, and automated reporting across multiple roles (PM, PL, TL, SME, Admin).

🚀 Features
✅ Query Management

Submit structured queries with:

Project

Batch

Category

Attribute

SKU / MFR details

Auto-generate unique Query IDs

Dynamic routing based on user role

Escalation to next-level role

File or link attachments

Query editing (Admin only)

Status tracking (Pending → Closed)

✅ Decision Management

Propose decisions

Admin approval workflow

Auto-generated Decision IDs

Status types:

Proposed

Active

Rejected

✅ Role-Based Routing Logic

Dynamic assignment based on user email:

Role	Forwarded To
PM	SME
PL	PM
TL	PL
User	TL

Admins have full privileges:

Approve / Reject decisions

Edit queries

Escalate queries

Respond to queries

✅ Activity Logging (Auto-Repair Enabled)

Tracks:

Just Opened

Checked Query

Posted Query

Admin Responded

KB Log

If logging table columns are missing, the system auto-repairs schema.

✅ Excel Export System

Supports:

1️⃣ Usage Report Export

Generates multi-sheet Excel:

Just Opened

Checked Query

Posted Query

Response History

KB Log

2️⃣ Project-Specific Logs

Query Logs

Decision Logs

✅ Daily Automated Report (Startup Triggered)

Uses file locking (fcntl)

Ensures only ONE worker sends daily report

Prevents duplicate report generation in multi-worker deployments

🏗️ Project Structure
Altius Query Board/
│
├── server.py                # Main Flask backend
├── report_service.py        # Daily reporting logic
├── background.js            # Chrome extension background
├── content.js               # Injected script
├── popup.html               # Extension UI
├── popup.js                 # Extension logic
├── manifest.json            # Chrome extension config
│
├── load_data.py
├── load_schema.py
├── load_feedback.py
├── load_decisions.py
├── append_query_log.py
├── append_decision_log.py
├── append_schema.py
├── update_db.py
├── clear_db.py
│
├── requirements.txt
└── Excel reference files

🛠️ Tech Stack
Layer	Technology
Backend	Flask
Database	PostgreSQL
Reporting	pandas + openpyxl
Frontend	Chrome Extension (Manifest V3)
File Uploads	Flask Upload Folder
Deployment	Gunicorn / Linux Server
⚙️ Setup Instructions
1️⃣ Clone the Project
git clone <repository-url>
cd Altius Query Board
2️⃣ Install Dependencies
pip install -r requirements.txt
3️⃣ Configure Environment

Update database connection inside server.py:

DB_HOST=
DB_NAME=
DB_USER=
DB_PASSWORD=

Also configure:

UPLOAD_FOLDER

ADMIN_EMAILS

PM_LIST

PL_LIST

TL_LIST

SME_LIST

4️⃣ Setup PostgreSQL

Create required tables:

query_logs

decision_logs

feedback_logs

user_activity_logs

Also create sequences:

CREATE SEQUENCE query_id_seq START 1;
CREATE SEQUENCE decision_id_seq START 1;
5️⃣ Run the Backend (Local)
python server.py

Runs at:

http://localhost:5000
6️⃣ Production Deployment (Recommended)

Use Gunicorn:

gunicorn -w 4 server:app

Behind:

Nginx (reverse proxy)

SSL certificate

Systemd service (optional)

🌐 Chrome Extension Setup

Open Chrome

Go to chrome://extensions/

Enable Developer Mode

Click Load Unpacked

Select project folder

Extension is ready

📡 API Endpoints
Query APIs
Endpoint	Method	Description
/api/submit_query	POST	Submit new query
/api/escalate_query	POST	Escalate query
/api/respond	POST	Respond to query
/api/edit_query	POST	Edit query (Admin)
Decision APIs
Endpoint	Method	Description
/api/create_decision	POST	Propose decision
/api/approve_decision	POST	Approve decision
/api/reject_decision	POST	Reject decision
Logging & Reports
Endpoint	Method	Description
/api/log_activity	POST	Log user action
/api/export_logs	GET	Export Excel report
🔐 Security Model

Email-based role validation

Admin-only endpoints protected

File upload secured using secure_filename

Unauthorized access returns 403

📊 Workflow Overview
Query Lifecycle

User submits query

System assigns next-level role

Admin/Role responds

Status set to Closed

Activity logged

Report export available

📈 ID Generation Format
Query ID:
PRO_032026001

Format:

<PROJECT_PREFIX>_<MMYYYY><SEQUENCE>

Same format used for Decision IDs.

🧠 Intelligent Features

Dynamic role routing

Automated schema repair

Multi-sheet reporting

Attachment handling

Duplicate daily report prevention

📦 Dependencies

From requirements.txt:

Flask

psycopg2

pandas

openpyxl

werkzeug

gunicorn
