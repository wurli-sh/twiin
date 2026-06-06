export type ReportSection = {
  title: string
  content: string
}

export type ParsedReport = {
  title: string
  sections: ReportSection[]
  footnote?: string
  isMetricTable: boolean
}

function stripMarkdownInline(text: string): string {
  return text.replace(/\*\*/g, '').replace(/_/g, '').trim()
}

function isSectionHeading(line: string): boolean {
  const trimmed = line.trim()
  if (!trimmed) return false
  if (/^Section\s+\d+:/i.test(trimmed)) return true
  if (/^\*\*.+\*\*$/.test(trimmed) && trimmed.length < 120) return true
  if (/^#{1,3}\s+/.test(trimmed)) return true
  return false
}

function headingFromLine(line: string): string {
  const trimmed = line.trim()
  const h = trimmed.match(/^#{1,3}\s+(.+)$/)
  if (h) return stripMarkdownInline(h[1])
  return stripMarkdownInline(trimmed)
}

export function parseReportMarkdown(text: string): ParsedReport {
  const trimmed = text.trim()
  if (!trimmed) {
    return { title: 'Agent report', sections: [{ title: '', content: '_No result returned._' }], isMetricTable: false }
  }

  if (trimmed.includes('| Metric |') || trimmed.includes('| --- |')) {
    const titleMatch = trimmed.match(/^###\s+(.+?)(?:\n|$)/)
    const title = titleMatch ? stripMarkdownInline(titleMatch[1]) : 'Metrics snapshot'
    const body = titleMatch ? trimmed.slice(titleMatch[0].length).trim() : trimmed
    return {
      title,
      sections: [{ title: '', content: body }],
      isMetricTable: true,
    }
  }

  let working = trimmed
  let title = 'Agent report'

  const h3Match = working.match(/^###\s+(.+?)(?:\n|$)/)
  if (h3Match) {
    title = stripMarkdownInline(h3Match[1])
    working = working.slice(h3Match[0].length).trim()
  }

  const footnoteMatch = working.match(/\n_([^_\n]+)_\s*$/)
  let footnote: string | undefined
  if (footnoteMatch) {
    footnote = footnoteMatch[1]
    working = working.slice(0, footnoteMatch.index).trim()
  }

  const blocks = working
    .split(/\n(?:---+|\*\*\*+)\n/)
    .map((b) => b.trim())
    .filter(Boolean)

  if (blocks.length <= 1) {
    const lines = working.split('\n')
    const sections: ReportSection[] = []
    let current: ReportSection | null = null

    for (const line of lines) {
      if (isSectionHeading(line)) {
        if (current) sections.push(current)
        current = { title: headingFromLine(line), content: '' }
        continue
      }
      if (!current) {
        current = { title: '', content: line }
      } else if (!current.content) {
        current.content = line
      } else {
        current.content += `\n${line}`
      }
    }
    if (current) sections.push(current)

  if (sections.length > 1 || sections.some((s) => s.title)) {
    if (title === 'Agent report') {
      const conclusion = [...sections]
        .reverse()
        .find((s) => /conclusion|summary|overview|report/i.test(s.title))
      const pick = conclusion ?? sections.find((s) => s.title)
      if (pick?.title) {
        title = pick.title.replace(/^Section\s+\d+:\s*/i, '').trim()
      }
    }
    return { title, sections, footnote, isMetricTable: false }
  }

    return {
      title,
      sections: [{ title: '', content: working }],
      footnote,
      isMetricTable: false,
    }
  }

  const sections = blocks.map((block) => {
    const lines = block.split('\n')
    const first = lines[0]?.trim() ?? ''
    if (isSectionHeading(first)) {
      return {
        title: headingFromLine(first),
        content: lines.slice(1).join('\n').trim(),
      }
    }
    return { title: '', content: block }
  })

  if (title === 'Agent report') {
    const conclusion = [...sections]
      .reverse()
      .find((s) => /conclusion|summary|overview|report/i.test(s.title))
    const pick = conclusion ?? sections.find((s) => s.title)
    if (pick?.title) {
      title = pick.title.replace(/^Section\s+\d+:\s*/i, '').trim()
    }
  }

  return { title, sections, footnote, isMetricTable: false }
}

export function budgetUsagePercent(spent: string, budget: string): number {
  const spentNum = Number(spent)
  const budgetNum = Number(budget)
  if (!Number.isFinite(spentNum) || !Number.isFinite(budgetNum) || budgetNum <= 0) {
    return 0
  }
  return Math.min(100, (spentNum / budgetNum) * 100)
}
