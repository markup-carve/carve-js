import { compareHtmlExact } from './compare.ts'
import { html01, html02 } from './engines.ts'
import { recordOf, type ReportRecord } from './report.ts'
import { lineEnd, lineStart, lineText, readLines } from './source.ts'

function originalLine(input: string, value: string, fallback: number): number {
  const lines = readLines(input)
  for (let line = 1; line <= lines.count; line++) {
    if (lineText(lines, line).trimStart() === value.trimStart()) return line
  }
  return fallback
}

/** A line swallowed by the old parser can be omitted when both complete renders prove that it had no effect. */
export function rescueIgnoredLine(input: string, output: string, mismatch: ReportRecord):
  { output: string; record: ReportRecord } | null {
  if (!input.includes('[^') || mismatch.line < 1) return null
  const lines = readLines(output)
  const old = html01(input)
  const first = Math.max(1, mismatch.line - 2)
  const last = Math.min(lines.count, mismatch.line + 2)
  const candidates: number[] = []
  for (let line = first; line <= last; line++) {
    if (/^[ \t]*>[ \t]+\S/u.test(lineText(lines, line))) candidates.push(line)
  }
  for (let line = 1; line <= Math.min(4, lines.count); line++) {
    if (/^[ \t]*\[\^[^\]\n]+\]:/u.test(lineText(lines, line))) candidates.push(line)
  }
  for (const line of new Set(candidates)) {
    const start = lineStart(lines, line)
    const end = line < lines.count ? lineStart(lines, line + 1) : lineEnd(lines, line)
    const candidate = output.slice(0, start) + output.slice(end)
    try {
      if (!compareHtmlExact(old, html01(candidate)).equal || !compareHtmlExact(old, html02(candidate, false)).equal) continue
      return { output: candidate, record: { ...recordOf('U-209', originalLine(input, lineText(lines, line), mismatch.line),
        'a line the old parser did not render was omitted after complete HTML verification'), class: 'rewrite' } }
    } catch { /* A candidate can be invalid under either grammar. */ }
  }
  return null
}
