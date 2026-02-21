"""
Embedding pipeline: chunk transcripts + Fathom summaries, generate embeddings
with text-embedding-3-large, store in pgvector for semantic search.

Usage:
    python embed_transcripts.py                    # Full run (skip already embedded)
    python embed_transcripts.py --since 2024-06-01 # Only transcripts after date
    python embed_transcripts.py --force            # Re-embed everything
"""

from __future__ import annotations

import logging
import os
import re
import time

import psycopg2
import tiktoken
from openai import OpenAI

from src import config

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

EMBEDDING_MODEL = "text-embedding-3-large"
EMBEDDING_DIMENSIONS = 2000
CHUNK_SIZE = 800       # tokens per chunk
CHUNK_OVERLAP = 150    # overlap between consecutive chunks
BATCH_SIZE = 100       # max embeddings per OpenAI API call

_enc = tiktoken.get_encoding("cl100k_base")

# Speaker turn pattern (reused from chunker.py)
SPEAKER_PATTERN = re.compile(
    r"^(?:"
    r"[A-Z][a-zA-Z\s]*?:"
    r"|Speaker\s*\d+:"
    r"|\[[^\]]+\]:"
    r"|\d{1,2}:\d{2}"
    r")",
    re.MULTILINE,
)


def _count_tokens(text: str) -> int:
    return len(_enc.encode(text))


# ---------------------------------------------------------------------------
# Database helpers
# ---------------------------------------------------------------------------

def get_db_connection():
    """Get PostgreSQL connection via DATABASE_URL or config params."""
    database_url = os.environ.get("DATABASE_URL")
    if database_url:
        database_url = re.sub(r"[?&]sslmode=[^&]*", "", database_url)
        sep = "&" if "?" in database_url else "?"
        database_url = f"{database_url}{sep}sslmode=require"
        conn = psycopg2.connect(database_url)
    else:
        # Fallback: build from config params
        params = config.get_db_connection_params()
        conn = psycopg2.connect(**params, sslmode="require")

    # Disable statement timeout for long-running embedding queries
    with conn.cursor() as cur:
        cur.execute("SET statement_timeout = 0;")
    conn.commit()
    return conn


def ensure_schema(conn) -> None:
    """Create pgvector extension and transcript_chunks table if they don't exist."""
    with conn.cursor() as cur:
        cur.execute("CREATE EXTENSION IF NOT EXISTS vector;")
        cur.execute("""
            CREATE TABLE IF NOT EXISTS transcript_chunks (
                id                UUID DEFAULT gen_random_uuid() PRIMARY KEY,
                transcript_id     TEXT NOT NULL,
                chunk_index       INTEGER NOT NULL,
                source_type       TEXT NOT NULL CHECK (source_type IN ('transcript', 'fathom_summary')),
                chunk_text        TEXT NOT NULL,
                token_count       INTEGER,
                embedding         vector(2000),
                -- CRM metadata for filtered search
                deal_id           TEXT,
                deal_name         TEXT,
                company_name      TEXT,
                region            TEXT,
                country           TEXT,
                segment           TEXT,
                industry          TEXT,
                company_size      TEXT,
                deal_stage        TEXT,
                deal_owner        TEXT,
                call_date         DATE,
                amount            NUMERIC,
                created_at        TIMESTAMPTZ DEFAULT NOW(),
                UNIQUE(transcript_id, chunk_index, source_type)
            );
        """)
        # NOTE: HNSW index is created AFTER bulk insert via create_hnsw_index()
        # to avoid slow incremental index updates during embedding pipeline.
        # Metadata indexes for filtered search
        cur.execute("CREATE INDEX IF NOT EXISTS idx_chunks_transcript ON transcript_chunks(transcript_id);")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_chunks_segment ON transcript_chunks(segment);")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_chunks_region ON transcript_chunks(region);")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_chunks_company ON transcript_chunks(company_name);")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_chunks_deal ON transcript_chunks(deal_id);")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_chunks_date ON transcript_chunks(call_date);")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_chunks_source ON transcript_chunks(source_type);")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_chunks_country ON transcript_chunks(country);")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_chunks_deal_stage ON transcript_chunks(deal_stage);")
    conn.commit()
    logger.info("Schema verificado / creado.")


def create_hnsw_index(conn) -> None:
    """Create HNSW index on transcript_chunks. Called after bulk inserts."""
    logger.info("Creando indice HNSW (esto puede tardar unos minutos)...")
    with conn.cursor() as cur:
        cur.execute("DROP INDEX IF EXISTS idx_chunks_embedding_hnsw;")
        cur.execute("""
            CREATE INDEX idx_chunks_embedding_hnsw
            ON transcript_chunks USING hnsw (embedding vector_cosine_ops)
            WITH (m = 16, ef_construction = 128);
        """)
    conn.commit()
    logger.info("Indice HNSW creado.")


