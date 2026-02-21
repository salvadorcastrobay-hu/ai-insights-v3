"""
Fathom API client: fetch meetings and transcripts.
API docs: https://developers.fathom.ai/
"""

from __future__ import annotations

import logging
import time
from typing import Any

import requests
from tenacity import retry, stop_after_attempt, wait_exponential

from src import config

logger = logging.getLogger(__name__)

BASE_URL = "https://api.fathom.ai/external/v1"


def _headers() -> dict:
    return {"X-Api-Key": config.FATHOM_API_KEY}


@retry(stop=stop_after_attempt(3), wait=wait_exponential(min=2, max=30))
def _get(endpoint: str, params: dict | None = None) -> dict:
    """Make a GET request to the Fathom API with rate limit handling."""
    url = f"{BASE_URL}{endpoint}"
    resp = requests.get(url, headers=_headers(), params=params or {}, timeout=30)

    if resp.status_code == 429:
        retry_after = int(resp.headers.get("RateLimit-Reset", 10))
        logger.warning(f"Rate limited, waiting {retry_after}s...")
        time.sleep(retry_after)
        raise Exception("Rate limited")

    resp.raise_for_status()
    return resp.json()


def fetch_summary(recording_id: str) -> str | None:
    """
    Fetch the native Fathom summary for a recording.

    Returns the markdown-formatted summary, or None if unavailable.
    """
    try:
        data = _get(f"/recordings/{recording_id}/summary")
        return data.get("summary", {}).get("markdown_formatted")
    except Exception as e:
        logger.debug(f"No summary for {recording_id}: {e}")
        return None


def fetch_meetings(
    team: str | None = None,
    since: str | None = None,
    include_transcript: bool = True,
) -> list[dict]:
    """
    Fetch all meetings from Fathom, with pagination.

    Args:
        team: Team name filter (default: from config)
        since: ISO 8601 date string, fetch meetings after this date
        include_transcript: Include full transcript in response

    Returns:
        List of meeting objects with transcript and participant data.
    """
    team = team or config.FATHOM_TEAM_FILTER
    all_meetings = []
    cursor = None

    while True:
        params = {
            "teams[]": team,
            "include_transcript": str(include_transcript).lower(),
            "include_crm_matches": "true",
            "limit": "100",
        }
        if since:
            params["created_after"] = since
        if cursor:
            params["cursor"] = cursor

        data = _get("/meetings", params)
        meetings = data.get("items", [])

        if not meetings:
            logger.info("No more meetings to fetch")
            break

        all_meetings.extend(meetings)
        logger.info(f"Fetched {len(meetings)} meetings (total: {len(all_meetings)})")

        cursor = data.get("next_cursor")
        if not cursor:
            break

        # Respect rate limit: 60 req/min
        time.sleep(1)

    # Fetch summaries for each meeting
    logger.info(f"Fetching summaries for {len(all_meetings)} meetings...")
    for i, m in enumerate(all_meetings):
        rid = str(m.get("recording_id", ""))
        if rid:
            m["_fathom_summary"] = fetch_summary(rid)
            time.sleep(0.5)  # Respect rate limit
        if (i + 1) % 20 == 0:
            logger.info(f"  Summaries fetched: {i + 1}/{len(all_meetings)}")

    return all_meetings


def parse_meeting(meeting: dict) -> dict:
    """
    Parse a Fathom meeting into a normalized dict for storage.

    Returns dict ready for raw_transcripts table.
    """
    recording_id = str(meeting.get("recording_id", ""))

    # Extract participants
    invitees = meeting.get("calendar_invitees", [])
    participants = []
    external_domains = set()

    for inv in invitees:
        p = {
            "name": inv.get("name"),
            "email": inv.get("email"),
            "domain": inv.get("email_domain"),
            "is_external": inv.get("is_external", False),
        }
        participants.append(p)
        if p["is_external"] and p["domain"]:
            external_domains.add(p["domain"])

    # Build transcript text from segments
    transcript_json = meeting.get("transcript", [])
    transcript_text = _build_transcript_text(transcript_json)

    # Recorder info
    recorder = meeting.get("recorded_by", {})

    # Dates
    call_date = (
        meeting.get("recording_start_time")
        or meeting.get("scheduled_start_time")
        or meeting.get("created_at")
    )

    # Duration
    start = meeting.get("recording_start_time")
    end = meeting.get("recording_end_time")
    duration = None
    if start and end:
        from datetime import datetime
        try:
            t_start = datetime.fromisoformat(start.replace("Z", "+00:00"))
            t_end = datetime.fromisoformat(end.replace("Z", "+00:00"))
            duration = int((t_end - t_start).total_seconds())
        except (ValueError, TypeError):
            pass

    return {
        "recording_id": recording_id,
        "title": meeting.get("title"),
        "meeting_title": meeting.get("meeting_title"),
        "fathom_url": meeting.get("url"),
        "recorded_by_email": recorder.get("email"),
        "recorded_by_name": recorder.get("name"),
        "team": recorder.get("team"),
        "call_date": call_date,
        "duration_seconds": duration,
        "transcript_text": transcript_text,
        "transcript_json": transcript_json,
        "participants": participants,
        "external_domains": list(external_domains),
        "fathom_crm_matches": meeting.get("crm_matches"),
        "fathom_summary": meeting.get("_fathom_summary"),
    }


def _build_transcript_text(transcript_segments: list[dict]) -> str:
    """Convert transcript segments into a readable text format."""
    if not transcript_segments:
        return ""

    lines = []
    current_speaker = None

    for seg in transcript_segments:
        speaker_info = seg.get("speaker", {})
        speaker_name = speaker_info.get("display_name", "Unknown")
        text = seg.get("text", "").strip()
        timestamp = seg.get("timestamp", "")

        if not text:
            continue

        if speaker_name != current_speaker:
            current_speaker = speaker_name
            lines.append(f"\n{speaker_name} [{timestamp}]:")

        lines.append(f"  {text}")

    return "\n".join(lines).strip()


def get_transcript_for_recording(recording_id: str) -> list[dict]:
    """Fetch transcript separately for a specific recording (fallback)."""
    data = _get(f"/recordings/{recording_id}/transcript")
    return data.get("transcript", data if isinstance(data, list) else [])
