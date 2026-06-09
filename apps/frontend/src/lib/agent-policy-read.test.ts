import { describe, expect, it } from 'vitest'
import { formatEther, parseEther } from 'viem'
import { formatPolicyStt, parsePoliciesTuple } from './agent-policy-read'

describe('parsePoliciesTuple', () => {
  it('maps deployed 6-field policies() tuple to named fields', () => {
    const dailyCapWei = parseEther('15')
    const maxPerTaskWei = parseEther('4.5')
    const maxPerTaskWeiTrustless = parseEther('1')
    const killSwitch = false
    const dailySpent = 0n
    const lastResetDay = 19876n

    const parsed = parsePoliciesTuple([
      dailyCapWei,
      maxPerTaskWei,
      maxPerTaskWeiTrustless,
      killSwitch,
      dailySpent,
      lastResetDay,
    ])

    expect(parsed.dailyCapWei).toBe(dailyCapWei)
    expect(parsed.maxPerTaskWei).toBe(maxPerTaskWei)
    expect(parsed.maxPerTaskWeiTrustless).toBe(maxPerTaskWeiTrustless)
    expect(parsed.killSwitch).toBe(false)
    expect(parsed.dailySpent).toBe(0n)
    expect(parsed.lastResetDay).toBe(lastResetDay)
  })

  it('does not treat maxPerTaskWeiTrustless as killSwitch', () => {
    const parsed = parsePoliciesTuple([
      parseEther('2'),
      parseEther('1'),
      parseEther('0.5'),
      true,
      parseEther('0.1'),
      1n,
    ])

    expect(parsed.killSwitch).toBe(true)
    expect(parsed.maxPerTaskWeiTrustless).toBe(parseEther('0.5'))
  })
})

describe('formatPolicyStt', () => {
  it('formats zero wei as four-decimal STT string', () => {
    expect(formatPolicyStt(0n)).toBe('0.0000')
  })

  it('does not pass booleans to formatEther', () => {
    expect(formatPolicyStt(0n)).not.toContain('false')
    expect(formatPolicyStt(0n)).not.toContain('true')
    // Regression guard: formatEther(killSwitch) produced the broken DAILY column.
    expect(formatEther(false as unknown as bigint)).toBe('0.0000000000000false')
  })
})
