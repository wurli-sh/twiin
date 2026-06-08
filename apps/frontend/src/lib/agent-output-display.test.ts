import { describe, expect, it } from 'vitest'
import {
  formatAgentJsonOutput,
  formatMetricLine,
  formatReportSectionContent,
} from '@/lib/agent-output-display'
import { parseReportMarkdown } from '@/lib/report-display'

describe('formatAgentJsonOutput', () => {
  it('formats dreamdex market JSON into readable metrics', () => {
    const formatted = formatAgentJsonOutput({
      type: 'dreamdex-mcp',
      source: 'dexscreener',
      action: 'orderbook',
      pair: 'SOMI/USDC',
      topPair: {
        symbol: 'SOMI',
        quote: 'USDC',
        priceUsd: '0.006800',
        liquidityUsd: 67902,
        volume24h: 1200,
        change24h: -2.4,
        dex: 'dreamDEX',
        chain: 'somnia',
      },
      findings: ['SOMI ~$0.006800 on dreamDEX (somnia)'],
      lpRiskHints: ['Liquidity above $50K — moderate depth for typical LP sizes'],
    })

    expect(formatted).toContain('**SOMI/USDC**')
    expect(formatted).toContain('Price: $0.006800')
    expect(formatted).toContain('Liquidity: $67.9K')
  })

  it('formats docs-lens JSON into question and deduped summary', () => {
    const formatted = formatAgentJsonOutput({
      type: 'docs-lens',
      source: 'somnia-docs',
      question: 'What are the main LP risks on dreamDEX?',
      docPath: 'readme',
      answered: true,
      summary: '• Slippage risk\n• Slippage risk\n• Impermanent loss',
      findings: ['Official Somnia docs query: What are the main LP risks on dreamDEX?'],
    })

    expect(formatted).toContain('Question: What are the main LP risks on dreamDEX?')
    expect(formatted).toContain('Slippage risk')
    expect((formatted?.match(/Slippage risk/g) ?? []).length).toBe(1)
  })
})

describe('formatReportSectionContent', () => {
  it('replaces raw JSON metric bullets with agent headings', () => {
    const raw = [
      '- **external-7**: {"type":"dreamdex-mcp","source":"dexscreener","pair":"SOMI/USDC","topPair":{"symbol":"SOMI","quote":"USDC","priceUsd":"0.006800","liquidityUsd":67902},"findings":["SOMI ~$0.006800"],"lpRiskHints":["Liquidity above $50K"]}',
      '- **external-8**: {"type":"docs-lens","question":"LP risks?","answered":true,"summary":"• Slippage","findings":["Official docs query"]}',
    ].join('\n')

    const formatted = formatReportSectionContent(raw, 'Key Metrics')

    expect(formatted).toContain('### DreamDEX market')
    expect(formatted).toContain('Price: $0.006800')
    expect(formatted).not.toContain('{"type":"dreamdex-mcp"')
    expect(formatted).toContain('### Somnia docs')
  })
})

describe('parseReportMarkdown', () => {
  it('formats Key Metrics section from briefsmith fallback briefs', () => {
    const brief = [
      '## Executive Summary',
      'Multi-agent pipeline executed.',
      '',
      '## Key Metrics',
      '- **external-7**: {"type":"dreamdex-mcp","source":"dexscreener","pair":"SOMI/USDC","topPair":{"symbol":"SOMI","quote":"USDC","priceUsd":"0.006800","liquidityUsd":67902},"findings":["SOMI ~$0.006800"],"lpRiskHints":["Liquidity above $50K"]}',
      '',
      '## Risks & Gaps',
      '- Brief generated in structured fallback mode.',
    ].join('\n')

    const parsed = parseReportMarkdown(brief)
    const metrics = parsed.sections.find((s) => s.title === 'Key Metrics')

    expect(metrics?.content).toContain('### DreamDEX market')
    expect(metrics?.content).toContain('Price: $0.006800')
    expect(metrics?.content).not.toContain('{"type":"dreamdex-mcp"')
  })
})

describe('formatMetricLine', () => {
  it('leaves non-json bullets unchanged', () => {
    expect(formatMetricLine('- **Confidence:** 65/100')).toBe('- **Confidence:** 65/100')
  })
})
