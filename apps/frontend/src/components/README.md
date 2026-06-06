# Frontend Component Architecture

## Directory

```
components/
├── home/          — Landing page sections (Hero, GatewayBento, HowItWorks, etc.)
├── agents/        — Agent management (deploy, list, policy, kill switch, external agents)
├── console/       — Task execution console (selector, planner, transcript, progress)
├── marketplace/   — Sub-agent marketplace (table, rows with Elo ranking)
├── layout/        — App shell (Navbar, MainLayout, NetworkBanner)
├── spell/         — Animated paper/shader components (three.js, scroll effects)
└── ui/            — Design system primitives (Button, Badge, Tabs, Dialog, etc.)
```

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
