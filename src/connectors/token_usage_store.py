"""
Persistencia de token usage por user. Append-only.

- log_usage() — escribe una row después de cada call de OpenAI.
- get_usage_window() — suma input/output/cost de un user en una ventana temporal.
"""
from __future__ import annotations

import logging
import os
from datetime import datetime, timedelta, timezone

from supabase import create_client

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
    """Devuelve usage en 3 ventanas estándar: 24h / 7d / 30d."""
    now = datetime.now(timezone.utc)
    return {
        "daily":   get_usage_window(user_email, now - timedelta(hours=24)),
        "weekly":  get_usage_window(user_email, now - timedelta(days=7)),
        "monthly": get_usage_window(user_email, now - timedelta(days=30)),
    }
