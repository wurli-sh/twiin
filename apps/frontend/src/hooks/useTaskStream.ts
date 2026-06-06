import { useEffect, useState, useCallback } from 'react'

export type StreamEvent = {
  id: number
  type: string
  data: Record<string, unknown>
  at: number
}

export const STREAM_EVENT_LABELS: Record<string, string> = {
  task_created: 'Task created',
  step_dispatched: 'Step dispatched',
  step_state: 'Step state changed',
  step_result_pending: 'External result pending',
  step_result_submitted: 'Result submitted',
  step_approved: 'Step approved',
  step_rejected: 'Step rejected',
  step_rated: 'Step rated',
  trustless_intent: 'Trustless task intent',
  trustless_step_appended: 'Trustless step appended',
  janice_iteration: 'Janice iteration',
  janice_tool_executed: 'Janice tool executed',
  janice_resume_queued: 'Janice resume queued',
  task_completed: 'Task completed',
  task_aborted: 'Task aborted',
}

export function streamEventLabel(type: string): string {
  return STREAM_EVENT_LABELS[type] ?? type.replace(/_/g, ' ')
}

const TRUSTLESS_EVENT_TYPES = new Set([
  'trustless_intent',
  'trustless_step_appended',
  'janice_iteration',
  'janice_tool_executed',
  'janice_resume_queued',
])

export function isTrustlessStreamEvent(type: string): boolean {
  return TRUSTLESS_EVENT_TYPES.has(type)
}

export function useTaskStream(taskId: string | null) {
  const [events, setEvents] = useState<StreamEvent[]>([])
  const [connected, setConnected] = useState(false)

  const reset = useCallback(() => {
    setEvents([])
    setConnected(false)
  }, [])

  useEffect(() => {
    if (!taskId) {
      reset()
      return
    }

    reset()
    const es = new EventSource(`/api/stream/${taskId}`)
    const types = Object.keys(STREAM_EVENT_LABELS)

    es.onopen = () => setConnected(true)
    es.onerror = () => setConnected(false)

    for (const type of types) {
      es.addEventListener(type, (ev) => {
        const message = ev as MessageEvent<string>
        let data: Record<string, unknown> = {}
        try {
          data = JSON.parse(message.data) as Record<string, unknown>
        } catch {
          data = { raw: message.data }
        }
        const id = Number(message.lastEventId) || Date.now()
        setEvents((prev) => {
          if (prev.some((e) => e.id === id && e.type === type)) return prev
          return [...prev, { id, type, data, at: Date.now() }]
        })
      })
    }

    return () => {
      es.close()
      setConnected(false)
    }
  }, [taskId, reset])

  return { events, connected, reset }
}
