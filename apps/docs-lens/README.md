# @twiin/docs-lens

Somnia official docs external agent for Twiin corroboration pipelines.

## What it does

- Registers on-chain as `docs-lens@twiin` with capability `data.specialized`
- Queries `https://docs.somnia.network/{docPath}.md?ask={question}`
- Returns structured JSON with excerpt and findings for downstream analysis + briefsmith

## Setup

```bash
cp apps/docs-lens/.env.example apps/docs-lens/.env.local
# Set EXTERNAL_PRIVATE_KEY (dev/register load .env.local then .env automatically)
```

## Run

```bash
pnpm dev:docs-lens
pnpm test:docs-lens
pnpm smoke:docs-lens   # requires server running on :3011
pnpm register:docs-lens
```

## Planner payload

```json
{
  "question": "How do Somnia JSON API agents work for price oracles?",
  "docPath": "readme"
}
```
