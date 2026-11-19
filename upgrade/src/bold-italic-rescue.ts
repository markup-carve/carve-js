import { compareHtmlExact } from './compare.ts'
import { makeContext } from './context.ts'
import { html01, html02 } from './engines.ts'
import { recordOf, type ReportRecord } from './report.ts'

interface Rescue { output: string; record: ReportRecord }

function respell(input: string, spans: { start: number; end: number }[], open: string, close: string): string {
  let text = input
  for (const { start, end } of [...spans].sort((a, b) => b.start - a.start)) {
    text = text.slice(0, start) + open + text.slice(start + 2, end - 2) + close + text.slice(end)
  }
  return text
}

// U-068: where the bare strong-outside-emphasis spelling lets 0.2 pair a delimiter inside the old
// content, the explicit braced spans keep it text. Only for a source whose sole rewrite is U-068.
export function rescueBracedBoldItalic(input: string, output: string, mismatch: ReportRecord): Rescue | null {
  if (!input.includes('/*')) return null
  const spans = makeContext(input).visits.map(({ node }) => node)
    .filter((node) => node.boldItalic === true && node.pos !== undefined
      && input.startsWith('/*', node.pos.startOffset) && input.startsWith('*/', node.pos.endOffset - 2))
    .map((node) => ({ start: node.pos!.startOffset, end: node.pos!.endOffset }))
  if (spans.length === 0 || respell(input, spans, '*/', '/*') !== output) return null
  const braced = respell(input, spans, '{*{/', '/}*}')
  if (!compareHtmlExact(html01(input), html02(braced, false)).equal) return null
  return { output: braced, record: recordOf('U-068', mismatch.line,
    'emphasis outside strong written as explicit braced spans so its content stays text') }
}
