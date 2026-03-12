---
name: add-taxonomy
description: Add a new item to the taxonomy (competitor, pain subtype, feature, etc.)
---

# Add Taxonomy Item

## Files to modify
- `src/skills/taxonomy.py` — Add the new code + metadata
- If competitor: Add to COMPETITORS dict + COMPETITOR_ALIASES if needed
- If pain subtype: Add to PAIN_SUBTYPES with theme, module, description
- If feature: Add to SEED_FEATURE_NAMES with display_name, suggested_module

## After modifying
1. Bump PROMPT_VERSION_BASE in src/config.py
2. Run `python3 -m src.cli setup` to seed new taxonomy to DB
3. Test with `python3 -m src.cli run --sample 3` to verify extraction picks it up
