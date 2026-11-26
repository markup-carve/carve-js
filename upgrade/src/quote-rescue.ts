import { compareHtml } from './compare.ts'
import { html01, html02 } from './engines.ts'
import { recordOf, type ReportRecord } from './report.ts'
import { isBlank, lineStart, lineText, readLines } from './source.ts'

interface Rescue {
  output: string
  record: ReportRecord
}

function quoteCodeParagraphVariants(input: string, output: string): string[] {
  if (!input.includes('> +') || !input.includes(': ```')) return []
  const lines = output.split('\n')
  const found: string[] = []
  const all = [...lines]
  let count = 0
  for (let at = lines.length - 2; at >= 0; at--) {
    const value = lines[at] ?? ''
    if (!value.trimStart().startsWith('> : ```') || !(lines[at + 1] ?? '').trimStart().startsWith('> ')) continue
    const mark = value.slice(0, value.indexOf('>')) + '>'
    all.splice(at + 1, 0, mark)
    if (found.length < 8) {
      const one = [...lines]
      one.splice(at + 1, 0, mark)
      found.push(one.join('\n'))
    }
    count++
  }
  if (count > 1) found.unshift(all.join('\n'))
  return found
}

/** C2-B-031, C2-B-032, C2-B-059, C2-I-015: a quote boundary may separate code-span paragraphs. */
export function rescueQuote(input: string, output: string, mismatch: ReportRecord): Rescue | null {
  if (!input.includes('>')) return null
  const expected = html01(input)
  for (const candidate of quoteCodeParagraphVariants(input, output)) {
    if (!compareHtml(expected, html02(candidate, false)).equal) continue
    return { output: candidate, record: recordOf('U-125', mismatch.line,
      'an empty quote line separates the old code span and following paragraph') }
  }
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
