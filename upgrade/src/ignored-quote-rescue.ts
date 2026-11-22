import { compareHtmlExact } from './compare.ts'
import { html01, html02 } from './engines.ts'
import { recordOf, type ReportRecord } from './report.ts'
import { lineEnd, lineStart, lineText, readLines } from './source.ts'

/** A quote line swallowed by the old parser can be omitted when both complete renders prove that it had no effect. */
export function rescueIgnoredQuote(input: string, output: string, mismatch: ReportRecord):
  { output: string; record: ReportRecord } | null {
  if (!input.includes('[^') || !output.includes('>') || mismatch.line < 1) return null
  const lines = readLines(output)
  const old = html01(input)
  const first = Math.max(1, mismatch.line - 2)
  const last = Math.min(lines.count, mismatch.line + 2)
  for (let line = first; line <= last; line++) {
    if (!/^\s*>\s+\S/u.test(lineText(lines, line))) continue
    const start = lineStart(lines, line)
    const end = line < lines.count ? lineStart(lines, line + 1) : lineEnd(lines, line)
    const candidate = output.slice(0, start) + output.slice(end)
    try {
      if (!compareHtmlExact(old, html01(candidate)).equal || !compareHtmlExact(old, html02(candidate, false)).equal) continue
      return { output: candidate, record: { ...recordOf('U-209', line,
        'a quote line the old parser did not render was omitted'), class: 'rewrite' } }
    } catch { /* A candidate can be invalid under either grammar. */ }
  }
  return null
}