def fetch_transcripts(conn, since: str | None = None) -> list[dict]:
    """Fetch transcripts with CRM metadata from v_transcripts view."""
    query = """
        SELECT transcript_id, transcript_text, fathom_summary,
               deal_id, deal_name, company_name,
               region, country, segment, industry, company_size,
               deal_stage, deal_owner, call_date, amount
        FROM v_transcripts
    """
    params: list = []
    if since:
        query += " WHERE call_date >= %s"
        params.append(since)
    query += " ORDER BY call_date DESC"

    with conn.cursor() as cur:
        cur.execute(query, params)
        columns = [desc[0] for desc in cur.description]
        rows = cur.fetchall()
    return [dict(zip(columns, row)) for row in rows]


def fetch_already_embedded(conn) -> set[tuple[str, str]]:
    """Get set of (transcript_id, source_type) already embedded."""
    with conn.cursor() as cur:
        cur.execute("""
            SELECT DISTINCT transcript_id, source_type
            FROM transcript_chunks
            WHERE embedding IS NOT NULL
        """)
        return {(row[0], row[1]) for row in cur.fetchall()}


# ---------------------------------------------------------------------------
# Chunking (optimized for embeddings: smaller chunks + overlap)
# ---------------------------------------------------------------------------

def _split_into_turns(text: str) -> list[str]:
    """Split text at speaker turn boundaries."""
    positions = [m.start() for m in SPEAKER_PATTERN.finditer(text)]
    if not positions:
        return [text]

    if positions[0] > 0:
        positions.insert(0, 0)

    turns = []
    for i, pos in enumerate(positions):
        end = positions[i + 1] if i + 1 < len(positions) else len(text)
        turn = text[pos:end].strip()
        if turn:
            turns.append(turn)
    return turns


def chunk_text_for_embedding(text: str) -> list[str]:
    """Split text into ~CHUNK_SIZE token chunks with CHUNK_OVERLAP overlap.

    Speaker-turn-aware: tries to split at speaker boundaries first.
    """
    if not text or not text.strip():
        return []

    total_tokens = _count_tokens(text)
    if total_tokens <= CHUNK_SIZE:
        return [text]

    # Split at speaker turns first, then fall back to lines
    segments = _split_into_turns(text)
    if len(segments) <= 1:
        segments = [line for line in text.split("\n") if line.strip()]

    chunks: list[str] = []
    current_segments: list[str] = []
    current_tokens = 0

    for segment in segments:
        seg_tokens = _count_tokens(segment)

        # If a single segment exceeds chunk size, split it by sentences
        if seg_tokens > CHUNK_SIZE:
            # Flush current buffer
            if current_segments:
                chunks.append("\n".join(current_segments))
                current_segments, current_tokens = _compute_overlap(current_segments)

            # Split oversized segment by sentences
            sentences = re.split(r"(?<=[.!?])\s+", segment)
            for sent in sentences:
                sent_tokens = _count_tokens(sent)
                if current_tokens + sent_tokens > CHUNK_SIZE and current_segments:
                    chunks.append("\n".join(current_segments))
                    current_segments, current_tokens = _compute_overlap(current_segments)
                current_segments.append(sent)
                current_tokens += sent_tokens
            continue

        if current_tokens + seg_tokens > CHUNK_SIZE and current_segments:
            chunks.append("\n".join(current_segments))
            current_segments, current_tokens = _compute_overlap(current_segments)

        current_segments.append(segment)
        current_tokens += seg_tokens

    # Flush remaining
    if current_segments:
        chunks.append("\n".join(current_segments))

    return chunks


def _compute_overlap(segments: list[str]) -> tuple[list[str], int]:
    """Keep last segments that fit within CHUNK_OVERLAP tokens (for overlap)."""
    overlap_segments: list[str] = []
    overlap_tokens = 0
    for seg in reversed(segments):
        seg_tokens = _count_tokens(seg)
        if overlap_tokens + seg_tokens > CHUNK_OVERLAP:
            break
        overlap_segments.insert(0, seg)
        overlap_tokens += seg_tokens
    return overlap_segments, overlap_tokens


# ---------------------------------------------------------------------------
# Context-enriched embedding text
# ---------------------------------------------------------------------------

