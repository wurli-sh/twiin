# @twiin/frontend — React/Vite Web App

React 19 + Vite 6 + wagmi 2 + Tailwind CSS 4. Light-theme UI with nano-remit brand (green `#9FE870` / charcoal `#1A1A1A` / ghost `#F5F5F5`). Built with shadcn/ui, framer-motion, three.js paper shaders, and Onest font.

**Status: Phase 4 complete; Phase 5 external agents UI shipped.**

## Commands

| Command      | Description                          |
| ------------ | ------------------------------------ |
| `pnpm dev`   | `vite` — dev server with HMR         |
| `pnpm build` | `tsc -b && vite build` — production  |
| `pnpm lint`  | `eslint .`                           |
| `pnpm preview` | `vite preview`                     |

## Source Layout

```
src/
├── main.tsx              — entry; QueryClient, WagmiProvider, BrowserRouter
├── App.tsx               — root layout + route definitions (/, /agents, /console, /marketplace)
├── app.css               — global Tailwind CSS 4 theme (light, brand tokens, shadcn vars)
├── config/
│   ├── wagmi.ts          — wagmi config (Somnia Testnet chainId 50312)
│   ├── chains.ts         — chain definitions
│   └── contracts.ts      — contract address imports from @twiin/shared
├── pages/
│   ├── HomePage.tsx         — landing page (Hero, GatewayBento, HowItWorks, Ecosystem, etc.)
│   ├── AgentsPage.tsx       — my agents + deploy panel + policy + task activity
│   ├── ConsolePage.tsx      — agent selector, task execution, plan approval, streaming transcript
│   └── MarketplacePage.tsx  — browse registered sub-agents
├── components/
│   ├── home/
│   │   ├── Hero.tsx                  — full-viewport hero with shader background
│   │   ├── GatewayBento.tsx          — bento-grid feature showcase
│   │   ├── HeroConsolePreview.tsx    — live console preview in hero
│   │   ├── HowItWorks.tsx            — step-by-step explainer
│   │   ├── Ecosystem.tsx             — partner/ecosystem logos
│   │   ├── DeploymentCTA.tsx         — bottom call-to-action
│   │   └── CinematicFooter.tsx       — footer with gradient
│   ├── agents/
│   │   ├── DeployAgentPanel.tsx      — mint agent form (name + STT)
│   │   ├── AgentList.tsx             — list of deployed agents
│   │   ├── AgentTable.tsx            — table view of agents with status
│   │   ├── AgentStatusLabel.tsx      — status badge component
│   │   ├── AgentKillSwitchControl.tsx— kill switch toggle
│   │   ├── AddAgentPanel.tsx         — add agent modal
│   │   ├── ExternalAgentPanel.tsx    — register/manage external agents
│   │   ├── PolicyPanel.tsx           — spending policy editor
│   │   └── TaskActivity.tsx          — per-agent task history
│   ├── console/
│   │   ├── AgentSelector.tsx         — pick active agent + balance
│   │   ├── AgentStatusLine.tsx       — agent online/offline indicator
│   │   ├── PlanApproval.tsx          — review + approve/deny plan
│   │   ├── PlanStepList.tsx          — step-by-step plan display
│   │   ├── PlanBudgetRecovery.tsx    — budget recovery UI
│   │   ├── CommandBar.tsx            — free-text goal input
│   │   ├── SuggestedPrompts.tsx      — quick-action prompts
│   │   ├── BudgetWarningsBar.tsx     — spending limit alerts
│   │   ├── TaskResultCard.tsx        — step result display
│   │   ├── TranscriptPanel.tsx       — live execution transcript
│   │   ├── ConsoleTopBar.tsx         — console header with agent info
│   │   ├── ExecutionPanel.tsx        — main execution view (layout)
│   │   ├── ExecutionPanelOverlay.tsx — overlay for execution state
│   │   ├── ExecutionSidebar.tsx      — sidebar with step list + details
│   │   ├── ExecutionModeToggle.tsx    — switch between planning modes (claude)
│   │   ├── ConsensusBadge.tsx        — validator consensus receipt badge
│   │   └── ReportPendingCard.tsx     — pending report step display
│   ├── marketplace/
│   │   ├── SubAgentTable.tsx         — table of registered sub-agents
│   │   └── SubAgentRow.tsx           — single sub-agent row with Elo
│   ├── layout/
│   │   ├── Navbar.tsx                — top nav with wallet connect
│   │   ├── MainLayout.tsx            — layout wrapper (Outlet)
│   │   └── NetworkBanner.tsx         — Somnia Testnet network indicator
│   ├── spell/                        — animated paper/shader components
│   │   ├── animated-checkbox.tsx     — animated checkbox
│   │   ├── blur-reveal.tsx           — blur reveal on scroll
│   │   ├── highlighted-text.tsx      — gradient text highlight
│   │   ├── light-rays.tsx            — light ray effect
│   │   ├── logos-carousel.tsx        — auto-scrolling logo carousel
│   │   └── tilt-card.tsx             — 3D tilt hover card
│   └── ui/
│       ├── Button.tsx                — styled button (shadcn/cva)
│       ├── Badge.tsx                 — status badge
│       ├── Tabs.tsx                  — tab switcher
│       ├── ConfirmDialog.tsx         — confirmation modal
│       ├── DropdownPanel.tsx         — dropdown panel component
│       ├── TextLoop.tsx              — animated text carousel
│       ├── TextShimmer.tsx           — shimmer loading text
│       ├── ThinkingSpinner.tsx       — thinking indicator
│       └── TwiinAvatar.tsx          — agent avatar
├── hooks/
│   ├── useWallet.ts         — wallet connection + account state
│   ├── useTwiinAgents.ts    — list user's deployed Twiin agents
│   ├── useSubAgents.ts      — list registered sub-agents from registry
│   ├── useTaskStream.ts     — SSE stream for live task updates
│   ├── useTaskDetail.ts     — fetch single task details
│   ├── useAgentTasks.ts     — fetch tasks for a specific agent
│   ├── useCreateTask.ts     — createTask via 6551 execute
│   ├── useAgentPolicy.ts    — read + update agent spending policy
│   ├── useRotatingPhrase.ts — rotating text for hero
│   ├── usePageReady.ts      — staggered page reveal animation
│   ├── useNetworkGuard.ts   — enforce Somnia Testnet
│   └── usePublishFeed.ts    — publish oracle feed data on-chain
├── stores/
│   └── ui.ts                — zustand UI state (selected agent, sidebar, etc.)
└── lib/
    ├── cn.ts                   — clsx + tailwind-merge
    ├── utils.ts                — shared utility fns
    ├── animations.ts           — framer-motion animation variants
    ├── agent-name.ts           — name formatting helpers
    ├── agent-budget.ts         — budget formatting helpers
    ├── agent-output-display.ts — external agent output formatting
    ├── agent-status-copy.ts    — status label text mapping
    ├── config-names.ts         — native agent name ↔ configId mapping
    ├── console-session.ts      — console session state manager
    ├── feed-topics.ts          — oracle feed topic constants
    ├── format-time.ts          — time formatting utilities
    ├── plan-api.ts             — POST /api/plan client
    ├── plan-step-display.ts    — plan step display formatting
    ├── preflight-create-task.ts — createTask calldata preflight checks
    ├── publish-feed-params.ts   — oracle feed publish parameter helpers
    ├── read-contract.ts        — typed readContract wrapper
    ├── report-display.ts       — report step output formatting
    ├── sentiment-oracle-display.ts — oracle sentiment display
    ├── sub-agent-status.ts     — sub-agent status helpers
    ├── task-result-display.ts  — task result display formatting
    ├── task-state.ts           — task state enum helpers
```

