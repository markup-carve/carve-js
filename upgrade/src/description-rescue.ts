import { compareHtml } from './compare.ts'
import { html01, html02 } from './engines.ts'
import { recordOf, type ReportRecord } from './report.ts'
import { lineEnd, lineStart, lineText, readLines } from './source.ts'

interface Rescue {
  output: string
  record: ReportRecord
}

function variants(output: string, mismatchLine: number): string[] {
  const lines = readLines(output)
  const found = new Set<string>()
  for (let line = Math.max(1, mismatchLine - 3); line <= Math.min(lines.count, mismatchLine + 3); line++) {
    const value = lineText(lines, line)
    const trimmed = value.trimStart()
    const start = lineStart(lines, line)
    const end = lineEnd(lines, line)
    if (trimmed.startsWith(':: ') || trimmed.startsWith(': ')) {
      for (let indent = 0; indent <= 8; indent++) {
        const candidate = output.slice(0, start) + ' '.repeat(indent) + trimmed + output.slice(end)
        if (candidate !== output) found.add(candidate)
      }
    }
    const above = lineText(lines, line - 1).trimStart()
    const block = trimmed.startsWith('# ') || trimmed.startsWith('```') || trimmed.startsWith(':::')
    if (value !== trimmed && block && (above.startsWith(': ') || above === '')) {
      found.add(output.slice(0, start) + trimmed + output.slice(end))
      if (above !== '') found.add(output.slice(0, start) + '\n' + trimmed + output.slice(end))
    }
  }
  return [...found]
}

/** C2-B-069, C2-B-076 and C2-B-078: put the mark and body at an owning column. */
export function rescueDescription(input: string, output: string, mismatch: ReportRecord): Rescue | null {
  if (!input.includes('::')) return null
  const expected = html01(input)
  for (const candidate of variants(output, Math.max(1, mismatch.line))) {
    try {
      if (!compareHtml(expected, html02(candidate, false)).equal) continue
      const id = input.startsWith(':: ') && candidate.startsWith(' :: ') ? 'U-180' : 'U-128'
      return { output: candidate, record: recordOf(id, mismatch.line,
        'the description mark was moved to its 0.2 ownership column while preserving 0.1 HTML') }
    } catch { /* A candidate can fail to parse under the new grammar. */ }
  }
  return null
}