def build_embedding_text(chunk_text: str, metadata: dict) -> str:
    """Prepend a metadata header for context-enriched embeddings.

    This helps the embedding model associate the text with its business context
    (company, segment, region, etc.), improving retrieval relevance.
    """
    parts = []
    if metadata.get("company_name"):
        parts.append(f"Empresa: {metadata['company_name']}")
    if metadata.get("deal_name"):
        parts.append(f"Deal: {metadata['deal_name']}")
    if metadata.get("segment"):
        parts.append(f"Segmento: {metadata['segment']}")
    if metadata.get("region"):
        parts.append(f"Region: {metadata['region']}")
    if metadata.get("country"):
        parts.append(f"Pais: {metadata['country']}")
    if metadata.get("industry"):
        parts.append(f"Industria: {metadata['industry']}")
    if metadata.get("call_date"):
        parts.append(f"Fecha: {metadata['call_date']}")

    header = " | ".join(parts) if parts else ""
    if header:
        return f"[{header}]\n{chunk_text}"
    return chunk_text


# ---------------------------------------------------------------------------
# OpenAI embedding
# ---------------------------------------------------------------------------

def generate_embeddings(client: OpenAI, texts: list[str]) -> list[list[float]]:
    """Generate embeddings for a batch of texts using text-embedding-3-large."""
    response = client.embeddings.create(
        model=EMBEDDING_MODEL,
        input=texts,
        dimensions=EMBEDDING_DIMENSIONS,
    )
    # Sort by index to ensure order matches input
    sorted_data = sorted(response.data, key=lambda x: x.index)
    return [item.embedding for item in sorted_data]


# ---------------------------------------------------------------------------
# Storage
# ---------------------------------------------------------------------------

_METADATA_KEYS = [
    "deal_id", "deal_name", "company_name", "region", "country",
    "segment", "industry", "company_size", "deal_stage", "deal_owner",
    "call_date", "amount",
]


def store_chunks(conn, chunks_data: list[dict]) -> None:
    """Upsert chunks with embeddings into transcript_chunks."""
    if not chunks_data:
        return

    with conn.cursor() as cur:
        for chunk in chunks_data:
            embedding_str = "[" + ",".join(str(x) for x in chunk["embedding"]) + "]"
            cur.execute("""
                INSERT INTO transcript_chunks
                (transcript_id, chunk_index, source_type, chunk_text, token_count,
                 embedding, deal_id, deal_name, company_name, region, country,
                 segment, industry, company_size, deal_stage, deal_owner,
                 call_date, amount)
                VALUES (%s, %s, %s, %s, %s, %s::vector, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (transcript_id, chunk_index, source_type)
                DO UPDATE SET
                    chunk_text = EXCLUDED.chunk_text,
                    token_count = EXCLUDED.token_count,
                    embedding = EXCLUDED.embedding,
                    deal_id = EXCLUDED.deal_id,
                    deal_name = EXCLUDED.deal_name,
                    company_name = EXCLUDED.company_name,
                    region = EXCLUDED.region,
                    country = EXCLUDED.country,
                    segment = EXCLUDED.segment,
                    industry = EXCLUDED.industry,
                    company_size = EXCLUDED.company_size,
                    deal_stage = EXCLUDED.deal_stage,
                    deal_owner = EXCLUDED.deal_owner,
                    call_date = EXCLUDED.call_date,
                    amount = EXCLUDED.amount
            """, (
                chunk["transcript_id"], chunk["chunk_index"], chunk["source_type"],
                chunk["chunk_text"], chunk["token_count"],
                embedding_str,
                chunk.get("deal_id"), chunk.get("deal_name"), chunk.get("company_name"),
                chunk.get("region"), chunk.get("country"), chunk.get("segment"),
                chunk.get("industry"), chunk.get("company_size"), chunk.get("deal_stage"),
                chunk.get("deal_owner"),
                str(chunk["call_date"]) if chunk.get("call_date") else None,
                float(chunk["amount"]) if chunk.get("amount") is not None else None,
            ))
    conn.commit()


# ---------------------------------------------------------------------------
# Main pipeline
# ---------------------------------------------------------------------------

