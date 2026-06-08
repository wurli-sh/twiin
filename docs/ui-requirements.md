# Twiin UI Layout Requirements

This document lists only what must appear in the Twiin UI. It intentionally avoids visual style direction, branding guidance, or implementation details.

## Product Scope

The UI must support these core product areas:

- Minting a named Twiin agent as an NFT with a wallet.
- Viewing and managing owned agents.
- Creating and approving tasks through the console.
- Viewing oracle feeds published by completed tasks.
- Browsing the sub-agent marketplace.
- Registering and maintaining external HTTP agents.
- Switching and confirming the connected wallet and network.

## Global Shell

The app shell must include:

- A persistent top navigation bar.
- A network warning banner when the user is on the wrong chain.
- A main content area centered within the page container.
- Toast notifications for success, warning, and error feedback.
- Route navigation for Home, Agents, Console, Feeds, and Marketplace.

### Top Navigation Requirements

- Brand area with the Twiin name/logo.
- Navigation links for all primary routes.
- Wallet connection control.
- Connected-wallet menu with copy address, explorer link, and disconnect action.
- Wallet connector menu when disconnected.
- Active route state for the current page.

### Network Banner Requirements

- Visible only when the connected wallet is on the wrong network.
- Message indicating the expected chain.
- Action button to switch to the correct network.
- Loading state while the network switch is in progress.

## Home Page

The home page must contain these sections in order:

1. Hero section.
2. How-it-works section.
3. Console preview section.
4. Call-to-action section.
5. Footer section.

### Hero Section

- Main headline introducing Twiin as a named AI agent.
- Supporting subheadline describing what the agent does.
- Primary action to open the Console.
- Secondary action to mint an agent.
- A hero-level product identity badge or label.

### How-It-Works Section

- Three-step interactive layout.
- Step navigation for:
  - Mint Agent.
  - Run Task.
  - Oracle Feed.
- Each step needs:
  - Title.
  - Short subtitle.
  - Description.
  - Two highlight items.
  - A small list of supporting details.

### Console Preview Section

- Section title for the Console.
- Three feature cards summarizing the Console experience.
- Chat-style example conversation showing:
  - User goal submission.
  - Plan creation.
  - Approval.
  - Step execution and payment confirmation.
- Action to open the Console.

### Call-to-Action Section

- Short statement encouraging agent creation on Somnia.
- Supporting paragraph describing the flow.
- Action to mint an agent.
- Action to browse the marketplace.

### Footer Section

- Closing summary of the product capabilities.

## Agents Page

The Agents page must include:

- Page title and short description.
- A shortcut to the Console when an agent is selected.
- Left-side deploy panel.
- Right-side content area with tabs.

### Deploy Panel

- Agent name input.
- Initial wallet fund input.
- Validation messages for invalid name and invalid fund amount.
- Deploy action button.
- Transaction status link after submission.
- Connected-wallet requirement message.

### Main Agent Area

- Tabs for:
  - My Agents.
  - Activity.
- Refresh action for lists.
- Empty state when the wallet has no agents.
- Connected-wallet empty state when the user has not connected.

#### My Agents Tab

- List of owned agents.
- Loading state with skeleton rows.
- Error state.
- Per-agent row controls.
- Toggle action for the kill switch.
- Selected agent state.
- Policy panel below the list when an agent is selected.
- Hint text when agents exist but none is selected.

#### Activity Tab

- Task history list for all owned agents.
- Loading state with skeleton rows.
- Error state.
- Empty state when no tasks exist.
- Each task entry must show:
  - Task identifier.
  - Agent label.
  - Task state.
  - Cursor position.
  - Spent budget.
  - Link back to Console.
  - External explorer link.

### Policy Panel

- Agent identity row.
- Spend caps section.
- Daily cap input.
- Max per-task input.
- Save policy action.
- Trustless cap display as read-only information.
- Oracle refresh pull section.
- Pull authorization summary when active.
- Per-tick amount input.
- Period input.
- Subscribe action.
- Revoke action.
- Refresh/sync action.

## Console Page

The Console page must support the full task lifecycle from planning to execution and completion.

### Top-of-Page Content

- Agent avatar or identity marker.
- Main status headline.
- Supporting line explaining that planning, approval, and execution are separate stages.

