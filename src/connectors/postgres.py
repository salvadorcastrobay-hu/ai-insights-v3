"""
Conector de base de datos PostgreSQL compartido para agentes y skills.

Extrae el patrón de conexión de sql_chat_agent.py en un módulo reutilizable.
"""
from __future__ import annotations

import os
import re
import time
from urllib.parse import quote_plus

import psycopg2

try:
    import streamlit as st
    _HAS_ST = True
except ImportError:
    _HAS_ST = False


def get_secret_optional(key: str) -> str | None:
    """Retorna el valor de un secret de entorno o st.secrets. None si no existe."""
    val = os.environ.get(key)
    if val:
        return val
    if _HAS_ST:
        try:
            return st.secrets[key]
        except (KeyError, FileNotFoundError):
            pass
    return None


def _build_db_url() -> str | None:
    """Construye la URL de PostgreSQL desde SUPABASE_URL + SUPABASE_DB_PASSWORD si no hay DATABASE_URL."""
    supabase_url = (get_secret_optional("SUPABASE_URL") or "").strip()
    db_password = (get_secret_optional("SUPABASE_DB_PASSWORD") or "").strip()
    if not supabase_url or not db_password:
        return None

    match = re.search(r"https://([^.]+)\.supabase\.co", supabase_url)
    if not match:
        return None
    project_ref = match.group(1)

    host = (get_secret_optional("SUPABASE_DB_HOST") or "aws-0-us-west-2.pooler.supabase.com").strip()
    port = (get_secret_optional("SUPABASE_DB_PORT") or "6543").strip()
    db_name = (get_secret_optional("SUPABASE_DB_NAME") or "postgres").strip()
    user = (get_secret_optional("SUPABASE_DB_USER") or f"postgres.{project_ref}").strip()

    return (
        "postgresql://"
        f"{quote_plus(user)}:{quote_plus(db_password)}"
        f"@{host}:{port}/{db_name}"
    )


def get_db_connection():
    """
    Retorna una conexión psycopg2 de solo lectura a la base de datos.

    Prioridad de configuración:
      1. DATABASE_URL (variable de entorno o st.secrets)
      2. SUPABASE_URL + SUPABASE_DB_PASSWORD → construye la URL automáticamente

    La conexión usa SSL (sslmode=require), es de solo lectura (readonly=True)
    y tiene autocommit=True. Reintenta hasta 3 veces ante errores de conexión.
    """
    database_url = get_secret_optional("DATABASE_URL") or _build_db_url()
    if not database_url:
        raise RuntimeError(
            "Falta configurar la conexión PostgreSQL. "
            "Opción A: DATABASE_URL. "
            "Opción B: SUPABASE_URL + SUPABASE_DB_PASSWORD."
        )

    # Ensure sslmode=require
    database_url = re.sub(r"[?&]sslmode=[^&]*", "", database_url)
    sep = "&" if "?" in database_url else "?"
    database_url = f"{database_url}{sep}sslmode=require"

    last_err = None
    for attempt in range(3):
        try:
            conn = psycopg2.connect(database_url)
            conn.set_session(readonly=True, autocommit=True)
            return conn
        except psycopg2.OperationalError as e:
            last_err = e
            if attempt < 2:
                time.sleep(1)
    raise last_err
