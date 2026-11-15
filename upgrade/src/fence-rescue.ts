import { compareHtml } from './compare.ts'
import { html01, html02 } from './engines.ts'
import { recordOf, type ReportRecord } from './report.ts'
import { lineEnd, lineStart, lineText, readLines } from './source.ts'

interface Rescue {
  output: string
  record: ReportRecord
}

function listFence(text: string): string | null {
  const trimmed = text.trimStart()
  const first = trimmed[0]
  if (first !== '-' && first !== '*' && first !== '.') return null
  const marker = text.indexOf(first)
  const run = text.indexOf('```', marker + 1)
  if (run < 0 || text.slice(marker + 1, run).trim() !== '') return null
  return ' '.repeat(run) + '```'
}

function variants(output: string, mismatchLine: number): string[] {
  const lines = readLines(output)
  const found = new Set<string>()
  for (let open = 1; open <= lines.count; open++) {
    const closer = listFence(lineText(lines, open))
    if (closer === null || Math.abs(open - mismatchLine) > 6) continue
    for (let line = open + 1; line <= Math.min(lines.count, open + 8); line++) {
      const at = lineStart(lines, line)
      const text = lineText(lines, line)
      found.add(output.slice(0, at) + closer + '\n' + output.slice(at))
      if (text.trim() === '+') found.add(output.slice(0, at) + closer + output.slice(lineEnd(lines, line)))
    }
    found.add(output + (output.endsWith('\n') ? '' : '\n') + closer)
  }
  found.delete(output)
  return [...found]
}

/** C2-B-057, C2-B-109 and C2-B-111: close an item fence where 0.1 kept its body. */
export function rescueFence(input: string, output: string, mismatch: ReportRecord): Rescue | null {
  if (!input.includes('```')) return null
  const expected = html01(input)
  for (const candidate of variants(output, Math.max(1, mismatch.line))) {
    try {
      if (!compareHtml(expected, html02(candidate, false)).equal) continue
      return { output: candidate, record: recordOf('U-127', mismatch.line,
        'the fence was closed at the item boundary while preserving 0.1 HTML') }
    } catch { /* A candidate can fail to parse under the new grammar. */ }
  }
  return null
}
