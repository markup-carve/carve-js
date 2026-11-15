import { compareHtml } from './compare.ts'
import { html01, html02 } from './engines.ts'
import { recordOf, type ReportRecord } from './report.ts'
import { lineStart, lineText, readLines } from './source.ts'

interface Rescue {
  output: string
  record: ReportRecord
}

function percentRun(text: string): number {
  const start = text.length - text.trimStart().length
  let at = start
  while (text.charCodeAt(at) === 0x25) at++
  return at - start
}

/** C2-B-108, C2-B-110 and C2-B-114: outgrow a closer 0.1 kept inside the comment. */
export function rescuePercent(input: string, output: string, mismatch: ReportRecord): Rescue | null {
  if (!input.includes('%%%')) return null
  const expected = html01(input)
  const lines = readLines(output)
  const near = Math.max(1, mismatch.line)
  for (let line = Math.max(1, near - 4); line <= Math.min(lines.count, near + 4); line++) {
    const value = lineText(lines, line)
    const run = percentRun(value)
    if (run < 3) continue
    const start = lineStart(lines, line) + value.length - value.trimStart().length
    for (let length = run + 1; length <= Math.max(8, run + 3); length++) {
      const candidate = output.slice(0, start) + '%'.repeat(length) + output.slice(start + run)
      try {
        if (!compareHtml(expected, html02(candidate, false)).equal) continue
        return { output: candidate, record: recordOf('U-129', mismatch.line,
          'the comment fence was lengthened to retain the 0.1 opaque body') }
      } catch { /* A candidate can fail to parse under the new grammar. */ }
    }
  }
  return null
}
