import { describe, expect, it } from 'vitest'
import { carveToHtml, parse } from '../src/index.js'
import { perfIt, timeCalls } from './helpers/scaling.js'

// The definition prepass parses the document a second time to learn which lines
// a line block owns. A paragraph's inlines never decide that, so the probe must
// not pay for them: with inline-heavy prose the probe used to double the parse.
const prose = (lines: number): string =>
  Array.from({ length: lines }, (_, i) => `word *strong* _u_ [link](/u${i}) \`code\` [ref] more`).join('\n')

const withVerse = (lines: number): string => `${prose(lines)}\n\n::: |\nverse\n:::\n\n[ref]: /r\n`
// `::: v` is a div, so the prepass sees no line block and runs no probe.
const withoutVerse = (lines: number): string => `${prose(lines)}\n\n::: v\nverse\n:::\n\n[ref]: /r\n`

describe('the line-ownership probe', () => {
  it('still keeps a definition inside a line block out of the table', () => {
    const html = carveToHtml('[a][r] and [b][s]\n\n::: |\n[r]: /in\n:::\n\n[s]: /out\n')
    expect(html).toContain('<a href="/out">b</a>')
    expect(html).toContain('[r]: /in')
    expect(html).not.toContain('href="/in"')
  })

  it('leaves the main parse its positions', () => {
    const doc = parse('x\n\n::: |\nv\n:::\n\n[r]: /u\n')
    expect(doc.children[0]!.pos).toMatchObject({ startLine: 1, startColumn: 1 })
  })

  perfIt('adds little to a parse whose cost is paragraph text', () => {
    const a = withVerse(4_000)
    const b = withoutVerse(4_000)
    parse(a)
    parse(b)
    const ratios: number[] = []
    for (let round = 0; round < 5; round++) {
      const first = round % 2 === 0 ? a : b
      const second = first === a ? b : a
      const x = timeCalls(() => void parse(first), 200).msPerCall
      const y = timeCalls(() => void parse(second), 200).msPerCall
      ratios.push(first === a ? x / y : y / x)
    }
    ratios.sort((p, q) => p - q)
    // A probe that scans the prose reads ~1.65 here, one that skips it ~1.0.
    expect(ratios[2]!).toBeLessThan(1.3)
  })
})
