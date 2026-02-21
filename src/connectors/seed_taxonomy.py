"""
Seed taxonomy tables in Supabase with data from taxonomy.py.
Called by `python main.py setup`.
"""

from __future__ import annotations

import logging

from supabase import Client

from src.connectors.supabase import seed_taxonomy

logger = logging.getLogger(__name__)


def run_seed(client: Client) -> None:
    """Seed all taxonomy reference tables."""
    logger.info("Seeding taxonomy tables...")
    counts = seed_taxonomy(client)

    logger.info("Taxonomy seeded successfully:")
    for table, count in counts.items():
        logger.info(f"  {table}: {count} rows")

    total = sum(counts.values())
    logger.info(f"  Total: {total} rows across {len(counts)} tables")
