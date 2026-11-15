import { compareHtml } from './compare.ts'
import { html01, html02 } from './engines.ts'
import { recordOf, type ReportRecord } from './report.ts'
import { lineEnd, lineStart, lineText, readLines } from './source.ts'

interface Rescue {
  output: string
  record: ReportRecord
}

function plusEntry(source: string): string {
  const line = source.split('\n').find((value) => value.includes('+'))?.trimStart() ?? ''
  if (line.startsWith('[^') || line.includes(']: +')) return 'U-124'
  if (line.startsWith('::') || line.startsWith(':')) return 'U-123'
  if (line.startsWith('- ') || line.startsWith('* ') || line.startsWith('. ')) return 'U-122'
  if (line.startsWith('>')) return 'U-125'
  return 'U-122'
}

function replaceLine(source: string, line: number, replacement: string): string {
  const lines = readLines(source)
  return source.slice(0, lineStart(lines, line)) + replacement + source.slice(lineEnd(lines, line))
}

function removeLine(source: string, line: number): string {
  const lines = readLines(source)
  return source.slice(0, lineStart(lines, line)) + source.slice(lineStart(lines, line + 1))
}

function candidates(source: string): string[] {
  const lines = readLines(source)
  const found = new Set<string>()
  for (let line = 1; line <= lines.count; line++) {
    const current = lineText(lines, line)
    const plus = current.lastIndexOf('+')
    if (plus < 0) continue
    const without = current.slice(0, plus) + current.slice(plus + 1)
    found.add(source.slice(0, lineStart(lines, line)) + '\n' + source.slice(lineStart(lines, line)))
    found.add(replaceLine(source, line, without.trimEnd()))
    found.add(replaceLine(source, line, current.slice(0, plus) + '{% %}' + current.slice(plus + 1)))
    if (line < lines.count) {
      const next = lineText(lines, line + 1)
      for (let indent = 0; indent <= 12; indent++) {
        const moved = replaceLine(source, line + 1, ' '.repeat(indent) + next.trimStart())
        found.add(replaceLine(moved, line, current.slice(0, plus).trimEnd()))
        found.add(replaceLine(moved, line, ''))
      }
    }
    found.add(removeLine(source, line))
  }
  for (let line = 2; line < lines.count; line++) {
    if (lineText(lines, line).trim() !== '') continue
    if (lineText(lines, line - 1).trim().startsWith('>') && lineText(lines, line + 1).trim().startsWith('>')) {
      found.add(removeLine(source, line))
    }
  }
  found.delete(source)
  return [...found]
}

export function rescuePlus(input: string, output: string, mismatch: ReportRecord): Rescue | null {
  if (!input.includes('+') || mismatch.line === 0) return null
  const entry = plusEntry(input)
  const expected = html01(input)
  for (const candidate of candidates(output)) {
    try {
      if (!compareHtml(expected, html02(candidate, false)).equal) continue
      return { output: candidate, record: recordOf(entry, mismatch.line,
        'the continuation marker was replaced with 0.2 block ownership while preserving 0.1 HTML') }
    } catch { /* Candidate is not a 0.2 document. */ }
  }
  return null
}
