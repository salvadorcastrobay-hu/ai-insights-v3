---
name: run-ingest
description: Ingest data from Fathom and HubSpot
---

# Run Ingest

## Full Ingestion (Fathom + HubSpot + Deal Matching)
`python3 -m src.cli ingest`

## Only Fathom
`python3 -m src.cli ingest --source fathom`

## Only HubSpot
`python3 -m src.cli ingest --source hubspot`

## Incremental (from date)
`python3 -m src.cli ingest --since 2024-06-01`

## Re-run Deal Matching Only
`python3 -m src.cli ingest --match-only`

## After Ingestion
Run the pipeline: `python3 -m src.cli run --sample 5 --model gpt-4o`
