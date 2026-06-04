import { useEffect, useState, useCallback } from 'react'

export type StreamEvent = {
  id: number
  type: string
  data: Record<string, unknown>
  at: number
}

const EVENT_LABELS: Record<string, string> = {
  task_created: 'Task created',
  step_dispatched: 'Step dispatched',
  step_state: 'Step state changed',
  step_result_pending: 'External result pending',
  step_result_submitted: 'Result submitted',
  step_approved: 'Step approved',
  step_rejected: 'Step rejected',
  step_rated: 'Step rated',
  task_completed: 'Task completed',
  task_aborted: 'Task aborted',
}

export function streamEventLabel(type: string): string {
  return EVENT_LABELS[type] ?? type.replace(/_/g, ' ')
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
    const types = Object.keys(EVENT_LABELS)

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
