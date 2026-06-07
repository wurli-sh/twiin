import type { ExecutionMode } from '@/config/features'

export type ExecutionModeTheme = {
  pill: string
  text: string
  icon: string
  ring: string
  badge: string
  subtitle: string
  transcript: string
  progressBar: string
  agentCard: string
  statusBar: string
  statusSpinner: string
  progressActiveBg: string
  progressConnector: string
  resultHeader: string
  resultIcon: string
}

const CLAUDE_THEME: ExecutionModeTheme = {
  pill: 'mode-claude-pill',
  text: 'mode-claude-text',
  icon: 'mode-claude-icon',
  ring: 'mode-claude-ring',
  badge: 'mode-claude-badge',
  subtitle: 'mode-claude-subtitle',
  transcript: 'mode-claude-transcript',
  progressBar: 'mode-claude-progress-bar',
  agentCard: 'mode-claude-agent-card',
  statusBar: 'mode-claude-status-bar',
  statusSpinner: 'mode-claude-icon',
  progressActiveBg: 'mode-claude-progress-active',
  progressConnector: 'mode-claude-progress-connector',
  resultHeader: 'mode-claude-result-header',
  resultIcon: 'mode-claude-result-icon',
}

const TRUSTLESS_THEME: ExecutionModeTheme = {
  pill: 'mode-trustless-pill',
  text: 'mode-trustless-text',
  icon: 'mode-trustless-icon',
  ring: 'mode-trustless-ring',
  badge: 'mode-trustless-badge',
  subtitle: 'mode-trustless-subtitle',
  transcript: 'mode-trustless-transcript',
  progressBar: 'mode-trustless-progress-bar',
  agentCard: 'mode-trustless-agent-card',
  statusBar: 'mode-trustless-status-bar',
  statusSpinner: 'mode-trustless-icon',
  progressActiveBg: 'mode-trustless-progress-active',
  progressConnector: 'mode-trustless-progress-connector',
  resultHeader: 'mode-trustless-result-header',
  resultIcon: 'mode-trustless-result-icon',
}

export function executionModeTheme(mode: ExecutionMode): ExecutionModeTheme {
  return mode === 'trustless' ? TRUSTLESS_THEME : CLAUDE_THEME
}

/** Console UI always uses the Janice (trustless) palette; Claude tokens remain in CSS. */
export function consolePageTheme(): ExecutionModeTheme {
  return TRUSTLESS_THEME
}

export function executionModeClasses(
  mode: ExecutionMode,
  active: boolean,
): Pick<ExecutionModeTheme, 'pill' | 'text' | 'icon' | 'ring'> {
  const theme = executionModeTheme(mode)
  if (!active) {
    return {
      pill: '',
      text: 'text-muted-foreground hover:text-foreground',
      icon: 'text-muted-foreground',
      ring: 'focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-1 focus-visible:ring-offset-background',
    }
  }
  return {
    pill: theme.pill,
    text: theme.text,
    icon: theme.icon,
    ring: theme.ring,
  }
}
