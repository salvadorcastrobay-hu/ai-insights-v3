"""
OpenAI Batch API processor: create JSONL, submit batches, poll, download results.
Also supports direct API calls for small samples (--sample mode).
"""

from __future__ import annotations

import json
import logging
import os
import time
from pathlib import Path
from typing import Any

from openai import OpenAI
from tenacity import retry, stop_after_attempt, wait_exponential

from src import config
from src.models.insight import get_openai_json_schema
from src.skills.prompt_building import build_system_prompt, build_user_prompt

logger = logging.getLogger(__name__)

_system_prompt: str | None = None


def _get_system_prompt() -> str:
    global _system_prompt
    if _system_prompt is None:
        _system_prompt = build_system_prompt()
    return _system_prompt


def get_openai_client() -> OpenAI:
    return OpenAI(api_key=config.OPENAI_API_KEY)


# ── Direct API (for --sample mode) ──

@retry(stop=stop_after_attempt(3), wait=wait_exponential(min=5, max=60))
def process_single(
    client: OpenAI,
    transcript_text: str,
    metadata: dict,
    model: str | None = None,
) -> dict:
    """Process a single transcript chunk via direct API call. Returns parsed JSON."""
    model = model or config.OPENAI_MODEL
    system_prompt = _get_system_prompt()
    user_prompt = build_user_prompt(transcript_text, metadata)

    response = client.chat.completions.create(
        model=model,
        temperature=0,
        response_format=get_openai_json_schema(),
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
    )

    content = response.choices[0].message.content
    return json.loads(content)


# ── Batch API ──

def create_batch_jsonl(
    chunks: list[dict],
    output_path: str | None = None,
    model: str | None = None,
) -> str:
    """
    Create a JSONL file for the OpenAI Batch API.

    Each chunk dict must have:
    - custom_id: unique ID (transcript_id__chunk_index)
    - transcript_text: the text to process
    - metadata: CRM context dict

    Returns the path to the created JSONL file.
    """
    model = model or config.OPENAI_MODEL
    system_prompt = _get_system_prompt()
    response_format = get_openai_json_schema()

    os.makedirs(config.BATCH_DIR, exist_ok=True)
    if output_path is None:
        timestamp = int(time.time())
        output_path = os.path.join(config.BATCH_DIR, f"batch_input_{timestamp}.jsonl")

    with open(output_path, "w", encoding="utf-8") as f:
        for chunk in chunks:
            user_prompt = build_user_prompt(chunk["transcript_text"], chunk["metadata"])
            request = {
                "custom_id": chunk["custom_id"],
                "method": "POST",
                "url": "/v1/chat/completions",
                "body": {
                    "model": model,
                    "temperature": 0,
                    "response_format": response_format,
                    "messages": [
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": user_prompt},
                    ],
                },
            }
            f.write(json.dumps(request, ensure_ascii=False) + "\n")

    logger.info(f"Created batch JSONL with {len(chunks)} requests: {output_path}")
    return output_path


def submit_batch(client: OpenAI, jsonl_path: str) -> str:
    """Upload JSONL and create a batch. Returns batch_id."""
    # Upload file
    with open(jsonl_path, "rb") as f:
        file_obj = client.files.create(file=f, purpose="batch")
    logger.info(f"Uploaded file: {file_obj.id}")

    # Create batch
    batch = client.batches.create(
        input_file_id=file_obj.id,
        endpoint="/v1/chat/completions",
        completion_window="24h",
    )
    logger.info(f"Batch created: {batch.id} (status: {batch.status})")
    return batch.id


def poll_batch(
    client: OpenAI,
    batch_id: str,
    poll_interval: int | None = None,
) -> dict:
    """
    Poll a batch until completion. Returns the batch object.
    """
    poll_interval = poll_interval or config.BATCH_POLL_INTERVAL

    while True:
        batch = client.batches.retrieve(batch_id)
        status = batch.status
        completed = batch.request_counts.completed if batch.request_counts else 0
        total = batch.request_counts.total if batch.request_counts else 0
        failed = batch.request_counts.failed if batch.request_counts else 0

        logger.info(
            f"Batch {batch_id}: {status} "
            f"({completed}/{total} done, {failed} failed)"
        )

        if status in ("completed", "failed", "expired", "cancelled"):
            return {
                "id": batch.id,
                "status": status,
                "output_file_id": batch.output_file_id,
                "error_file_id": batch.error_file_id,
                "total": total,
                "completed": completed,
                "failed": failed,
            }

        time.sleep(poll_interval)


def download_batch_results(client: OpenAI, output_file_id: str) -> list[dict]:
    """Download and parse batch results. Returns list of {custom_id, response_body}."""
    content = client.files.content(output_file_id)
    text = content.text

    results = []
    for line in text.strip().split("\n"):
        if not line.strip():
            continue
        obj = json.loads(line)
        custom_id = obj.get("custom_id", "")
        response_body = obj.get("response", {}).get("body", {})

        # Extract the LLM response content
        choices = response_body.get("choices", [])
        if choices:
            message_content = choices[0].get("message", {}).get("content", "")
            try:
                parsed = json.loads(message_content)
            except json.JSONDecodeError:
                parsed = None
                logger.warning(f"Could not parse response for {custom_id}")
        else:
            parsed = None

        error = obj.get("error")
        if error:
            logger.warning(f"Batch error for {custom_id}: {error}")

        results.append({
            "custom_id": custom_id,
            "response": parsed,
            "error": error,
        })

    logger.info(f"Downloaded {len(results)} batch results")
    return results


def download_batch_errors(client: OpenAI, error_file_id: str) -> list[dict]:
    """Download batch error details."""
    if not error_file_id:
        return []
    content = client.files.content(error_file_id)
    errors = []
    for line in content.text.strip().split("\n"):
        if line.strip():
            errors.append(json.loads(line))
    return errors
