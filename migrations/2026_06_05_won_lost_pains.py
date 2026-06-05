"""
RPC rpc_won_lost_pains: pains en deals ganados vs perdidos (para el Overview).

Clasifica por deal_stage:
  won  = deal_stage contiene 'won'
  lost = deal_stage contiene 'lost'   (SIN postponed, por decisión del producto)

Devuelve top N pains con demos ganadas/perdidas + totales (para %).
Additivo, STABLE, lee de _filter_insights_norm (MV). Sin rebuild.

Usage:
    python migrations/2026_06_05_won_lost_pains.py --dry-run
    python migrations/2026_06_05_won_lost_pains.py
"""
from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

SQL = """
CREATE OR REPLACE FUNCTION rpc_won_lost_pains(f jsonb, n integer DEFAULT 8)
RETURNS TABLE(pain text, won_demos bigint, lost_demos bigint, won_total bigint, lost_total bigint)
LANGUAGE sql STABLE
AS $$
    WITH cls AS (
        SELECT transcript_id, insight_subtype_display AS pain,
               CASE
                   WHEN lower(deal_stage) LIKE '%won%' THEN 'won'
                   WHEN lower(deal_stage) LIKE '%lost%' THEN 'lost'
                   ELSE NULL
               END AS outcome
        FROM _filter_insights_norm(f)
        WHERE insight_type = 'pain'
          AND NULLIF(btrim(insight_subtype_display), '') IS NOT NULL
          AND deal_stage IS NOT NULL
    ),
    valid AS (SELECT * FROM cls WHERE outcome IS NOT NULL),
    totals AS (
        SELECT
            COUNT(DISTINCT transcript_id) FILTER (WHERE outcome = 'won')  AS won_total,
            COUNT(DISTINCT transcript_id) FILTER (WHERE outcome = 'lost') AS lost_total
        FROM valid
    ),
    per_pain AS (
        SELECT pain,
               COUNT(DISTINCT transcript_id) FILTER (WHERE outcome = 'won')::bigint  AS won_demos,
               COUNT(DISTINCT transcript_id) FILTER (WHERE outcome = 'lost')::bigint AS lost_demos
        FROM valid GROUP BY pain
    )
    SELECT pp.pain, pp.won_demos, pp.lost_demos,
           t.won_total::bigint, t.lost_total::bigint
    FROM per_pain pp CROSS JOIN totals t
    ORDER BY (pp.won_demos + pp.lost_demos) DESC, pp.pain ASC
    LIMIT n;
$$;
GRANT EXECUTE ON FUNCTION rpc_won_lost_pains(jsonb, integer) TO service_role, authenticated;
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
        cur.execute(SQL)
        conn.commit()
        print("✓ rpc_won_lost_pains creada.")
        cur.execute("SELECT pain, won_demos, lost_demos, won_total, lost_total FROM rpc_won_lost_pains('{\"prompt_version\":\"v3.0\"}'::jsonb, 8);")
        print("\nSanity (pain · won/lost demos · de totales won/lost):")
        for r in cur.fetchall():
            wp = (r[1] / r[3] * 100) if r[3] else 0
            lp = (r[2] / r[4] * 100) if r[4] else 0
            print(f"  {r[0]}: won {r[1]} ({wp:.0f}%) · lost {r[2]} ({lp:.0f}%)")
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
