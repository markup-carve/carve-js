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
  it('keeps an interleaved losing label from taking a quoted follower (carve#5528)', () => {
    const source = '> [^n]: +\n> [^m]: d1\n> [^m]: +\n>\n>   para\n\nsee[^n][^m]\n'
    const html = carveToHtml(source)
    expect(html).toContain('<blockquote>\n\n</blockquote>')
    expect(html).toContain('<li id="fn1">\n      <p>para<a href="#fnref1"')
    expect(html).toContain('<li id="fn2">\n      <p>d1<a href="#fnref2"')
  })
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

  it('keeps the first indented list in the winner and a later sibling at the root (carve#5489)', () => {
    const html = carveToHtml('[^n]: +\n[^n]: +\n  - item\n- sibling\n\nsee[^n]\n')
    expect(html).toBe('<ul>\n  <li>sibling</li>\n</ul>\n' + see +
      '<section role="doc-endnotes" aria-label="Footnotes">\n  <hr>\n  <ol>\n    <li id="fn1">\n' +
      '      <ul>\n        <li>item</li>\n      </ul>\n' +
      '      <p><a href="#fnref1" role="doc-backlink" aria-label="Back to reference">↩</a></p>\n' +
      '    </li>\n  </ol>\n</section>')
  })

  it('does not consume a same-key marker outside the winner`s authored column', () => {
    const html = carveToHtml('  [^n]: +\n[^n]: +\n  - item\n\nsee[^n]\n')
    expect(html).toContain('<ul>\n  <li>item</li>\n</ul>')
    expect(html).toContain('<li id="fn1">\n      <p><a href="#fnref1"')
  })
})
