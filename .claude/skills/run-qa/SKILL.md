---
name: run-qa
description: Run QA evaluation and iterate prompts
---

# Run QA

## Quick Evaluation
`python3 -m src.cli qa --sample 50`

## Iterative Improvement
`python3 -m src.cli qa --iterate --target-score 0.90 --max-rounds 3`

## View Report
`python3 -m src.cli qa --report`

## Apply Refinements
`python3 -m src.cli qa --apply`

## Scores Target
- Completeness: >= 0.90
- Precision: >= 0.90
- Classification: >= 0.90
- Quotes Accuracy: >= 0.85
- Actionability: >= 0.85
- Taxonomy Fit: >= 0.90
