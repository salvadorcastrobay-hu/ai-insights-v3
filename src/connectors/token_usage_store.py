"""
Persistencia de token usage por user. Append-only.

- log_usage() — escribe una row después de cada call de OpenAI.
- get_usage_window() — suma input/output/cost de un user en una ventana temporal.
"""
from __future__ import annotations

import logging
import os
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from supabase import create_client

# Zona horaria para los cortes de ventanas calendario. Default Argentina
# porque ahí está el equipo; tunable via env si en algún momento el target
# cambia.
USAGE_TZ = ZoneInfo(os.environ.get("USAGE_TIMEZONE", "America/Argentina/Buenos_Aires"))


def _start_of_today_local() -> datetime:
    """Inicio del día actual en USAGE_TZ, expresado como UTC datetime."""
    now_local = datetime.now(USAGE_TZ)
    start_local = now_local.replace(hour=0, minute=0, second=0, microsecond=0)
    return start_local.astimezone(timezone.utc)


def _start_of_week_local() -> datetime:
    """Lunes 00:00 de esta semana en USAGE_TZ, expresado como UTC datetime."""
    now_local = datetime.now(USAGE_TZ)
    days_since_monday = now_local.weekday()  # Monday = 0
    monday_local = (now_local - timedelta(days=days_since_monday)).replace(
        hour=0, minute=0, second=0, microsecond=0
    )
    return monday_local.astimezone(timezone.utc)


def _start_of_month_local() -> datetime:
    """Día 1 00:00 de este mes en USAGE_TZ, expresado como UTC datetime."""
    now_local = datetime.now(USAGE_TZ)
    first_local = now_local.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    return first_local.astimezone(timezone.utc)

logger = logging.getLogger(__name__)

TABLE = "user_token_usage"


def _get_supabase():
    """Local helper — evitamos importar shared.py (depende de streamlit)
    para no romper el boot de FastAPI en entornos sin streamlit instalado
    o sin Streamlit Context."""
    url = os.environ.get("SUPABASE_URL")
    key = (
        os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
        or os.environ.get("SUPABASE_KEY")
    )
    if not url or not key:
        raise RuntimeError("SUPABASE_URL + SUPABASE_(SERVICE_ROLE_)KEY required.")
    return create_client(url, key)


# Precios por 1M de tokens (USD). Mantener sincronizado con
# https://openai.com/api/pricing/ — solo los modelos que efectivamente usamos.
PRICING_USD_PER_M = {
    "gpt-4o-mini":           {"input": 0.15,  "output": 0.60},
    "gpt-4o":                {"input": 2.50,  "output": 10.00},
    "gpt-4-turbo":           {"input": 10.00, "output": 30.00},
    "gpt-3.5-turbo":         {"input": 0.50,  "output": 1.50},
    "text-embedding-3-small": {"input": 0.02,  "output": 0.00},
    "text-embedding-3-large": {"input": 0.13,  "output": 0.00},
}


def compute_cost_usd(model: str, input_tokens: int, output_tokens: int) -> float:
    pricing = PRICING_USD_PER_M.get(model)
    if not pricing:
        # Fallback conservador: asumimos costo de gpt-4o-mini para evitar
        # subestimar mucho ante un modelo nuevo no listado.
        pricing = PRICING_USD_PER_M["gpt-4o-mini"]
    return (input_tokens / 1_000_000) * pricing["input"] + (output_tokens / 1_000_000) * pricing["output"]


def log_usage(
    user_email: str,
    endpoint: str,
    model: str,
    input_tokens: int,
    output_tokens: int,
) -> None:
    """Append-only log. Nunca rompe el endpoint si falla."""
    if not user_email:
        return
    try:
        cost = compute_cost_usd(model, input_tokens, output_tokens)
        _get_supabase().from_(TABLE).insert({
            "user_email": user_email,
            "endpoint": endpoint,
            "model": model,
            "input_tokens": int(input_tokens),
            "output_tokens": int(output_tokens),
            "cost_usd": float(round(cost, 6)),
        }).execute()
    except Exception as exc:
        logger.warning(f"token_usage_store.log_usage failed: {exc}")


