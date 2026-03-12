---
name: debug-extraction
description: Debug why extraction produced bad results for a transcript
---

# Debug Extraction

## Steps
1. Find the transcript: Query `raw_transcripts` by ID or title
2. Check the insights: Query `transcript_insights WHERE transcript_id = X`
3. Read the fathom_summary to understand the content
4. Run extraction on that single transcript:
   `python3 -m src.cli run --sample 1 --transcript-id X --model gpt-4o`
5. Compare old vs new insights
6. If classification issues persist, check taxonomy codes in `src/skills/taxonomy.py`
