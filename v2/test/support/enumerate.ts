// Enumerates every document of up to `maxLines` lines over a small alphabet of line shapes.
import { checkDocument } from './checks.ts'

/** Line shapes for the constructs of the first slice: each marker at a few indents, and the lines that end blocks. */
export const LINE_SHAPES = [
  '', 'a', '  a', '    a', '\ta',
  '- a', '  - a', '    - a', ' - a', '* a', '- [x] a', '-',
  '1. a', '  2. a', '3) a', '. a',
  '> a', '>', '  > a', '- > a',
  '```', '  ```', '~~~', '- ```',
  '= a', '***', '%% a', '  %% a',
] as const

export interface EnumerationResult {
  documents: number
  failures: string[]
}

const MAX_REPORTED = 20

/** Checks every document of exactly `lines` lines. A document is its lines joined by line feeds. */
export function enumerateDocuments(lines: number): EnumerationResult {
  const result: EnumerationResult = { documents: 0, failures: [] }
  const choice = new Array<number>(lines).fill(0)
  const parts = new Array<string>(lines).fill('')
  for (;;) {
    for (let at = 0; at < lines; at++) parts[at] = LINE_SHAPES[choice[at]!]!
    const src = parts.join('\n')
    result.documents++
    let failure: string | null
    try {
      failure = checkDocument(src)
    } catch (error) {
      failure = `threw ${String(error)}`
    }
    if (failure !== null && result.failures.length < MAX_REPORTED) {
      result.failures.push(`${JSON.stringify(src)}: ${failure}`)
    }
    let at = lines - 1
    while (at >= 0 && choice[at] === LINE_SHAPES.length - 1) choice[at--] = 0
    if (at < 0) return result
    choice[at]!++
  }
}