def get_usage_window(user_email: str, since: datetime) -> dict:
    """Suma de input + output + cost en la ventana [since, now)."""
    if not user_email:
        return {"input_tokens": 0, "output_tokens": 0, "cost_usd": 0.0, "calls": 0}
    try:
        res = (
            _get_supabase()
            .from_(TABLE)
            .select("input_tokens,output_tokens,cost_usd")
            .eq("user_email", user_email)
            .gte("timestamp", since.isoformat())
            .execute()
        )
        rows = res.data or []
        input_tokens = sum(int(r.get("input_tokens", 0) or 0) for r in rows)
        output_tokens = sum(int(r.get("output_tokens", 0) or 0) for r in rows)
        cost = sum(float(r.get("cost_usd", 0) or 0) for r in rows)
        return {
            "input_tokens": input_tokens,
            "output_tokens": output_tokens,
            "cost_usd": round(cost, 4),
            "calls": len(rows),
        }
    except Exception as exc:
        logger.warning(f"token_usage_store.get_usage_window failed: {exc}")
        return {"input_tokens": 0, "output_tokens": 0, "cost_usd": 0.0, "calls": 0}


def get_usage_summary(user_email: str) -> dict:
    """Devuelve usage en 3 ventanas estándar: 24h / 7d / 30d.

    Optimización: usa get_usage_summary_aggregated() para fetchear una sola
    vez los rows de los últimos 30d y agregarlos en Python con CASE-style
    conditional sums. Antes hacía 3 queries separadas.
    """
    return get_usage_summary_aggregated(user_email)


def get_usage_summary_aggregated(user_email: str) -> dict:
    """Una sola query trae rows del mes actual; agregamos en Python para
    las 3 ventanas calendario en USAGE_TZ (default ART).

      - daily   = desde HOY 00:00 local hasta ahora
      - weekly  = desde LUNES 00:00 local hasta ahora
      - monthly = desde DÍA 1 00:00 local hasta ahora

    Reset natural a medianoche local. No ventana deslizante.
    """
    if not user_email:
        return _empty_summary()

    cutoff_today = _start_of_today_local()
    cutoff_week = _start_of_week_local()
    cutoff_month = _start_of_month_local()

    try:
        res = (
            _get_supabase()
            .from_(TABLE)
            .select("input_tokens,output_tokens,cost_usd,timestamp")
            .eq("user_email", user_email)
            .gte("timestamp", cutoff_month.isoformat())
            .execute()
        )
        rows = res.data or []
    except Exception as exc:
        logger.warning(f"token_usage_store.get_usage_summary_aggregated failed: {exc}")
        return _empty_summary()

    daily = {"input_tokens": 0, "output_tokens": 0, "cost_usd": 0.0, "calls": 0}
    weekly = {"input_tokens": 0, "output_tokens": 0, "cost_usd": 0.0, "calls": 0}
    monthly = {"input_tokens": 0, "output_tokens": 0, "cost_usd": 0.0, "calls": 0}

    for r in rows:
        i = int(r.get("input_tokens") or 0)
        o = int(r.get("output_tokens") or 0)
        c = float(r.get("cost_usd") or 0)
        ts = _parse_ts(r.get("timestamp"))
        # Monthly: todos los rows ya están en ventana del mes (filtrado en query)
        monthly["input_tokens"] += i
        monthly["output_tokens"] += o
        monthly["cost_usd"] += c
        monthly["calls"] += 1
        if ts is None:
            continue
        if ts >= cutoff_week:
            weekly["input_tokens"] += i
            weekly["output_tokens"] += o
            weekly["cost_usd"] += c
            weekly["calls"] += 1
        if ts >= cutoff_today:
            daily["input_tokens"] += i
            daily["output_tokens"] += o
            daily["cost_usd"] += c
            daily["calls"] += 1

    for w in (daily, weekly, monthly):
        w["cost_usd"] = round(w["cost_usd"], 4)

    return {"daily": daily, "weekly": weekly, "monthly": monthly}


def _parse_ts(value) -> datetime | None:
    """Parsea timestamps de Supabase (ISO 8601 con timezone) a datetime UTC."""
    if not value:
        return None
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    s = str(value).strip()
    if not s:
        return None
    # fromisoformat en Python <3.11 no soporta 'Z'; lo normalizamos.
    if s.endswith("Z"):
        s = s[:-1] + "+00:00"
    try:
        dt = datetime.fromisoformat(s)
    except ValueError:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def _empty_summary() -> dict:
    empty = {"input_tokens": 0, "output_tokens": 0, "cost_usd": 0.0, "calls": 0}
    return {"daily": dict(empty), "weekly": dict(empty), "monthly": dict(empty)}
