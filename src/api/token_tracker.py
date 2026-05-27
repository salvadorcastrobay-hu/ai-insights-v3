"""
Tracker de tokens por user, con quota check + auto-logging via monkey-patch
del OpenAI client.

Flujo:
  1. En cada FastAPI endpoint chat-y, set_request_context(owner, endpoint).
  2. check_quota(owner) lanza HTTPException 429 si superó el cap diario.
  3. El monkey-patch en client.chat.completions.create() loguea usage real
     después de cada respuesta de OpenAI, leyendo owner del contextvar.

Diseño: GATED. Solo enforza limits a usuarios en TOKEN_LIMITS_USERS.
Para el resto solo logea (zero impact en su experiencia).
"""
from __future__ import annotations

import contextvars
import logging
import os
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException

from src.connectors.token_usage_store import get_usage_window, log_usage

logger = logging.getLogger(__name__)

# ─── Config ─────────────────────────────────────────────────────────────
# Caps INICIALES generosos. Calibrar después de 1 semana de uso real.
DAILY_TOKEN_LIMIT   = int(os.getenv("DAILY_TOKEN_LIMIT",   "150000"))   # ~$0.15/día (mini)
WEEKLY_TOKEN_LIMIT  = int(os.getenv("WEEKLY_TOKEN_LIMIT",  "700000"))
MONTHLY_TOKEN_LIMIT = int(os.getenv("MONTHLY_TOKEN_LIMIT", "2000000"))

# Comma-separated emails (local-part, sin @humand.co) con enforcement activo.
# Vacío = no enforza a nadie (solo loguea).
_enabled_users_raw = os.getenv("TOKEN_LIMITS_USERS", "salvador.castrobay")
ENABLED_USERS = {u.strip().lower() for u in _enabled_users_raw.split(",") if u.strip()}

# ─── Request-scoped context ─────────────────────────────────────────────
_current_owner: contextvars.ContextVar[str | None] = contextvars.ContextVar(
    "current_owner", default=None
)
_current_endpoint: contextvars.ContextVar[str | None] = contextvars.ContextVar(
    "current_endpoint", default=None
)


def set_request_context(owner: str, endpoint: str) -> None:
    """Llamar al inicio del handler FastAPI."""
    _current_owner.set(owner)
    _current_endpoint.set(endpoint)


def clear_request_context() -> None:
    _current_owner.set(None)
    _current_endpoint.set(None)


def is_enforcement_enabled(owner: str | None) -> bool:
    if not owner:
        return False
    return owner.lower() in ENABLED_USERS


# ─── Quota check ─────────────────────────────────────────────────────────

def check_quota(owner: str) -> None:
    """Raise HTTPException(429) si superó algún cap. No-op si no enforced."""
    if not is_enforcement_enabled(owner):
        return
    now = datetime.now(timezone.utc)
    daily = get_usage_window(owner, now - timedelta(hours=24))
    daily_tokens = daily["input_tokens"] + daily["output_tokens"]
    if daily_tokens >= DAILY_TOKEN_LIMIT:
        raise HTTPException(
            status_code=429,
            detail={
                "error": "daily_token_limit_reached",
                "message": "Llegaste al límite diario de tokens. Resetea en 24h.",
                "used": daily_tokens,
                "limit": DAILY_TOKEN_LIMIT,
            },
        )

    weekly = get_usage_window(owner, now - timedelta(days=7))
    weekly_tokens = weekly["input_tokens"] + weekly["output_tokens"]
    if weekly_tokens >= WEEKLY_TOKEN_LIMIT:
        raise HTTPException(
            status_code=429,
            detail={
                "error": "weekly_token_limit_reached",
                "message": "Llegaste al límite semanal de tokens.",
                "used": weekly_tokens,
                "limit": WEEKLY_TOKEN_LIMIT,
            },
        )

    monthly = get_usage_window(owner, now - timedelta(days=30))
    monthly_tokens = monthly["input_tokens"] + monthly["output_tokens"]
    if monthly_tokens >= MONTHLY_TOKEN_LIMIT:
        raise HTTPException(
            status_code=429,
            detail={
                "error": "monthly_token_limit_reached",
                "message": "Llegaste al límite mensual de tokens.",
                "used": monthly_tokens,
                "limit": MONTHLY_TOKEN_LIMIT,
            },
        )


# ─── Auto-logging via monkey-patch del OpenAI client ────────────────────

def _install_openai_patch() -> None:
    """
    Patcha openai.resources.chat.completions.Completions.create para
    loguear usage real después de cada respuesta. Idempotente.
    """
    try:
        from openai.resources.chat.completions import Completions
    except Exception as exc:
        logger.warning(f"OpenAI Completions class not importable: {exc}")
        return

    if getattr(Completions, "_token_tracker_patched", False):
        return

    _original_create = Completions.create

    def _tracked_create(self, *args, **kwargs):
        response = _original_create(self, *args, **kwargs)
        try:
            owner = _current_owner.get()
            endpoint = _current_endpoint.get() or "unknown"
            if owner and getattr(response, "usage", None):
                model = kwargs.get("model") or "unknown"
                log_usage(
                    user_email=owner,
                    endpoint=endpoint,
                    model=str(model),
                    input_tokens=int(response.usage.prompt_tokens or 0),
                    output_tokens=int(response.usage.completion_tokens or 0),
                )
        except Exception as exc:
            logger.debug(f"token_tracker logging skipped: {exc}")
        return response

    Completions.create = _tracked_create
    Completions._token_tracker_patched = True
    logger.info("OpenAI Completions.create patched for token tracking.")


# Auto-instalar al importar el módulo
_install_openai_patch()


# ─── Usage summary para el endpoint /api/usage/me ───────────────────────

def get_usage_summary_for(owner: str) -> dict:
    """Estructura para el frontend: usage por ventana + limits + porcentajes."""
    now = datetime.now(timezone.utc)
    daily = get_usage_window(owner, now - timedelta(hours=24))
    weekly = get_usage_window(owner, now - timedelta(days=7))
    monthly = get_usage_window(owner, now - timedelta(days=30))

    def _pack(usage: dict, limit: int) -> dict:
        used = usage["input_tokens"] + usage["output_tokens"]
        pct = round(100.0 * used / limit, 1) if limit > 0 else 0.0
        return {
            "used_tokens": used,
            "limit_tokens": limit,
            "pct": min(100.0, pct),
            "cost_usd": usage["cost_usd"],
            "calls": usage["calls"],
        }

    return {
        "owner": owner,
        "enforcement_enabled": is_enforcement_enabled(owner),
        "daily":   _pack(daily,   DAILY_TOKEN_LIMIT),
        "weekly":  _pack(weekly,  WEEKLY_TOKEN_LIMIT),
        "monthly": _pack(monthly, MONTHLY_TOKEN_LIMIT),
    }
