import { StepState, TaskState } from '@/config/contracts'

export function taskStateLabel(state: number): string {
  return TaskState[state] ?? 'Unknown'
}

export function taskStateVariant(
  state: number,
): 'default' | 'success' | 'danger' | 'warning' {
  switch (state) {
    case TaskState.Completed:
      return 'success'
    case TaskState.Aborted:
      return 'danger'
    case TaskState.Running:
      return 'warning'
    default:
      return 'default'
  }
}

export function stepStateLabel(state: number): string {
  return StepState[state] ?? 'Unknown'
}

export function stepStateVariant(
  state: number,
): 'default' | 'success' | 'danger' | 'warning' {
  switch (state) {
    case StepState.Succeeded:
      return 'success'
    case StepState.Failed:
    case StepState.TimedOut:
      return 'danger'
    case StepState.AwaitingRating:
    case StepState.Retrying:
      return 'warning'
    default:
      return 'default'
  }
}
