# @twiin/frontend — React/Vite Web App

React-based UI for minting, managing, and tasking Twiin agents on Somnia Testnet. Built with Vite 6, wagmi 2, Tailwind CSS 4, and framer-motion.

**Status: Phase 4 complete.**

## Commands

| Command    | Description                          |
| ---------- | ------------------------------------ |
| `pnpm dev` | `vite` — dev server with HMR         |
| `pnpm build` | `tsc -b && vite build` — production build |
| `pnpm lint` | `eslint .`                          |
| `pnpm preview` | `vite preview` — preview production build |

## Source Layout

```
src/
├── main.tsx              — entry point; QueryClient, WagmiProvider, Router
├── App.tsx               — root layout + route definitions
├── app.css               — global Tailwind styles
├── config/
│   ├── wagmi.ts          — wagmi config (Somnia Testnet chain)
│   ├── chains.ts         — chain definitions
│   └── contracts.ts      — contract address imports
├── lib/
│   ├── cn.ts             — clsx + tailwind-merge utility
│   ├── animations.ts     — framer-motion animation variants
│   ├── agent-name.ts     — name formatting helpers
│   ├── config-names.ts   — native agent name -> configId mapping
│   ├── plan-api.ts       — POST /api/plan client
│   ├── read-contract.ts  — typed readContract wrapper
│   ├── sub-agent-status.ts — status display helpers
│   ├── task-state.ts     — task state enum helpers
│   ├── feed-topics.ts    — oracle feed topic constants
│   └── format-time.ts    — time formatting utilities
├── hooks/
│   ├── useWallet.ts         — wallet connection + account state
│   ├── useTwiinAgents.ts    — list user's deployed Twiin agents
│   ├── useSubAgents.ts      — list registered sub-agents from registry
│   ├── useTaskStream.ts     — SSE stream for live task updates
│   ├── useTaskDetail.ts     — fetch single task details
│   ├── useAgentTasks.ts     — fetch tasks for a specific agent
│   ├── useCreateTask.ts     — createTask via 6551 execute
│   ├── useOracleFeeds.ts    — list published oracle feeds
│   ├── usePageReady.ts      — staggered page reveal animation
│   └── useNetworkGuard.ts   — enforce Somnia Testnet
├── stores/
│   └── ui.ts             — zustand UI state (selected agent, etc.)
├── pages/
│   ├── HomePage.tsx         — landing page
│   ├── AgentsPage.tsx       — my agents + deploy panel
│   ├── ConsolePage.tsx      — task execution console
│   ├── FeedsPage.tsx        — oracle feed explorer
│   └── MarketplacePage.tsx  — sub-agent marketplace
└── components/
    ├── home/
    │   ├── HeroSection.tsx      — hero with animated gradient + CTA
    │   ├── HowItWorks.tsx       — step-by-step explainer
    │   ├── ConsoleSection.tsx   — interactive console preview
    │   └── CallToAction.tsx     — bottom CTA
    ├── agents/
    │   ├── DeployAgentPanel.tsx — mint agent form (name + STT)
    │   ├── AgentList.tsx        — list of deployed agents
    │   └── AgentRow.tsx         — single agent card
    ├── console/
    │   ├── AgentSelector.tsx    — pick active agent
    │   ├── PlanApproval.tsx     — review + approve plan steps
    │   └── TaskTimeline.tsx     — live step execution timeline
    ├── feeds/
    │   ├── FeedCard.tsx         — oracle feed display card
    │   └── FeedTopicLookup.tsx  — feed topic search
    ├── marketplace/
    │   ├── SubAgentTable.tsx    — table of registered sub-agents
    │   └── SubAgentRow.tsx      — single sub-agent row
    ├── layout/
    │   ├── Navbar.tsx           — top nav with wallet connect
    │   ├── Footer.tsx           — footer
    │   └── MainLayout.tsx       — layout wrapper
    └── ui/
        ├── Button.tsx           — styled button
        ├── Badge.tsx            — status badge
        ├── Tabs.tsx             — tab switcher
        ├── TextLoop.tsx         — animated text carousel
        ├── TextShimmer.tsx      — shimmer loading text
        ├── ThinkingSpinner.tsx  — thinking indicator
        └── TwiinAvatar.tsx      — agent avatar

## Key Dependencies

- react 19 + react-dom 19
- Vite 6 + @vitejs/plugin-react
- wagmi 2 + viem 2 — wallet connection + contract reads
- @tanstack/react-query — async state
- react-router-dom 7 — routing
- framer-motion 12 — animations
- zustand 5 — lightweight state
- Tailwind CSS 4 + @tailwindcss/vite
- lucide-react — icons
- sonner — toast notifications
- clsx + tailwind-merge — class utilities
