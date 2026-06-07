# Frontend Hooks

| Hook | File | Purpose |
|------|------|---------|
| `useWallet` | `useWallet.ts` | Wallet connection state + account address via wagmi |
| `useTwiinAgents` | `useTwiinAgents.ts` | List user's deployed Twiin agents (ERC-721 balanceOf + tokenOfOwnerByIndex) |
| `useSubAgents` | `useSubAgents.ts` | List registered sub-agents from `AgentRegistry` with pagination |
| `useTaskStream` | `useTaskStream.ts` | SSE stream for live task execution updates (EventSource) |
| `useTaskDetail` | `useTaskDetail.ts` | Fetch single task from on-chain `AgentOrchestrator.tasks()` |
| `useAgentTasks` | `useAgentTasks.ts` | Fetch all tasks for a specific personalAgentId |
| `useCreateTask` | `useCreateTask.ts` | Build + send `createTask` via ERC-6551 `execute` |
| `useCreateTrustlessTask` | `useCreateTrustlessTask.ts` | Build + send trustless `createTask` via ERC-6551 `execute` |
| `useAgentPolicy` | `useAgentPolicy.ts` | Read + update agent spending policy (`dailyCapWei`, `killSwitch`) |
| `useRotatingPhrase` | `useRotatingPhrase.ts` | Rotating text animation state for hero header |
| `usePageReady` | `usePageReady.ts` | Staggered page reveal animation controller |
| `useNetworkGuard` | `useNetworkGuard.ts` | Enforce Somnia Testnet — warns/redirects on wrong chain |
