"""Add segment/tier/employee_range columns and update view."""
import config
import psycopg2

db_params = config.get_db_connection_params()
print(f"Connecting to {db_params['host']}:{db_params['port']}...")

conn = psycopg2.connect(**db_params, connect_timeout=10)
conn.autocommit = True
cur = conn.cursor()

# Add new columns to raw_deals
for col in ["segment TEXT", "tier TEXT"]:
    col_name = col.split()[0]
    try:
        cur.execute(f"ALTER TABLE raw_deals ADD COLUMN {col}")
        print(f"Added raw_deals.{col_name}")
    except psycopg2.errors.DuplicateColumn:
        print(f"raw_deals.{col_name} already exists")
        conn.rollback()

# Add new columns to raw_companies
for col in ["segment TEXT", "employee_range TEXT"]:
    col_name = col.split()[0]
    try:
        cur.execute(f"ALTER TABLE raw_companies ADD COLUMN {col}")
        print(f"Added raw_companies.{col_name}")
    except psycopg2.errors.DuplicateColumn:
        print(f"raw_companies.{col_name} already exists")
        conn.rollback()

# Update the view
cur.execute("""
CREATE OR REPLACE VIEW v_transcripts AS
SELECT
    t.recording_id AS transcript_id,
    t.transcript_text,
    m.matched_deal_id AS deal_id,
    d.deal_name,
    c.name AS company_name,
    c.region,
    c.country,
    c.industry,
    c.company_size,
    c.segment AS company_segment,
    c.employee_range,
    d.segment AS deal_segment,
    d.tier,
    d.deal_stage,
    d.pipeline,
    d.amount,
    d.owner_name AS deal_owner,
    t.call_date::date AS call_date,
    m.match_method,
    m.match_score
FROM raw_transcripts t
LEFT JOIN call_deal_matches m ON t.recording_id = m.recording_id
LEFT JOIN raw_deals d ON m.matched_deal_id = d.deal_id
LEFT JOIN raw_companies c ON c.company_id = (d.associated_company_ids[1])
WHERE t.team = 'Account Executives'
""")
print("View v_transcripts updated")

# Add fathom_summary column to raw_transcripts
try:
    cur.execute("ALTER TABLE raw_transcripts ADD COLUMN fathom_summary TEXT")
    print("Added raw_transcripts.fathom_summary")
except psycopg2.errors.DuplicateColumn:
    print("raw_transcripts.fathom_summary already exists")
    conn.rollback()

cur.close()
conn.close()
print("Done!")