## Theme

Light theme with nano-remit green accent. Defined in `app.css` via Tailwind CSS 4 `@theme` directive:

| Token | Value |
|-------|-------|
| `--color-primary` / `--color-primary-dark` | `#163300` / `#163300` |
| `--color-primary-bright` / `--color-primary-foreground` | `#9FE870` / `#9FE870` |
| `--color-charcoal` / `--color-charcoal-soft` | `#1A1A1A` / `#2C2C2C` |
| `--color-ghost` / `--color-ghost-dim` | `#F5F5F5` / `#EBEBEB` |
| `--color-background` / `--color-foreground` | `#FFFFFF` / `#0F0F0F` |

Custom shadows use OKLCH for depth: `shadow-soft`, `shadow-card`, `shadow-elev`, `shadow-pill`, `shadow-pressed`, `shadow-active`, `shadow-lime-pill`, `shadow-glow`.

## Key Dependencies

| Dep | Version | Use |
|-----|---------|-----|
| react / react-dom | 19.x | UI framework |
| Vite | 6.x | bundler + HMR |
| wagmi / viem | 2.x | wallet connection + contract reads |
| @tanstack/react-query | 5.x | async state |
| react-router-dom | 7.x | routing |
| framer-motion / motion | 12.x | animations |
| Tailwind CSS | 4.x | styling |
| shadcn / class-variance-authority | latest | component primitives |
| zustand | 5.x | lightweight state |
| lucide-react | latest | icons |
| sonner | 2.x | toast notifications |
| three / @paper-design/shaders-react | latest | shader backgrounds |
| @base-ui/react | 1.x | headless UI primitives |
| react-markdown | 10.x | markdown rendering |
