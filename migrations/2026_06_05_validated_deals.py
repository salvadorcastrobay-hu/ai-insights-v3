"""
RPC para contar deals "validados" (first_meeting_status = 'Validated').

first_meeting_status vive en raw_deals.properties (jsonb doble-encodeada).
_deal_prop decodifica y extrae cualquier key. rpc_validated_deals cuenta
deals distintos validados respetando los filtros del dashboard (vía
_filter_insights_norm) + join a raw_deals. Additivo, sin rebuild de MV.

Usage:
    python migrations/2026_06_05_validated_deals.py --dry-run
    python migrations/2026_06_05_validated_deals.py
"""
from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

SQL = """
-- Extrae una key de raw_deals.properties (maneja el doble-encoding jsonb-string).
CREATE OR REPLACE FUNCTION _deal_prop(props jsonb, k text)
RETURNS text
LANGUAGE plpgsql IMMUTABLE
AS $$
DECLARE p jsonb;
BEGIN
    IF props IS NULL THEN RETURN NULL; END IF;
    IF jsonb_typeof(props) = 'string' THEN
        BEGIN p := (props #>> '{}')::jsonb; EXCEPTION WHEN others THEN RETURN NULL; END;
    ELSE
        p := props;
    END IF;
    RETURN p ->> k;
END;
$$;

-- Cuenta deals distintos validados (first_meeting_status='Validated') que
-- matchean los filtros del dashboard.
CREATE OR REPLACE FUNCTION rpc_validated_deals(f jsonb)
RETURNS bigint
LANGUAGE sql STABLE
AS $$
    SELECT COUNT(DISTINCT t.deal_id)::bigint
    FROM _filter_insights_norm(f) t
    JOIN raw_deals d ON d.deal_id = t.deal_id
    WHERE t.deal_id IS NOT NULL
      AND _deal_prop(d.properties, 'first_meeting_status') = 'Validated';
$$;

GRANT EXECUTE ON FUNCTION _deal_prop(jsonb, text) TO service_role, authenticated;
GRANT EXECUTE ON FUNCTION rpc_validated_deals(jsonb) TO service_role, authenticated;
NOTIFY pgrst, 'reload schema';
"""


def main() -> int:
    if "--dry-run" in sys.argv:
        print(SQL)
        return 0
    import config  # noqa
    import psycopg2  # noqa

    params = config.get_db_connection_params()
    print(f"Connecting to {params['host']}:{params['port']}...")
    conn = psycopg2.connect(**params, connect_timeout=15)
    conn.autocommit = False
    cur = conn.cursor()
    try:
        cur.execute("SET statement_timeout = '120s';")
        cur.execute(SQL)
        conn.commit()
        print("✓ _deal_prop + rpc_validated_deals creadas.")
        f = "'{\"prompt_version\":\"v3.0\"}'::jsonb"
        cur.execute(f"SELECT rpc_validated_deals({f});")
        validated = cur.fetchone()[0]
        cur.execute(
            "SELECT COUNT(DISTINCT deal_id) FROM _filter_insights_norm('{\"prompt_version\":\"v3.0\"}'::jsonb) WHERE deal_id IS NOT NULL;"
        )
        total = cur.fetchone()[0]
        print(f"\nSanity (all-time): {validated} validados / {total} deals con demo "
              f"({(validated/total*100 if total else 0):.0f}%)")
        return 0
    except Exception as exc:
        conn.rollback()
        print(f"\n✗ Falló (rollback): {exc}", file=sys.stderr)
        return 1
    finally:
        cur.close()
        conn.close()


if __name__ == "__main__":
    sys.exit(main())
