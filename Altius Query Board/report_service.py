import psycopg2
import smtplib
import os
from datetime import datetime
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from dotenv import load_dotenv

# Force load .env inside the module
load_dotenv()

def get_db_connection():
    return psycopg2.connect(
        host=os.getenv('DB_HOST'),
        port=os.getenv('DB_PORT'),
        dbname=os.getenv('DB_NAME'),
        user=os.getenv('DB_USER'),
        password=os.getenv('DB_PASSWORD')
    )

def send_daily_report():
    print("DEBUG: Starting report generation...")
    
    # Match credentials to your specific .env keys
    smtp_server = os.getenv('SMTP_SERVER')
    smtp_port = os.getenv('SMTP_PORT')
    sender_email = os.getenv('MAIL_USERNAME')
    password = os.getenv('MAIL_PASSWORD')
    raw_recipients = os.getenv('REPORT_RECIPIENT_EMAIL', '')

    if not smtp_server or not sender_email or not password:
        print(f"❌ ERROR: Missing SMTP credentials.")
        return

    try:
        conn = get_db_connection()
        cur = conn.cursor()

        # 1. Find the last date with activity before today
        cur.execute("SELECT MAX(timestamp::date) FROM user_activity_logs WHERE timestamp::date < CURRENT_DATE")
        last_active_day = cur.fetchone()[0]

        if not last_active_day:
            print("ℹ️ No previous activity data found.")
            return

        report_date_str = last_active_day.strftime('%d-%m-%Y')

        # 2. Calculate Metrics (Using Activity Logs for all counts)
        # Just Opened
        cur.execute("SELECT COUNT(DISTINCT user_email) FROM user_activity_logs WHERE action_type = 'Just Opened' AND timestamp::date = %s", (last_active_day,))
        just_opened = cur.fetchone()[0]

        # Query Checked
        cur.execute("SELECT COUNT(DISTINCT user_email) FROM user_activity_logs WHERE action_type = 'Checked Query' AND timestamp::date = %s", (last_active_day,))
        query_checked = cur.fetchone()[0]

        # Users Posted Query
        cur.execute("SELECT COUNT(DISTINCT user_email) FROM user_activity_logs WHERE action_type = 'Posted Query' AND timestamp::date = %s", (last_active_day,))
        users_posted_count = cur.fetchone()[0]

        # No of Queries Posted
        cur.execute("SELECT COUNT(*) FROM user_activity_logs WHERE action_type = 'Posted Query' AND timestamp::date = %s", (last_active_day,))
        total_queries_posted = cur.fetchone()[0]

        # No of Queries Responded (Admin Responded action)
        cur.execute("SELECT COUNT(*) FROM user_activity_logs WHERE action_type = 'Admin Responded' AND timestamp::date = %s", (last_active_day,))
        queries_responded = cur.fetchone()[0]

        # Knowledge-Based Visited
        cur.execute("SELECT COUNT(DISTINCT user_email) FROM user_activity_logs WHERE action_type = 'KB Log' AND timestamp::date = %s", (last_active_day,))
        kb_visited = cur.fetchone()[0]

        # 3. Construct Email with exact structure requested
        recipient_list = [e.strip() for e in raw_recipients.split(',') if e.strip()]
        
        msg = MIMEMultipart()
        msg['From'] = f"Query Board Support <{sender_email}>"
        msg['To'] = "Undisclosed-Recipients:;" 
        msg['Subject'] = f"Query Board - Daily User Activity Summary - {report_date_str}"

        html_body = f"""
        <html>
        <body style="font-family: 'Segoe UI', Arial, sans-serif; color: #333; line-height: 1.6;">
            <p>Dear Sir/Madam,</p>

            <p>Please find below the user access summary details of Query Board application for your reference</p>

            <h3 style="color: #4d02a3; margin-top: 25px; margin-bottom: 10px;">Summary as on {report_date_str}</h3>
            
            <table border="1" style="border-collapse: collapse; width: 500px; text-align: left; border: 1px solid #ccc;">
                <thead style="background-color: #f5f5f5;">
                    <tr>
                        <th style="padding: 10px; border: 1px solid #ccc; width: 70%;">Description</th>
                        <th style="padding: 10px; border: 1px solid #ccc; width: 30%;">No of Users/Count</th>
                    </tr>
                </thead>
                <tbody>
                    <tr><td style="padding: 8px; border: 1px solid #ccc;">Just Opened</td><td style="padding: 8px; border: 1px solid #ccc;">{just_opened}</td></tr>
                    <tr><td style="padding: 8px; border: 1px solid #ccc;">Query Checked</td><td style="padding: 8px; border: 1px solid #ccc;">{query_checked}</td></tr>
                    <tr><td style="padding: 8px; border: 1px solid #ccc;">Users Posted Query</td><td style="padding: 8px; border: 1px solid #ccc;">{users_posted_count}</td></tr>
                    <tr><td style="padding: 8px; border: 1px solid #ccc;">No of Queries Posted</td><td style="padding: 8px; border: 1px solid #ccc;">{total_queries_posted}</td></tr>
                    <tr><td style="padding: 8px; border: 1px solid #ccc;">No of Queries Responded</td><td style="padding: 8px; border: 1px solid #ccc;">{queries_responded}</td></tr>
                    <tr><td style="padding: 8px; border: 1px solid #ccc;">Knowledge-Based Visited</td><td style="padding: 8px; border: 1px solid #ccc;">{kb_visited}</td></tr>
                </tbody>
            </table>

            <p style="margin-top: 30px;">Regards,</p>
            <p style="margin-top: 0;"><strong>Tech Support Team</strong><br>
            AltiusNxt</p>

            <div style="margin-top: 40px; border-top: 1px solid #eee; padding-top: 10px; font-size: 12px; color: #666;">
                <p><strong>Note:</strong> This is an automatically generated email from the system as part of the scheduled reporting process. 
                Please do not reply to this email. If you have any questions, kindly contact the Tech team.</p>
            </div>
        </body>
        </html>
        """
        msg.attach(MIMEText(html_body, 'html'))

        # 4. Send via SMTP
        server = smtplib.SMTP(smtp_server, int(smtp_port))
        server.starttls()
        server.login(sender_email, password)
        server.sendmail(sender_email, recipient_list, msg.as_string())
        server.quit()

        print(f"✅ Auto-Report successfully sent for {report_date_str}")

    except Exception as e:
        print(f"❌ Email Report Error: {e}")
    finally:
        if 'cur' in locals(): cur.close()
        if 'conn' in locals(): conn.close()