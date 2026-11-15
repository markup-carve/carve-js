import { compareHtml } from './compare.ts'
import { html01, html02 } from './engines.ts'
import { recordOf, type ReportRecord } from './report.ts'
import { isBlank, lineStart, lineText, readLines } from './source.ts'

interface Rescue {
  output: string
  record: ReportRecord
}

/** C2-B-031 and C2-B-032: a quote that 0.1 opens after text may be a lazy line in 0.2. */
export function rescueQuote(input: string, output: string, mismatch: ReportRecord): Rescue | null {
  if (!input.includes('>')) return null
  const expected = html01(input)
  const lines = readLines(output)
  const near = Math.max(1, mismatch.line)
  for (let line = Math.max(2, near - 3); line <= Math.min(lines.count, near + 3); line++) {
    const current = lineText(lines, line)
    if (current.charCodeAt(current.length - current.trimStart().length) !== 0x3e) continue
    if (isBlank(lineText(lines, line - 1))) continue
    const at = lineStart(lines, line)
    const candidate = output.slice(0, at) + '\n' + output.slice(at)
    try {
      if (!compareHtml(expected, html02(candidate, false)).equal) continue
      return { output: candidate, record: recordOf('U-126', mismatch.line,
        'a blank line opens the quote under the 0.2 paragraph boundary rule') }
    } catch { /* A candidate can fail to parse under the new grammar. */ }
  }
  return null
}
