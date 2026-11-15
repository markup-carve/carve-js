import { compareHtml } from './compare.ts'
import { html01, html02 } from './engines.ts'
import { recordOf, type ReportRecord } from './report.ts'

interface Rescue { output: string; record: ReportRecord }

function plain(value: string): boolean {
  if (value.length === 0) return false
  for (const character of value) {
    const code = character.charCodeAt(0)
    if (code >= 48 && code <= 57 || code >= 65 && code <= 90 || code >= 97 && code <= 122
      || character === ' ' || character === '-') continue
    return false
  }
  return true
}

function bracketCandidates(output: string): string[] {
  const found: string[] = []
  const opener = '^[/[^['
  let start = output.indexOf(opener)
  while (start >= 0) {
    const labelEnd = output.indexOf(']', start + 6)
    if (labelEnd >= 0 && output.slice(labelEnd, labelEnd + 4) === ']/] ') {
      const end = output.indexOf('/]', labelEnd + 4)
      const label = output.slice(start + 6, labelEnd)
      const tail = end < 0 ? '' : output.slice(labelEnd + 4, end)
      if (end >= 0 && plain(label) && plain(tail)) {
        const after = `^[{/\\[\\^[${label}]\\/\\] ${tail}/}]`
        found.push(output.slice(0, start) + after + output.slice(end + 2))
      }
    }
    start = output.indexOf(opener, start + 1)
  }
  return found
}

/** C2-I-044, C2-I-047: spell the nested bracket run as literal emphasis content. */
export function rescueNestedNote(input: string, output: string, mismatch: ReportRecord): Rescue | null {
  const before = '^[{+[^[g]+}] b+}]'
  const after = '^[{+\\[\\^[g]\\+\\}\\] b+}]'
  const variants = bracketCandidates(output)
  if (output.includes(before)) variants.push(output.replace(before, after))
  for (const candidate of variants) {
    if (!compareHtml(html01(input), html02(candidate, false)).equal) continue
    return { output: candidate, record: recordOf('U-257', mismatch.line,
      'the bracket run in the old inline note was written as literal braced span content') }
  }
  return null
}
