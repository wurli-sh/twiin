# Project Learnings

> Managed by `/learn`. Append-only — latest entry wins on conflicts.

## Patterns

### commit-chunking-convention
- **Insight:** Always commit changes in logical chunks by layer (chore/feat/test/docs), not one giant commit. Typical split: (1) config/infra, (2) contracts source + generated ABIs, (3) tests, (4) shared package, (5) docs. Use `git add` with explicit file paths per chunk, never `git add .`.
- **Confidence:** 10/10
- **Source:** learn
- **Files:** CLAUDE.md
- **Date:** 2026-06-03

### update-all-claude-mds
- **Insight:** When making project-wide changes, always update ALL CLAUDE.md files (root + each package/app) in sync. Each one tracks its own phase status, commands, source layout, and conventions. Missing CLAUDE.md files should be created (e.g. apps/backend/CLAUDE.md was missing before Phase 3).
- **Confidence:** 10/10
- **Source:** learn
- **Files:** CLAUDE.md, packages/contracts/CLAUDE.md, packages/shared/CLAUDE.md, apps/backend/CLAUDE.md
- **Date:** 2026-06-03

## Pitfalls

## Preferences

## Architecture

## Tools
