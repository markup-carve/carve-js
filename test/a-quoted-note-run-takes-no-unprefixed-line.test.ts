import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

const endnote = (text: string): string =>
  '<p>x<a id="fnref1" href="#fn1" role="doc-noteref"><sup>1</sup></a></p>\n' +
  '<section role="doc-endnotes" aria-label="Footnotes">\n  <hr>\n  <ol>\n    <li id="fn1">\n' +
  `      <p>b\n${text}<a href="#fnref1" role="doc-backlink" aria-label="Back to reference">↩</a></p>\n` +
  '    </li>\n  </ol>\n</section>'

// A run in a container takes no lazy lines, and a refused run claims none (carve#5830 rules A and B).
describe('a quoted note run takes no unprefixed line (carve-js#4917)', () => {
  it('ends the quote and the note at an unprefixed marker after an open run', () => {
    expect(carveToHtml('> [^n]: b\n> {.x\n- s\n\nx[^n]\n')).toBe(
      '<blockquote>\n\n</blockquote>\n<ul>\n  <li>s</li>\n</ul>\n' + endnote('{.x'),
    )
  })

  it('keeps the lines after a refused run as lazy text of the note', () => {
    expect(carveToHtml('> [^n]: b\n>   {.x\n   }\nq\n\nx[^n]\n')).toBe('<blockquote>\n\n</blockquote>\n' + endnote('{.x\n}\nq'))
    expect(carveToHtml('> [^n]: b\n>   {.x\n   .y}\nq\n\nx[^n]\n')).toBe('<blockquote>\n\n</blockquote>\n' + endnote('{.x\n.y}\nq'))
  })
})
