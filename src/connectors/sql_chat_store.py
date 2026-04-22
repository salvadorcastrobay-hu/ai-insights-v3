"""
Persistencia append-only para Chat con IA en Supabase.
"""
from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from uuid import uuid4

from shared import get_supabase


CONVERSATIONS_TABLE = "sql_chat_conversations"
MESSAGES_TABLE = "sql_chat_messages_store"
SNAPSHOTS_TABLE = "sql_chat_snapshots"


def _client():
    return get_supabase()


def _normalize_owner_candidates(owner) -> list[str]:
    if owner is None:
        return []
    if isinstance(owner, (list, tuple, set)):
        values = owner
    else:
        values = [owner]
    out = []
    for value in values:
        cleaned = str(value or "").strip()
        if cleaned and cleaned not in out:
            out.append(cleaned)
    return out


def _iso_now() -> str:
    return datetime.utcnow().isoformat() + "Z"


def _json_safe(value):
    if isinstance(value, dict):
        return {str(key): _json_safe(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_json_safe(item) for item in value]
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, date):
        return value.isoformat()
    if isinstance(value, Decimal):
        return float(value)
    return value


def _conversation_title(question: str) -> str:
    cleaned = " ".join((question or "").strip().split())
    if not cleaned:
        return "Chat con IA"
    return cleaned[:80]


def create_conversation(owner: str, question: str) -> str:
    conversation_id = str(uuid4())
    _client().table(CONVERSATIONS_TABLE).insert(
        {
            "id": conversation_id,
            "owner": owner,
            "title": _conversation_title(question),
            "initial_question": question,
            "created_at": _iso_now(),
        }
    ).execute()
    return conversation_id


def insert_message(conversation_id: str, owner: str, role: str, payload: dict) -> None:
    _client().table(MESSAGES_TABLE).insert(
        {
            "id": str(uuid4()),
            "conversation_id": conversation_id,
            "owner": owner,
            "role": role,
            "payload": _json_safe(payload),
            "created_at": _iso_now(),
        }
    ).execute()


def insert_snapshot(conversation_id: str, owner: str, messages: list[dict], openai_history: list[dict]) -> None:
    _client().table(SNAPSHOTS_TABLE).insert(
        {
            "id": str(uuid4()),
            "conversation_id": conversation_id,
            "owner": owner,
            "messages": _json_safe(messages),
            "openai_history": _json_safe(openai_history),
            "created_at": _iso_now(),
        }
    ).execute()


def list_conversations(owner, limit: int = 20) -> list[dict]:
    owners = _normalize_owner_candidates(owner)
    if not owners:
        return []
    query = _client().table(CONVERSATIONS_TABLE).select("id,title,initial_question,created_at").order(
        "created_at", desc=True
    )
    if len(owners) == 1:
        query = query.eq("owner", owners[0])
    else:
        query = query.in_("owner", owners)
    return query.limit(limit).execute().data or []


def rename_conversation(owner, conversation_id: str, new_title: str) -> bool:
    owners = _normalize_owner_candidates(owner)
    if not owners:
        return False
    query = _client().table(CONVERSATIONS_TABLE).update({"title": new_title}).eq("id", conversation_id)
    if len(owners) == 1:
        query = query.eq("owner", owners[0])
    else:
        query = query.in_("owner", owners)
    response = query.execute()
    return bool(response.data)


def delete_conversation(owner, conversation_id: str) -> bool:
    owners = _normalize_owner_candidates(owner)
    if not owners:
        return False
    # Delete children first (defensive; FK on delete may not be set in schema)
    for table in (MESSAGES_TABLE, SNAPSHOTS_TABLE):
        child_query = _client().table(table).delete().eq("conversation_id", conversation_id)
        if len(owners) == 1:
            child_query = child_query.eq("owner", owners[0])
        else:
            child_query = child_query.in_("owner", owners)
        try:
            child_query.execute()
        except Exception:
            pass
    query = _client().table(CONVERSATIONS_TABLE).delete().eq("id", conversation_id)
    if len(owners) == 1:
        query = query.eq("owner", owners[0])
    else:
        query = query.in_("owner", owners)
    response = query.execute()
    return bool(response.data)


def load_conversation(owner, conversation_id: str) -> dict | None:
    owners = _normalize_owner_candidates(owner)
    if not owners:
        return None

    conversation_query = _client().table(CONVERSATIONS_TABLE).select("*").eq("id", conversation_id)
    if len(owners) == 1:
        conversation_query = conversation_query.eq("owner", owners[0])
    else:
        conversation_query = conversation_query.in_("owner", owners)
    conversations = conversation_query.limit(1).execute().data or []
    if not conversations:
        return None

    snapshot_query = _client().table(SNAPSHOTS_TABLE).select("*").eq("conversation_id", conversation_id)
    if len(owners) == 1:
        snapshot_query = snapshot_query.eq("owner", owners[0])
    else:
        snapshot_query = snapshot_query.in_("owner", owners)
    snapshots = snapshot_query.order("created_at", desc=True).limit(1).execute().data or []
    if not snapshots:
        return None

    return {
        "conversation": conversations[0],
        "snapshot": snapshots[0],
        "messages": list(snapshots[0].get("messages") or []),
        "openai_history": list(snapshots[0].get("openai_history") or []),
    }
