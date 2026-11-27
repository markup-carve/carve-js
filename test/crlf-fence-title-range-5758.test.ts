import { expect, it } from 'vitest'
import { parseWithDiagnostics } from '../src/index.ts'

it('C2-B-010, C2-B-122, C2-W-138: fence title ranges end before a CRLF', () => {
  for (const [source, range] of [
    ['```é\r\nx\r\n```\r\n', [3, 5]],
    ['```é\nx\n```\n', [3, 5]],
    ['```é\r', [3, 6]],
    ['::: note é\r\nx\r\n:::\r\n', [9, 11]],
  ] as const) {
    const finding = parseWithDiagnostics(source).diagnostics.find((entry) => entry.code === 'fence-title-syntax')
    expect(finding?.range, source).toMatchObject({ startOffset: range[0], endOffset: range[1] })
  }
})
