import os
from dotenv import load_dotenv

load_dotenv()

# Supabase
SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_KEY"]
SUPABASE_DB_PASSWORD = os.getenv("SUPABASE_DB_PASSWORD", "")

def get_db_connection_params() -> dict:
    """Extract PostgreSQL connection params from SUPABASE_URL."""
    # SUPABASE_URL is like https://xxxxx.supabase.co
    # DB host is db.xxxxx.supabase.co
    import re
    match = re.search(r"https://([^.]+)\.supabase\.co", SUPABASE_URL)
    project_ref = match.group(1) if match else ""
    return {
        "host": f"db.{project_ref}.supabase.co",
        "port": 5432,
        "database": "postgres",
        "user": "postgres",
        "password": SUPABASE_DB_PASSWORD,
    }

# Fathom
FATHOM_API_KEY = os.getenv("FATHOM_API_KEY", "")
FATHOM_TEAM_FILTER = os.getenv("FATHOM_TEAM_FILTER", "Account Executives")

# HubSpot
HUBSPOT_API_KEY = os.getenv("HUBSPOT_API_KEY", "")

# OpenAI
OPENAI_API_KEY = os.environ["OPENAI_API_KEY"]
OPENAI_MODEL = os.getenv("OPENAI_MODEL", "gpt-4o-mini")
OPENAI_CHAT_AGENT_MODEL = os.getenv("OPENAI_CHAT_AGENT_MODEL", "gpt-4o")

# Pipeline
TRANSCRIPT_VIEW_NAME = os.getenv("TRANSCRIPT_VIEW_NAME", "v_transcripts")
BATCH_POLL_INTERVAL = int(os.getenv("BATCH_POLL_INTERVAL", "60"))
MAX_TOKENS_PER_CHUNK = int(os.getenv("MAX_TOKENS_PER_CHUNK", "12000"))
PROMPT_VERSION_BASE = os.getenv("PROMPT_VERSION", "v2.0")

# Paths
STATE_FILE = os.path.join(os.path.dirname(__file__), "state.json")
BATCH_DIR = os.path.join(os.path.dirname(__file__), "batches")
SCHEMA_FILE = os.path.join(os.path.dirname(__file__), "schema.sql")
REFINEMENTS_FILE = os.path.join(os.path.dirname(__file__), "prompt_refinements.json")


def get_prompt_version() -> str:
    """Return prompt version with QA refinement suffix if active."""
    import json
    if os.path.exists(REFINEMENTS_FILE):
        try:
            with open(REFINEMENTS_FILE, "r") as f:
                data = json.load(f)
            revision = data.get("revision", 1)
            return f"{PROMPT_VERSION_BASE}+qa{revision}"
        except Exception:
            pass
    return PROMPT_VERSION_BASE


PROMPT_VERSION = get_prompt_version()
