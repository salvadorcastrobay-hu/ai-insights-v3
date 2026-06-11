"""
Quick check: ¿existe un user en Supabase Auth?

Uso:
    python scripts/check_auth_user.py dana.goin
    python scripts/check_auth_user.py dana.goin@humand.co

Requiere SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY en env (.env).
"""
from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from dotenv import load_dotenv
from supabase import create_client


def main() -> int:
    if len(sys.argv) < 2:
        print("Usage: python scripts/check_auth_user.py <email_or_local_part>")
        return 1

    load_dotenv()

    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ.get("SUPABASE_KEY")
    if not url or not key:
        print("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in env.", file=sys.stderr)
        return 1

    query = sys.argv[1].strip().lower()
    if "@" not in query:
        query_email = f"{query}@humand.co"
    else:
        query_email = query

    client = create_client(url, key)
    # list_users devuelve paginado; pedimos 1000 por página
    page = 1
    found = None
    while True:
        res = client.auth.admin.list_users(page=page, per_page=1000)
        users = res if isinstance(res, list) else (res.users if hasattr(res, "users") else [])
        if not users:
            break
        for u in users:
            email = (getattr(u, "email", None) or "").lower()
            if email == query_email or email.split("@", 1)[0] == query:
                found = u
                break
        if found or len(users) < 1000:
            break
        page += 1

    if found:
        print(f"✓ Encontrado:")
        print(f"  id:          {found.id}")
        print(f"  email:       {found.email}")
        print(f"  created_at:  {found.created_at}")
        print(f"  last_sign_in:{getattr(found, 'last_sign_in_at', '—')}")
        confirmed = getattr(found, "email_confirmed_at", None)
        print(f"  confirmed:   {'sí' if confirmed else 'no'}  ({confirmed or '—'})")
    else:
        print(f"✗ NO existe un user con email '{query_email}' (ni local-part '{query}').")
    return 0


if __name__ == "__main__":
    sys.exit(main())
