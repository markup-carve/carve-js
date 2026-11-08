import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

const F = '```'
const ref = '<a id="fnref1" href="#fn1" role="doc-noteref"><sup>1</sup></a>'

describe('an unprefixed line after a quoted note item that holds no open paragraph (CARVE-P2-008)', () => {
  it.each([
    ['fence on the note marker line', `> [^a]: - ${F}\nsee[^a]\n`],
    ['fence after a marker-line plus', `> [^a]: +\n> - ${F}\nsee[^a]\n`],
    ['fence payload after a marker-line plus', `> [^a]: +\n> - li\n>   ${F}\n>   code\nsee[^a]\n`],
  ])('ends the quote: %s', (_shape, source) => {
    const html = carveToHtml(source)
    expect(html).toMatch(/^<blockquote>\n\n<\/blockquote>\n<p>see/)
    expect(html).toContain(`<p>see${ref}</p>`)
    expect(html.match(/<pre>/g)).toHaveLength(1)
  })

  it('holds across quote depths, note leads, item markers and fence spellings', () => {
    let checked = 0
    for (const prefix of ['> ', '> > ', '>  '])
      for (const lead of ['[^a]: ', '[^a]: +\n'])
        for (const item of ['- ', '* ', '1. ', '- [ ] '])
          for (const fence of [F, `${F} x`, '~~~', '````']) {
            const lines = `${lead}${item}${fence}`.split('\n')
            const source = lines.map(line => prefix + line).join('\n') + '\nsee[^a]\n'
            expect(carveToHtml(source), source).toContain(`<p>see${ref}</p>`)
            expect(carveToHtml(source), source).not.toMatch(/<blockquote>\s*<p>see/)
            checked++
          }
    expect(checked).toBe(96)
  })
})
