"""
Token-aware chunking for transcripts.
Splits long transcripts at speaker turn boundaries to stay under MAX_TOKENS_PER_CHUNK.
"""

from __future__ import annotations

import logging
import re

import tiktoken

import config

logger = logging.getLogger(__name__)

# Use cl100k_base encoding (used by gpt-4o and gpt-4o-mini)
_encoding = tiktoken.get_encoding("cl100k_base")

# Patterns that indicate a speaker turn boundary
SPEAKER_PATTERN = re.compile(
    r"^(?:"
    r"[A-Z][a-zA-Z\s]*?:"        # "Speaker Name:"
    r"|Speaker\s*\d+:"            # "Speaker 1:"
    r"|\[[^\]]+\]:"               # "[Speaker]:"
    r"|\d{1,2}:\d{2}"             # "12:34" timestamp
    r")",
    re.MULTILINE,
)


def count_tokens(text: str) -> int:
    return len(_encoding.encode(text))


def chunk_transcript(
    transcript_id: str,
    text: str,
    max_tokens: int | None = None,
) -> list[dict]:
    """
    Split a transcript into chunks that fit within max_tokens.

    Returns a list of dicts: {"chunk_index": int, "text": str, "token_count": int}

    Strategy:
    1. If the full text fits, return a single chunk.
    2. Otherwise, split at speaker turn boundaries.
    3. Greedily accumulate turns until adding the next would exceed the limit.
    """
    if max_tokens is None:
        max_tokens = config.MAX_TOKENS_PER_CHUNK

    total_tokens = count_tokens(text)

    if total_tokens <= max_tokens:
        return [{"chunk_index": 0, "text": text, "token_count": total_tokens}]

    # Split into speaker turns
    turns = _split_into_turns(text)

    if len(turns) <= 1:
        # No speaker turns found, fall back to line-based splitting
        turns = _split_into_lines(text)

    chunks = []
    current_lines: list[str] = []
    current_tokens = 0

    for turn in turns:
        turn_tokens = count_tokens(turn)

        # If a single turn exceeds max_tokens, split it further
        if turn_tokens > max_tokens:
            # Flush current buffer first
            if current_lines:
                chunk_text = "\n".join(current_lines)
                chunks.append({
                    "chunk_index": len(chunks),
                    "text": chunk_text,
                    "token_count": count_tokens(chunk_text),
                })
                current_lines = []
                current_tokens = 0

            # Split the oversized turn by lines
            sub_parts = _split_into_lines(turn)
            for part in sub_parts:
                part_tokens = count_tokens(part)
                if current_tokens + part_tokens > max_tokens and current_lines:
                    chunk_text = "\n".join(current_lines)
                    chunks.append({
                        "chunk_index": len(chunks),
                        "text": chunk_text,
                        "token_count": count_tokens(chunk_text),
                    })
                    current_lines = []
                    current_tokens = 0
                current_lines.append(part)
                current_tokens += part_tokens
            continue

        if current_tokens + turn_tokens > max_tokens and current_lines:
            chunk_text = "\n".join(current_lines)
            chunks.append({
                "chunk_index": len(chunks),
                "text": chunk_text,
                "token_count": count_tokens(chunk_text),
            })
            current_lines = []
            current_tokens = 0

        current_lines.append(turn)
        current_tokens += turn_tokens

    # Flush remaining
    if current_lines:
        chunk_text = "\n".join(current_lines)
        chunks.append({
            "chunk_index": len(chunks),
            "text": chunk_text,
            "token_count": count_tokens(chunk_text),
        })

    logger.info(
        f"Transcript {transcript_id}: {total_tokens} tokens -> "
        f"{len(chunks)} chunks"
    )
    return chunks


def _split_into_turns(text: str) -> list[str]:
    """Split text at speaker turn boundaries, keeping each turn as one block."""
    positions = [m.start() for m in SPEAKER_PATTERN.finditer(text)]

    if not positions:
        return [text]

    # Ensure we capture text before the first speaker
    if positions[0] > 0:
        positions.insert(0, 0)

    turns = []
    for i, pos in enumerate(positions):
        end = positions[i + 1] if i + 1 < len(positions) else len(text)
        turn = text[pos:end].strip()
        if turn:
            turns.append(turn)

    return turns


def _split_into_lines(text: str) -> list[str]:
    """Split text into individual lines (fallback for unstructured text)."""
    lines = text.split("\n")
    return [line for line in lines if line.strip()]
