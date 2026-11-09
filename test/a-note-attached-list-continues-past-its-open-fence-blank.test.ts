import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

const F = '```'
const ref = '<a id="fnref1" href="#fn1" role="doc-noteref"><sup>1</sup></a>'
const backlink = '<p><a href="#fnref1" role="doc-backlink" aria-label="Back to reference">↩</a></p>'

describe('a sibling item after the blank of an open child fence in a note-attached list (carve#5555)', () => {
  it('keeps the sibling in the attached list', () => {
    expect(carveToHtml(`[^a]: +\n- li\n  ${F}\n  > quoted\n\n- sibling\n\nsee[^a]\n`)).toBe(
      `<p>see${ref}</p>\n<section role="doc-endnotes" aria-label="Footnotes">\n  <hr>\n  <ol>\n    <li id="fn1">\n` +
      '      <ul>\n        <li><p>li</p>\n          <pre><code>&gt; quoted\n\n</code></pre>\n        </li>\n' +
      `        <li><p>sibling</p></li>\n      </ul>\n      ${backlink}\n    </li>\n  </ol>\n</section>`)
  })

  it('reads a fence on the item marker line the same way', () => {
    const html = carveToHtml(`[^a]: +\n- ${F}\n\n- sib\n\nsee[^a]\n`)
    expect(html).toMatch(/^<p>see/)
    expect(html).toContain('<li><p>sib</p></li>\n      </ul>')
  })

  it('holds across markers, nesting, fences, payloads and blank runs', () => {
    let checked = 0
    for (const [lead, indent, sibling] of [['- li', '  ', '- sib'], ['1. li', '   ', '2. sib'], ['- a\n  - li', '    ', '  - sib'], ['- ', '  ', '- sib']] as const)
      for (const fence of [F, `${F} x`, '~~~', '````'])
        for (const payload of [[], ['code'], ['code', 'more']])
          for (const blanks of ['\n', '\n\n']) {
            const opener = lead === '- ' ? `- ${fence}` : `${lead}\n${indent}${fence}`
            const body = [opener, ...payload.map(line => indent + line)].join('\n')
            const source = `[^a]: +\n${body}\n${blanks}${sibling}\n\nsee[^a]\n`
            const html = carveToHtml(source)
            expect(html, source).toMatch(/^<p>see/)
            expect(html, source).toContain('<p>sib</p>')
            expect(html.match(/<pre>/g), source).toHaveLength(1)
            checked++
          }
    expect(checked).toBe(96)
  })
})