def run_embedding_pipeline(since: str | None = None, force: bool = False) -> dict:
    """Main embedding pipeline. Returns stats dict."""
    conn = get_db_connection()
    client = OpenAI(api_key=config.OPENAI_API_KEY)

    # 1. Ensure schema
    ensure_schema(conn)

    # 2. Fetch transcripts with CRM metadata
    logger.info("Cargando transcripciones desde v_transcripts...")
    transcripts = fetch_transcripts(conn, since=since)
    logger.info(f"  {len(transcripts)} transcripciones encontradas")

    if not transcripts:
        logger.info("No hay transcripciones para procesar.")
        conn.close()
        return {"transcripts": 0, "chunks_embedded": 0}

    # 3. Check what's already embedded (skip unless --force)
    already_embedded: set[tuple[str, str]] = set()
    if not force:
        already_embedded = fetch_already_embedded(conn)
        logger.info(f"  {len(already_embedded)} (transcript, source) ya embebidos — se saltean")

    # 4. Build all pending chunks
    pending: list[dict] = []
    skipped_transcripts = 0

    for t in transcripts:
        tid = t["transcript_id"]
        metadata = {k: t.get(k) for k in _METADATA_KEYS}

        # --- Transcript text chunks ---
        if (tid, "transcript") not in already_embedded and t.get("transcript_text"):
            chunks = chunk_text_for_embedding(t["transcript_text"])
            for idx, chunk in enumerate(chunks):
                embedding_text = build_embedding_text(chunk, metadata)
                pending.append({
                    "transcript_id": tid,
                    "chunk_index": idx,
                    "source_type": "transcript",
                    "chunk_text": chunk,
                    "token_count": _count_tokens(chunk),
                    "embedding_text": embedding_text,
                    **metadata,
                })
        else:
            if t.get("transcript_text"):
                skipped_transcripts += 1

        # --- Fathom summary (one chunk per transcript) ---
        if (tid, "fathom_summary") not in already_embedded and t.get("fathom_summary"):
            summary = t["fathom_summary"]
            embedding_text = build_embedding_text(summary, metadata)
            pending.append({
                "transcript_id": tid,
                "chunk_index": 0,
                "source_type": "fathom_summary",
                "chunk_text": summary,
                "token_count": _count_tokens(summary),
                "embedding_text": embedding_text,
                **metadata,
            })

    logger.info(f"  {len(pending)} chunks pendientes de embeber ({skipped_transcripts} transcripciones ya procesadas)")

    if not pending:
        logger.info("Nada nuevo para embeber.")
        conn.close()
        return {"transcripts": len(transcripts), "chunks_embedded": 0, "skipped": skipped_transcripts}

    # 5. Embed and store in batches (with auto-reconnect)
    total_embedded = 0
    for batch_start in range(0, len(pending), BATCH_SIZE):
        batch = pending[batch_start : batch_start + BATCH_SIZE]
        texts = [c["embedding_text"] for c in batch]

        try:
            embeddings = generate_embeddings(client, texts)
        except Exception as e:
            logger.error(f"Error en batch {batch_start}-{batch_start + len(batch)}: {e}")
            # Retry once after a pause
            time.sleep(5)
            try:
                embeddings = generate_embeddings(client, texts)
            except Exception as e2:
                logger.error(f"Retry fallido: {e2}. Saltando batch.")
                continue

        for chunk, embedding in zip(batch, embeddings):
            chunk["embedding"] = embedding
            # Remove the embedding_text (not stored in DB)
            chunk.pop("embedding_text", None)

        # Store with auto-reconnect on connection failure
        for attempt in range(3):
            try:
                store_chunks(conn, batch)
                break
            except (psycopg2.OperationalError, psycopg2.InterfaceError, psycopg2.DatabaseError) as e:
                logger.warning(f"Conexion perdida (intento {attempt + 1}/3): {e}")
                time.sleep(5)
                try:
                    conn.close()
                except Exception:
                    pass
                conn = get_db_connection()
                logger.info("Reconectado a la base de datos.")
        else:
            logger.error(f"No se pudo reconectar. Saltando batch {batch_start}.")
            continue

        total_embedded += len(batch)

        logger.info(f"  {total_embedded}/{len(pending)} chunks embebidos...")

        # Small delay to be nice to the API
        if batch_start + BATCH_SIZE < len(pending):
            time.sleep(0.5)

    # 6. Create HNSW index after all inserts (much faster than incremental)
    if total_embedded > 0:
        try:
            create_hnsw_index(conn)
        except (psycopg2.OperationalError, psycopg2.InterfaceError, psycopg2.DatabaseError):
            # Reconnect and retry if connection was lost
            try:
                conn.close()
            except Exception:
                pass
            conn = get_db_connection()
            create_hnsw_index(conn)

    conn.close()

    stats = {
        "transcripts": len(transcripts),
        "chunks_embedded": total_embedded,
        "skipped": skipped_transcripts,
    }
    logger.info(f"Embedding completo: {total_embedded} chunks de {len(transcripts)} transcripciones")
    return stats


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Embed transcripts for RAG search")
    parser.add_argument("--since", help="Only process transcripts after this date (YYYY-MM-DD)")
    parser.add_argument("--force", action="store_true", help="Re-embed everything (ignore already embedded)")
    args = parser.parse_args()

    run_embedding_pipeline(since=args.since, force=args.force)
