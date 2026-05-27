"""
Migration: create user_token_usage table.

Run once locally:
    python migrations/2026_05_27_token_usage.py

Uses SUPABASE_DB_PASSWORD via config.get_db_connection_params() — same
pattern as migrate_schema.py. Idempotent (IF NOT EXISTS).
"""
from __future__ import annotations

import os
import sys

# Permitir correr desde subdir: agregamos el root del repo al path.
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

import config
import psycopg2


SQL = """
CREATE TABLE IF NOT EXISTS user_token_usage (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_email    TEXT NOT NULL,
    timestamp     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    endpoint      TEXT NOT NULL,
    model         TEXT NOT NULL,
    input_tokens  INTEGER NOT NULL DEFAULT 0,
    output_tokens INTEGER NOT NULL DEFAULT 0,
    cost_usd      NUMERIC(10, 6) NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_user_token_usage_email_ts
    ON user_token_usage (user_email, timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_user_token_usage_ts
    ON user_token_usage (timestamp DESC);
"""


def main() -> int:
    params = config.get_db_connection_params()
    print(f"Connecting to {params['host']}:{params['port']}...")
    conn = psycopg2.connect(**params, connect_timeout=15)
    conn.autocommit = True
    cur = conn.cursor()

    try:
        cur.execute(SQL)
        print("✓ user_token_usage table + indexes ready.")
        cur.execute("SELECT COUNT(*) FROM user_token_usage")
        count = cur.fetchone()[0]
        print(f"  Current row count: {count}")
        return 0
    except Exception as exc:
        print(f"✗ Migration failed: {exc}", file=sys.stderr)
        return 1
    finally:
        cur.close()
        conn.close()


if __name__ == "__main__":
    sys.exit(main())
