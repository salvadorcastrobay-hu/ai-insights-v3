# Scripts (one-off / regression harness)

These are not run on every push. Keep them around for ad-hoc QA when the
ask-chart route changes (prompt, evidence logic, model swap).

## Setup

```sh
vercel env pull .env.qa --environment=production --yes
```

`.env.qa` is gitignored — it contains prod secrets. Re-pull whenever needed.

## Available scripts

- `qa-ask-chart.ts` — Structural checks on every chart drill (sub-breakdown
  coverage, distinct labels, quote availability). No LLM cost.
  Run: `npx tsx scripts/qa-ask-chart.ts`
- `qa-evidence.ts` — Dumps the raw evidence block sent to the LLM for a few
  pain labels. Useful when iterating on `buildRowEvidence`.
  Run: `npx tsx scripts/qa-evidence.ts`
- `qa-live.ts` — End-to-end against prod with 10 behavioral assertions
  (taxonomy verbatim, Otros bullet present, recommendation tagged with
  hipótesis, etc.). Mints a JWT, hits `/api/ask-chart`, asserts on the
  streamed response. ~$0.05 per run.
  Run: `npx tsx scripts/qa-live.ts`
- `qa-one.ts` — Single-prompt smoke test for ad-hoc inspection. Edit the
  questions in the file. ~$0.01 per run.
  Run: `npx tsx scripts/qa-one.ts`

## When to run

- Before merging a change to `app/api/ask-chart/route.ts`
- After changing the model id (`ASK_CHART_MODEL`)
- After changing chart drill `dimension`/`scopeType` on any view
