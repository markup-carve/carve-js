import { describe, expect, it } from 'vitest'
import { carveToCarve, carveToHtml } from '../src/index.js'

// carve#5474, ruled A: a losing duplicate's `+` takes nothing, so the block below it stays the host's.
const note = (body: string): string => [
  '<section role="doc-endnotes" aria-label="Footnotes">',
  '  <hr>',
  '  <ol>',
  '    <li id="fn1">',
  `      <p>${body}<a href="#fnref1" role="doc-backlink" aria-label="Back to reference">↩</a></p>`,
  '    </li>',
  '  </ol>',
  '</section>',
].join('\n')
const see = '<p>see<a id="fnref1" href="#fn1" role="doc-noteref"><sup>1</sup></a></p>\n'

const cases: Array<[string, string, string]> = [
  ['the ruling reproduction', '[^a]: x\n[^a]: +\n flush\n\nsee[^a]\n', `<p>flush</p>\n${see}${note('x')}`],
  ['a follower at the marker column', '[^a]: x\n[^a]: +\nflush\n\nsee[^a]\n', `<p>flush</p>\n${see}${note('x')}`],
  ['a winner with its own `+`', '[^a]: +\n x\n[^a]: +\n flush\n\nsee[^a]\n', `<p>flush</p>\n${see}${note('x')}`],
  ['three definitions', '[^a]: x\n[^a]: +\n[^a]: +\n flush\n\nsee[^a]\n', `<p>flush</p>\n${see}${note('x')}`],
  ['a label spelled with a space run', '[^L L]: x\n[^L  L]: +\nflush\n\nsee[^L L]\n', `<p>flush</p>\n${see}${note('x')}`],
  ['a quote host', '> [^a]: x\n> [^a]: +\n>  flush\n\nsee[^a]\n', `<blockquote><p>flush</p></blockquote>\n${see}${note('x')}`],
]

describe('a losing duplicate footnote definition`s + takes nothing', () => {
  for (const [name, source, html] of cases) {
    it(name, () => {
      expect(carveToHtml(source)).toBe(html)
      expect(carveToHtml(carveToCarve(source))).toBe(html)
    })
  }

  it('a same-key loser the winner`s `+` skips leaves the attached block to the winner', () => {
    const html = carveToHtml('[^L L]: +\n[^L  L]: +\n- item\n\nsee[^L L]\n')
    expect(html).toContain('<li id="fn1">\n      <ul>\n        <li>item</li>')
  })
})
