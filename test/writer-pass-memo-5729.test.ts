import { describe, expect, it } from 'vitest'
import { formatWithDiagnostics } from '../src/index.ts'

const unit = '\\[^[\\`[`[[^]\\[]][]\\['

// C2-W-005, C2-W-075, C2-W-088 (carve-js#5729): every pass of the rounds loses a node of this paragraph, the closer
// kinds add no kind beside the others, and the group is written as authored.
describe('C2-W-088: the carve-php#6119 paragraph keeps its authored spelling (carve-js#5729)', () => {
  const repeated = `${unit}\n\n`.repeat(200)
  it.each([
    ['one paragraph', `${unit}\n`, `${unit}\n`],
    ['200 paragraphs', repeated, repeated.slice(0, -1)],
    ['in a quote', `> ${unit}\n`, `> ${unit}\n`],
    ['in a list item', `- ${unit}\n`, `- ${unit}\n`],
    ['beside a definition', `${unit}\n\n[x]: /u\n`, `${unit}\n\n[x]: /u\n`],
  ])('%s', (_, source, expected) => {
    const out = formatWithDiagnostics(source)
    expect(out.diagnostics).toEqual([])
    expect(out.source).toBe(expected)
  })
})
