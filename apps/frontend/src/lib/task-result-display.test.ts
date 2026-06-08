import { describe, expect, it } from 'vitest'
import { StepState } from '@/config/contracts'
import { resolveAbortDetail } from '@/lib/task-result-display'
import type { TaskStep } from '@/hooks/useTaskDetail'
import type { StreamEvent } from '@/hooks/useTaskStream'

describe('resolveAbortDetail', () => {
  it('shows timed-out step agent on timeout aborts, not unrelated approved ratings', () => {
    const chainSteps: TaskStep[] = [
      {
        stepIdx: 0,
        configId: '8',
        state: StepState.Succeeded,
        payload: '',
        resultHex: null,
        score: 85,
        consensusValidators: null,
        consensusReceiptId: null,
        consensusMedianCostWei: null,
      },
      {
        stepIdx: 1,
        configId: '10',
        state: StepState.Succeeded,
        payload: '',
        resultHex: null,
        score: 45,
        consensusValidators: null,
        consensusReceiptId: null,
        consensusMedianCostWei: null,
      },
      {
        stepIdx: 2,
        configId: '2',
        state: StepState.Succeeded,
        payload: '',
        resultHex: null,
        score: null,
        consensusValidators: null,
        consensusReceiptId: null,
        consensusMedianCostWei: null,
      },
      {
        stepIdx: 3,
        configId: '2',
        state: StepState.Succeeded,
        payload: '',
        resultHex: null,
        score: null,
        consensusValidators: null,
        consensusReceiptId: null,
        consensusMedianCostWei: null,
      },
      {
        stepIdx: 4,
        configId: '2',
        state: StepState.TimedOut,
        payload: '',
        resultHex: null,
        score: null,
        consensusValidators: null,
        consensusReceiptId: null,
        consensusMedianCostWei: null,
      },
      {
        stepIdx: 5,
        configId: '3',
        state: StepState.TimedOut,
        payload: '',
        resultHex: null,
        score: null,
        consensusValidators: null,
        consensusReceiptId: null,
        consensusMedianCostWei: null,
      },
    ];
    const events: StreamEvent[] = [
      {
        id: 1,
        type: 'step_rated',
        at: 1,
        data: {
          stepIdx: 1,
          score: 45,
          approved: true,
          reason:
            'The agent successfully completed the task and returned properly formatted results with valid metrics.',
        },
      },
      {
        id: 2,
        type: 'task_aborted',
        at: 2,
        data: { reason: 'step timed out' },
      },
    ];

    const detail = resolveAbortDetail(events, chainSteps, 'step timed out');

    expect(detail.stepIdx).toBe(4);
    expect(detail.agentName).toBe('somnia-oracle@twiin');
    expect(detail.score).toBeUndefined();
    expect(detail.ratingReason).toBeUndefined();
  });

  it('includes score and rater reason when a step is rejected by rating', () => {
    const chainSteps: TaskStep[] = [
      {
        stepIdx: 0,
        configId: '8',
        state: StepState.Failed,
        payload: '',
        resultHex: null,
        score: 20,
        consensusValidators: null,
        consensusReceiptId: null,
        consensusMedianCostWei: null,
      },
    ];
    const events: StreamEvent[] = [
      {
        id: 1,
        type: 'step_rated',
        at: 1,
        data: {
          stepIdx: 0,
          score: 20,
          approved: false,
          reason: 'Output was empty and unusable.',
        },
      },
    ];

    const detail = resolveAbortDetail(events, chainSteps, 'step rejected');

    expect(detail.stepIdx).toBe(0);
    expect(detail.score).toBe(20);
    expect(detail.ratingReason).toBe('Output was empty and unusable.');
  });
});
