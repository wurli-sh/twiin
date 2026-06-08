# Frontend Lib Utilities

| File | Purpose |
|------|---------|
| `cn.ts` | `clsx` + `tailwind-merge` utility for conditional class merging |
| `utils.ts` | Shared utility functions |
| `animations.ts` | framer-motion animation variants (`fadeInUp`, `staggerContainer`, etc.) |
| `agent-name.ts` | Format `name@twiin` display strings |
| `agent-budget.ts` | Format budget values (STT wei → human-readable) |
| `agent-output-display.ts` | Format external agent output for display (dreamdex, docs-lens, etc.) |
| `agent-status-copy.ts` | Map agent status enums to display text |
| `config-names.ts` | Native agent name ↔ configId mapping (janice, web-intel, etc.) |
| `console-session.ts` | Console session state (current goal, step history, selections) |
| `feed-topics.ts` | Oracle feed topic ID ↔ label mapping |
| `format-time.ts` | Duration/time formatting (relative, absolute, countdown) |
| `plan-api.ts` | `POST /api/plan` client with fetch + error handling |
| `plan-step-display.ts` | Format plan steps for display (agent name, cost, capability) |
| `preflight-create-task.ts` | Validate `createTask` parameters before sending tx |
| `publish-feed-params.ts` | Build oracle feed publish parameters |
| `read-contract.ts` | Typed `readContract` wrapper with error normalization |
| `report-display.ts` | Format report step output text |
| `sentiment-oracle-display.ts` | Format oracle sentiment feed data |
| `sub-agent-status.ts` | Map sub-agent registry state to display status |
| `task-result-display.ts` | Format task step result for display |
| `task-state.ts` | Task state enum helpers (human label, color, icon) |