### Default Task Creation State

- Agent selector.
- Quick prompt buttons.
- Goal text area.
- Task budget input.
- Budget unit label.
- Validation and warning messages for:
  - Low wallet balance.
  - Per-task cap exceeded.
  - Daily cap exceeded.
  - Kill switch enabled.
- Budget policy guidance text.
- Plan-balance recovery component when the estimate exceeds current caps.
- Generate-plan button.

### Planning State

- Loading indicator while the planner is drafting.
- Progress text for planning.

### Plan Approval State

- Plan summary card.
- 60-second approval window.
- Countdown indicator.
- Step list with:
  - Step order.
  - Step type or config label.
  - Maximum cost per step.
  - Step payload preview.
- Estimated cost.
- Budget amount.
- Blocking reason when the task cannot be approved.
- Approve action.
- Reject action.
- Expiration message when the timer ends.

### Active Task State

- Result panel with chain state.
- Task budget, spent amount, and step count.
- Final task output when completed.
- Step-by-step results list.
- Per-step state badge.
- Optional per-step score display.
- Abort summary when the task fails or times out.
- Task timeline showing streamed events.
- New task action.

### Console States

- Disconnected state with a prompt to connect the wallet.
- Running state.
- Completed state.
- Aborted state.

## Feeds Page

The Feeds page must include:

- Page title and description.
- Shortcut to the Console for the selected agent.
- Agent selector.
- Tabs for:
  - Published.
  - Lookup.
- Manual sync action.
- Topic scan banner showing the monitored feed topics.

### Published Tab

- Loading state while reading on-chain feed data.
- Empty state when no feeds exist.
- Error state.
- Grid of feed cards when feeds are present.
- Each feed card must show the feed topic and the current feed data.

### Lookup Tab

- Feed topic lookup form.
- Lookup action for checking a topic.
- Disabled state when no agent is selected or wallet is not ready.

### Feeds Page States

- Connected-wallet requirement state.
- Refresh/sync state.
- Empty published feed state.

## Marketplace Page

The Marketplace page must include:

- Page title and description.
- Tabs for:
  - Native.
  - External.
  - Leaderboard.
- Manual sync action.

### Native Tab

- Table of native sub-agents.
- Empty state when no native sub-agents exist.

### External Tab

- External agent registration or update panel.
- Table of external agents.
- Empty state when no external competitors exist.

### Leaderboard Tab

- Ranked table of all sub-agents.
- Rank display for each row.
- Empty state when the registry is empty.

### External Agent Panel

- Agent name input.
- Public endpoint input.
- Cost per step input.
- Current registration badge.
- Verification status badge.
- Last verification error message when present.
- Verification summary showing how the backend checks the endpoint.
- Registration or update action.
- Wallet connection requirement.

### Sub-Agent Table

- Header row with agent and stats columns.
- Loading skeleton rows.
- Error state.
- Empty state copy for each lane.
- Per-row agent details.
- Refresh action.
- Elo summary footer when data is present.

## Shared Data and State Requirements

The UI must expose these shared states across pages:

- Selected agent ID.
- Active tab for Agents.
- Active tab for Feeds.
- Active tab for Marketplace.
- Active task ID in the Console.
- Live task events stream.
- Chain task state.
- Agent policy data.
- Oracle feed state.
- Sub-agent registry state.

## Required Empty and Error States

The design must account for:

- Wallet disconnected.
- Wrong network.
- No agents deployed.
- No tasks yet.
- No published feeds.
- No marketplace entries.
- Loading data on each route.
- Backend or chain read errors.
- Budget validation failure.
- Plan approval timeout.
- Task abort or timeout.

## Responsive Requirements

- Navigation must remain usable on narrow screens.
- The home page hero and content sections must stack cleanly on mobile.
- Agent management, console, feeds, and marketplace panels must collapse from side-by-side layouts to vertical layouts on smaller screens.
- Tables and card grids must remain readable on narrow viewports.
- The console must preserve access to the main task workflow on mobile without losing the approval or result areas.

## Not In Scope For This Doc

- Visual brand direction.
- Color palette decisions.
- Typography selection.
- Motion style decisions.
- Component implementation details.
- Backend API design.
- Contract behavior.