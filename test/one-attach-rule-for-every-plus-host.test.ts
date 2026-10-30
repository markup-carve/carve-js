import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'
import { lintCarve } from '../src/lint.js'
import { generate, withLetter, violation } from './fixtures/refused-plus-cases.mjs'

const flat = (html: string): string => html.replace(/>\s+</g, '><').replace(/\s+/g, ' ').trim()

const expected: [string, string, string][] = [
  ['carve#4409: a list follower attaches on the marker line', ':: t\n: +\n- l\n', '<dl><dt>t</dt><dd><ul><li>l</li></ul></dd></dl>'],
  ['carve#4409: a refused marker-line plus takes a lazy line', ':: t\n: - +\np\n', '<dl><dt>t</dt><dd><ul><li>+ p</li></ul></dd></dl>'],
  ['carve#4409: an off-column follower is not pulled', '- a\n  * +\n[r]: /u\n  after\n', '<ul><li>a <ul><li>+</li></ul></li></ul><p>after</p>'],
  ['carve#4409 sub-ruling 1: a note at column 0', '[^a]: +\n# H\n\nr[^a]\n', '<p>r<a id="fnref1" href="#fn1" role="doc-noteref"><sup>1</sup></a></p><section role="doc-endnotes" aria-label="Footnotes"><hr><ol><li id="fn1"><h1 id="H">H</h1><p><a href="#fnref1" role="doc-backlink" aria-label="Back to reference">↩</a></p></li></ol></section>'],
  ['carve#4409 sub-ruling 1: a description at column 0', ':: t\n: +\n# H\n', '<dl><dt>t</dt><dd><h1 id="H">H</h1></dd></dl>'],
  ['carve#4409 sub-ruling 2: a quote takes a quoted follower', '> +\n> x\n', '<blockquote><blockquote><p>x</p></blockquote></blockquote>'],
  ['carve#4409 sub-ruling 3: a marker stays a sibling', '- +\n- b\n', '<ul><li>+</li><li>b</li></ul>'],
  ['carve#4409 sub-ruling 4: the content column is refused', '- +\n  para\n', '<ul><li>+ para</li></ul>'],
  ['carve#4396: a refused plus ends no quote note', '> [^b]: +\npara\n\n[^b]\n', '<blockquote></blockquote><p><a id="fnref1" href="#fn1" role="doc-noteref"><sup>1</sup></a></p><section role="doc-endnotes" aria-label="Footnotes"><hr><ol><li id="fn1"><p>+ para<a href="#fnref1" role="doc-backlink" aria-label="Back to reference">↩</a></p></li></ol></section>'],
  ['carve#4408: a paragraph at a filled description', ':: t\n: +\nl\n : b\n', '<dl><dt>t</dt><dd>l</dd><dd>b</dd></dl>'],
  ['carve#4408: a heading at a filled description', ':: t\n: +\n# H\n : b\n', '<dl><dt>t</dt><dd><h1 id="H">H</h1></dd><dd>b</dd></dl>'],
  ['carve#4408: a refused plus past its term', ':: t\n : +\nl\n : b\n', '<dl><dt>t</dt><dd>+ l</dd><dd>b</dd></dl>'],
]

describe('one attach rule for every + host', () => {
  it.each(expected)('%s', (_name, source, html) => {
    expect(flat(carveToHtml(source))).toBe(html)
  })

  // Rows where the ruling is more specific than the S1 prototype's pre-pass; see the PR body.
  const rulingOverPrototype = new Set<string>()

  const rows = JSON.parse(readFileSync(new URL('./fixtures/plus-one-attach-rule-appendix-a.json', import.meta.url), 'utf8')) as
    { row: string; source: string; html: string }[]
  it.each(rows.filter((r) => !rulingOverPrototype.has(r.row)).map((r) => [r.row, r] as const))('Appendix A row %s', (_name, row) => {
    expect(flat(carveToHtml(row.source))).toBe(flat(row.html))
  })

  it('a refused + is a letter: replacing it changes only that character (carve#4396)', () => {
    const failures: string[] = []
    for (const c of generate(3000) as { source: string; plusLine: number }[]) {
      const html = carveToHtml(c.source)
      const letter = carveToHtml(withLetter(c.source, c.plusLine))
      if (violation(c, html, letter) === 'structure') failures.push(c.source)
    }
    expect(failures).toEqual([])
  })

  it('the stand-in never reaches the output, also beside an authored private-use character', () => {
    expect(flat(carveToHtml('- +\n'))).toBe('<ul><li>+</li></ul>')
    expect(flat(carveToHtml('\n\n- +\n'))).toBe('<p></p><ul><li>+</li></ul>')
  })

  it('reports a refused marker once, from the walk', () => {
    const warnings = lintCarve('- a\n+\n\nx\n').filter((w) => w.rule === 'continuation-marker-refused')
    expect(warnings.map((w) => [w.line, w.column])).toEqual([[2, 1]])
  })
})
