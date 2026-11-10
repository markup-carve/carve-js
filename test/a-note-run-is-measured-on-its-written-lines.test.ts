import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

const endnote = (text: string): string =>
  '<p>x<a id="fnref1" href="#fn1" role="doc-noteref"><sup>1</sup></a></p>\n' +
  '<section role="doc-endnotes" aria-label="Footnotes">\n  <hr>\n  <ol>\n    <li id="fn1">\n' +
  `      <p>b\n${text}<a href="#fnref1" role="doc-backlink" aria-label="Back to reference">↩</a></p>\n` +
  '    </li>\n  </ol>\n</section>'

// A refused run is lazy text of the note; it claims no lines (carve#5830 rules A and B).
describe('a note run is measured on its written lines', () => {
  it('keeps a refused run on a note lazy line in an item (carve-js#4910)', () => {
    const items = '<ul>\n  <li></li>\n  <li>s</li>\n</ul>\n'
    expect(carveToHtml('- [^n]: b\n  {.x\n .y}\n- s\n\nx[^n]\n')).toBe(items + endnote('{.x\n.y}'))
    expect(carveToHtml('- [^n]: b\n  {#i\n .y}\n- s\n\nx[^n]\n')).toBe(items + endnote('{<span class="tag"><strong>#i</strong></span>\n.y}'))
    expect(carveToHtml('- [^n]: b\n  {.x\n  .y}\n- s\n\nx[^n]\n')).toBe(items + endnote('{.x\n.y}'))
  })

  it('refuses a quoted note run with an unprefixed continuation', () => {
    expect(carveToHtml('> [^n]: b\n>   {.x\n   .y}\n\nx[^n]\n')).toBe(
      '<blockquote>\n\n</blockquote>\n' + endnote('{.x\n.y}'),
    )
    expect(carveToHtml('> - [^n]: b\n>   {.x\n   .y}\n- s\n\nx[^n]\n')).toBe(
      '<blockquote>\n  <ul>\n    <li></li>\n  </ul>\n</blockquote>\n<ul>\n  <li>s</li>\n</ul>\n' + endnote('{.x\n.y}'),
    )
  })

  it('leaves a sibling item after a quoted refused comment opener outside the quote (carve-js#4908)', () => {
    expect(carveToHtml('> - x\n> {% a\n> {% a\n z %}\n- sibling\n')).toBe(
      '<blockquote>\n  <ul>\n    <li>x\n{% a\n{% a\nz %}</li>\n  </ul>\n</blockquote>\n<ul>\n  <li>sibling</li>\n</ul>',
    )
  })
})
