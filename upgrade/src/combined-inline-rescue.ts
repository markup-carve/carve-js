import { compareHtml } from './compare.ts'
import { html01, html02 } from './engines.ts'
import { recordOf, type ReportRecord } from './report.ts'

interface Rescue { output: string; record: ReportRecord }

/** C2-I-049: the star run is literal, so use explicit nested spans. */
export function rescueCombinedInline(input: string, output: string, mismatch: ReportRecord): Rescue | null {
  const expected = html01(input)
  if (input.includes('/***/') && output.includes('*/*/*')) {
    const all = input.replaceAll('/***/', '{*{/*/}*}')
    if (compareHtml(expected, html02(all, false)).equal) {
      return { output: all, record: recordOf('U-145', mismatch.line,
        'the old nested strong and emphasis pairs were written as explicit 0.2 spans') }
    }
    let at = output.indexOf('*/*/*')
    while (at >= 0) {
      const candidate = output.slice(0, at) + '{*{/*/}*}' + output.slice(at + 5)
      if (compareHtml(expected, html02(candidate, false)).equal) {
        return { output: candidate, record: recordOf('U-145', mismatch.line,
          'the old nested strong and emphasis pair was written as explicit 0.2 spans') }
      }
      at = output.indexOf('*/*/*', at + 1)
    }
  }
  const lines = output.split('\n')
  for (let at = 0; at < lines.length; at++) {
    const line = lines[at]
    if (line === undefined || !line.startsWith('/') || !line.endsWith('/') || !line.includes(' /')) continue
    const moved = [...lines]
    moved[at] = `{${line}}`
    const candidate = moved.join('\n')
    if (!compareHtml(expected, html02(candidate, false)).equal) continue
    return { output: candidate, record: recordOf('U-145', mismatch.line,
      'the old slash pairing was written as one braced 0.2 emphasis span') }
  }
  return null
}
