# Frontend Component Architecture

## Directory

```
components/
├── home/          — Landing page sections (Hero, GatewayBento, HowItWorks, etc.)
├── agents/        — Agent management (deploy, list, policy, kill switch, external agents)
├── console/       — Task execution console (19 components: selector, planner, execution panels, transcripts)
├── marketplace/   — Sub-agent marketplace (table, rows with Elo ranking)
├── layout/        — App shell (Navbar, MainLayout, NetworkBanner)
├── spell/         — Animated paper/shader components (three.js, scroll effects)
└── ui/            — Design system primitives (Button, Badge, Tabs, ConfirmDialog, DropdownPanel, TextLoop, etc.)
```

### Console Components (17)

| Component | Role |
|-----------|------|
| `AgentSelector` | Pick active agent + display balance |
| `AgentStatusLine` | Agent online/offline indicator |
| `PlanApproval` | Review + approve/deny plan steps |
| `PlanStepList` | Step-by-step plan display |
| `PlanBudgetRecovery` | Budget recovery suggestion UI |
| `CommandBar` | Free-text goal input with submit |
| `SuggestedPrompts` | Quick-action prompt buttons |
| `BudgetWarningsBar` | Spending limit alert bar |
| `TaskResultCard` | Step result display with metadata |
| `TranscriptPanel` | Live execution transcript (markdown) |
| `ConsoleTopBar` | Console header with agent info + mode toggle |
| `ExecutionPanel` | Main execution view layout |
| `ExecutionPanelOverlay` | Overlay for execution state transitions |
| `ExecutionSidebar` | Sidebar with step list + detail panel |
| `ExecutionModeToggle` | Switch between planning modes (Claude) |
| `ConsensusBadge` | Validator consensus receipt badge (StepConsensusReached) |
| `ReportPendingCard` | Pending report/oracle step display |

## Conventions

- Components use named exports, PascalCase filenames
- Tailwind CSS 4 for all styling — no CSS modules
- shadcn/ui primitives via `class-variance-authority` (Button, Badge, Tabs)
- framer-motion `motion` for entrance/exit animations
- `@/` path alias maps to `src/`

## State Flow

```
wagmi (wallet) → hooks (contract reads) → components (display)
                                    ↕
                          zustand store (ui.ts)
                           ↕
                    ConsoleSession (lib/console-session.ts)
```
