# Project Learnings

> Managed by `/learn`. Append-only — latest entry wins on conflicts.

## Patterns

### commit-chunking-convention
- **Insight:** Always commit changes in logical chunks by layer (chore/feat/test/docs), not one giant commit. Typical split: (1) config/infra, (2) contracts source + generated ABIs, (3) tests, (4) shared package, (5) docs. Use `git add` with explicit file paths per chunk, never `git add .`.
- **Confidence:** 10/10
- **Source:** learn
- **Files:** CLAUDE.md
- **Date:** 2026-06-03

## Pitfalls

## Preferences

## Architecture

## Tools
