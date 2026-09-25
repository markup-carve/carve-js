import { describe, expect, it } from 'vitest'
import { markdownToCarve } from '../src/markdown-migrate.js'
import { carveToHtml } from '../src/index.js'

/**
 * A line four columns into the paragraph a block quote holds is continuation
 * text whatever it is shaped like, and the underline under it makes one heading
 * of the paragraph - the same rule carve-js#2007 fixed at the top level.
 *
 * Inside a quote it held for neither underline (carve-js#2008), and the dash
 * form was the severe half: the heading was lost AND a rule nobody wrote
 * appeared, so the imported document said something the source did not.
 *
 * The cause was the `continued` flag. A quote line four columns past its
 * paragraph's column was never marked with it, and `paragraphLine` then read a
 * heading marker or a link reference as a block of its own. Marking it was half
 * the fix: the flag only gated one of that function's two refusals, and the
 * fence check in the fold measured a line whose indent had already been
 * stripped, so a four-column fence line read as a fence opener.
 *
 * Every `CommonMark reads` note is the output of `commonmark` 0.31.2 and every
 * `carve-php` one of carve-php at `4d194aa`. Measuring an importer against the
 * parser it feeds answers the wrong question (carve-js#1045), so the oracles'
 * readings are recorded and the assertions pin the render.
 *
 * Indentation is the subject, so `sp()` builds every run of spaces.
 */
const sp = (n: number): string => ' '.repeat(n)
const quoted = (held: string, underline: string): string => `> foo\n> ${sp(4)}${held}\n> ${underline}\n`

describe('a quoted setext heading folds an indented continuation line', () => {
  it('builds four columns as bytes, not as a pasted literal', () => {
    expect(Buffer.from(sp(4)).toString('hex')).toBe('20202020')
  })

  // Both oracles read one heading for every row. Before the fix the dash form
  // gave a quoted paragraph plus an `<hr>` and the equals form a paragraph.
  const held: Array<[string, string]> = [
    ['a heading marker', '# bar'],
    ['a bullet marker', '- bar'],
    ['a quote marker', '> bar'],
    ['a plus marker', '+ bar'],
    ['an ordered marker', '1. bar'],
    ['a star bullet', '* bar'],
    ['a pipe row', '| bar'],
    ['a fence opener', '```'],
    ['a thematic break', '***'],
  ]

  it.each(held)('folds %s under a dash underline, fabricating no rule', (_name, line) => {
    const out = markdownToCarve(quoted(line, '---'))
    const html = carveToHtml(out)
    expect(html).toContain('<h2')
    expect(html).not.toContain('<hr')
    expect(html).not.toContain('<p>')
  })

  it.each(held)('folds %s under an equals underline', (_name, line) => {
    expect(carveToHtml(markdownToCarve(quoted(line, '==='))).replace(/\n\s*/g, ' ')).toContain('<h1')
  })

  it('writes the heading inside the quote, at the quote depth', () => {
    // CommonMark reads: <blockquote><h2>foo\n# bar</h2></blockquote>.
    // carve-php writes `> ## foo # bar`.
    expect(markdownToCarve(quoted('# bar', '---'))).toBe('> ## foo # bar\n')
    expect(carveToHtml(markdownToCarve(quoted('# bar', '---')))).toBe(
      '<blockquote>\n  <h2 id="foo-bar">foo # bar</h2>\n</blockquote>',
    )
    expect(markdownToCarve(quoted('# bar', '==='))).toBe('> # foo # bar\n')
  })

  it('folds a paragraph of more than two quoted lines', () => {
    // CommonMark reads: <blockquote><h2>a\nfoo\n# bar</h2></blockquote>.
    expect(markdownToCarve(`> a\n> foo\n> ${sp(4)}# bar\n> ---\n`)).toBe('> ## a foo # bar\n')
  })

  it('keeps the escape on the fence run, which is inline-structural', () => {
    // carve-php writes the same bytes. The other markers go bare, per carve#2244.
    expect(markdownToCarve(quoted('```', '---'))).toBe('> ## foo \\`\\`\\`\n')
    expect(markdownToCarve(quoted('| bar', '---'))).toBe('> ## foo | bar\n')
  })

  it('leaves a marker within three columns opening its own block', () => {
    // CommonMark reads: <blockquote><p>foo</p><h1>bar</h1><hr /></blockquote> -
    // three columns in the heading interrupts, so there is nothing to underline
    // and the rule below it is a rule. carve-php reads the same. The control.
    //
    // Those three columns used to be carried through, and Carve reads an opener
    // only AT its container's content column, so what this case calls a heading
    // came out inside the paragraph (carve-js#2030, carve-js#2031). Asking only
    // for the rule left that invisible, which is why the heading is asserted now.
    const out = markdownToCarve(`> foo\n> ${sp(3)}# bar\n> ---\n`)
    expect(out).toBe('> foo\n>\n> # bar\n> ---\n')
    expect(carveToHtml(out)).toMatch(/<h1[^>]*>bar<\/h1>/)
    expect(carveToHtml(out)).toContain('<hr>')
  })

  it('leaves a quoted underline four columns in as paragraph text', () => {
    // CommonMark reads: <blockquote><p>foo\nbar\n===</p></blockquote>. Four
    // columns in the `===` is code rather than an underline. carve-php reads the
    // same. The control on the other side of the fold.
    expect(carveToHtml(markdownToCarve(`> foo\n> ${sp(4)}bar\n> ${sp(4)}===\n`))).toBe(
      '<blockquote><p>foo\nbar\n===</p></blockquote>',
    )
  })

  it('still folds a quoted paragraph with no indent at all', () => {
    // The path that already worked, so the flag did not displace it.
    expect(markdownToCarve('> foo\n> bar\n> ---\n')).toBe('> ## foo bar\n')
  })
})
