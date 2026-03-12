---
name: run-pipeline
description: Run the full transcript extraction pipeline
---

# Run Pipeline

## Steps
1. Check for pending batches: `python3 -m src.cli status`
2. If no pending batch, run extraction: `python3 -m src.cli run --sample N --model MODEL`
3. Monitor progress: `python3 -m src.cli status`
4. When complete, run QA: `python3 -m src.cli qa --sample 50`

## Parameters
- `--sample N`: Process only N transcripts (for testing)
- `--model gpt-4o|gpt-4o-mini`: Model for extraction
- `--dry-run`: Generate JSONL without submitting to OpenAI

## Cost Estimates
- Full run (4,809 transcripts) with gpt-4o: ~$191 (Batch API)
- Full run with gpt-4o-mini: ~$11
- Sample of 50: ~$2 (4o) / $0.12 (mini)
