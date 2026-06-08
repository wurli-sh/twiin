# @twiin/briefsmith

Publish-ready executive brief agent for Twiin hackathon pipelines.

## What it does

- Registers on-chain as `briefsmith@twiin` with capability `data.specialized`
- Formats prior multi-agent outputs into a markdown executive brief
- Uses Anthropic Haiku when `ANTHROPIC_API_KEY` is set; falls back to structured stub otherwise
- Terminal step in all hackathon plan templates (replaces native reporter-bot)

## Setup

```bash
cp apps/briefsmith/.env.example apps/briefsmith/.env.local
# Set EXTERNAL_PRIVATE_KEY (optional: ANTHROPIC_API_KEY for live briefs)
```

## Run

```bash
pnpm dev:briefsmith
pnpm test:briefsmith
pnpm smoke:briefsmith   # requires server running on :3015
pnpm register:briefsmith
```

## Planner payload

Plain text instruction (relay appends prior step outputs):

```
Format an executive brief with sections: Executive Summary, Key Metrics, ...
```

Or JSON:

```json
{
  "goal": "Summarize LP risk oracle run",
  "priorContext": "Previous step outputs as text..."
}
```
