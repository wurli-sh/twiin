import type { Address, PublicClient } from 'viem'
import { formatEther, parseEther } from 'viem'
import {
  AgentOrchestratorAbi,
  TwiinAccountAbi,
  CONTRACTS,
} from '@/config/contracts'
import { readContract } from '@/lib/read-contract'

export type CreateTaskPreflight = {
  ok: boolean
  errors: string[]
}

const REVERT_HINTS: Record<string, string> = {
  '0x9d6f73cb': `Plan has too many steps (on-chain limit is 8). Re-plan with fewer steps.`,
  'badstepcount': 'Plan has too many steps (on-chain limit is 8). Re-plan with fewer steps.',
  'kill switch active': 'Kill switch is ON — go to Agents and click Enable first.',
  'exceeds per-task cap': 'Task budget exceeds your per-task cap (default 1 STT). Lower the budget or raise policy limits.',
  'daily cap exceeded': 'Task budget would exceed the daily cap (default 2 STT).',
  'task already active': 'This agent already has a running task. Wait for it to finish or abort.',
  'value != budgetWei': '6551 wallet balance is too low for this budget. Fund the agent wallet on Agents.',
  'not owner': 'Connected wallet is not the NFT owner for this agent.',
  'not agent': '6551 account does not match the agent ID in the plan.',
  'bad step count': 'Plan has too many steps (on-chain limit is 8). Re-plan with fewer steps.',
  'no budget': 'Task budget must be greater than 0.',
}

export function explainRevertReason(raw: string): string {
  const lower = raw.toLowerCase()
  for (const [key, hint] of Object.entries(REVERT_HINTS)) {
    if (lower.includes(key)) return hint
  }
  return raw.length > 160 ? `${raw.slice(0, 160)}…` : raw
}

export async function preflightCreateTask(
  publicClient: PublicClient,
  input: {
    owner: Address
    personalAgentId: bigint
    tbaAddress: Address
    orchestrator: Address
    budgetWei: bigint
    createTaskCalldata: `0x${string}`
    killSwitch: boolean
    maxPerTaskStt: string
    dailyCapStt: string
    dailySpentStt: string
  },
): Promise<CreateTaskPreflight> {
  const errors: string[] = []

  if (input.killSwitch) {
    errors.push(REVERT_HINTS['kill switch active'])
  }

  const budget = input.budgetWei
  const balance = await publicClient.getBalance({ address: input.tbaAddress })
  const maxPerTask = parseEther(input.maxPerTaskStt || '0')
  const dailyCap = parseEther(input.dailyCapStt || '0')
  const dailySpent = parseEther(input.dailySpentStt || '0')

  if (budget > balance) {
    errors.push(
      `6551 wallet has ${formatEther(balance)} STT but task needs ${formatEther(budget)} STT.`,
    )
  }
  if (maxPerTask > 0n && budget > maxPerTask) {
    errors.push(
      `Budget ${formatEther(budget)} STT exceeds per-task cap ${input.maxPerTaskStt} STT.`,
    )
  }
  if (dailyCap > 0n && dailySpent + budget > dailyCap) {
    errors.push(
      `Would exceed daily cap (${input.dailySpentStt}/${input.dailyCapStt} STT spent).`,
    )
  }

  try {
    const lockedTaskId = await readContract<bigint>(publicClient, {
      address: CONTRACTS.orchestrator.address,
      abi: AgentOrchestratorAbi,
      functionName: 'taskLock',
      args: [input.personalAgentId],
    })
    if (lockedTaskId > 0n) {
      errors.push(`Task #${lockedTaskId.toString()} is still active for this agent.`)
    }
  } catch {
    // non-fatal — simulation below is authoritative
  }

  if (errors.length > 0) return { ok: false, errors }

  try {
    await publicClient.simulateContract({
      account: input.owner,
      address: input.tbaAddress,
      abi: TwiinAccountAbi,
      functionName: 'execute',
      args: [input.orchestrator, input.budgetWei, input.createTaskCalldata, 0],
    })
    return { ok: true, errors: [] }
  } catch (e: unknown) {
    const raw = e instanceof Error ? e.message : String(e)
    return { ok: false, errors: [explainRevertReason(raw)] }
  }
}
