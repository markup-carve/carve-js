import { describe, expect, it } from 'vitest'
import { markdownToCarve } from '../src/markdown-migrate.js'
import { carveToHtml } from '../src/index.js'

/**
 * Indented code cannot interrupt a paragraph, so a line four columns in is
 * continuation text whatever it is shaped like, and an underline under it makes
 * one heading of the whole paragraph. That held for a `-` underline and not for
 * an `=` one (carve-js#2007): a `-` run reaches the paragraph-run collector as a
 * thematic break and ends the run, while an `=` run matched no opener at all, so
 * the run swallowed the underline and nothing was left to fold.
 *
 * Every `CommonMark reads` note is the output of `commonmark` 0.31.2, and the
 * `carve-php reads` ones of carve-php at `4d194aa`. Measuring an importer
 * against the parser it feeds answers the wrong question (carve-js#1045), so the
 * two oracles' readings are recorded here and the assertions pin the render.
 *
 * `--corpus=convert` compares an importer by rendering its output rather than by
 * the Carve bytes it wrote, so the rendered HTML is what these assert.
 *
 * Indentation is the subject, so no fixture pastes a run of spaces: `sp()`
 * builds every one of them.
 */
const sp = (n: number): string => ' '.repeat(n)
const md = (held: string, underline: string): string => `foo\n${sp(4)}${held}\n${underline}\n`

describe('an `=` underline folds an indented continuation line', () => {
  it('builds four columns as bytes, not as a pasted literal', () => {
    expect(Buffer.from(sp(4)).toString('hex')).toBe('20202020')
  })

  // CommonMark reads an h1 for each of these, with the two lines joined by the
  // newline it keeps; carve-php reads the same heading, written on one line.
  // Before the fix every one of them came out as a three-line paragraph.
  const folded: Array<[string, string, string]> = [
    ['a heading marker', '# bar', '<h1>foo # bar</h1>'],
    ['a bullet marker', '- bar', '<h1>foo - bar</h1>'],
    ['a quote marker', '> bar', '<h1>foo &gt; bar</h1>'],
    ['a thematic break', '***', '<h1>foo ***</h1>'],
    ['a pipe row', '| bar', '<h1>foo | bar</h1>'],
    ['a fence opener', '```', '<h1>foo ```</h1>'],
    ['ordinary text', 'bar', '<h1>foo bar</h1>'],
  ]

  it.each(folded)('folds %s under an `=` underline', (_name, held, html) => {
    expect(carveToHtml(markdownToCarve(md(held, '===')))).toContain(html)
  })

  it.each(folded)('folds %s under a `-` underline too', (_name, held, html) => {
    expect(carveToHtml(markdownToCarve(md(held, '---')))).toContain(html.replace(/h1/g, 'h2'))
  })

  it('writes the h1 as one ATX line and fabricates no rule', () => {
    // The marker is BARE: carve#2244 ruled the folded opener carries no escape,
    // since a `#` only opens a heading at the start of a line and the fold
    // leaves it mid-line. This expectation read `# foo \\# bar` until then.
    const out = markdownToCarve(md('# bar', '==='))
    expect(out).toBe('# foo # bar\n')
    expect(out).not.toContain('---')
  })

  it('folds a paragraph of more than two lines', () => {
    // CommonMark reads: <h1>foo\n# bar\nbaz</h1>; carve-php reads `# foo # bar baz`.
    expect(carveToHtml(markdownToCarve(`foo\n${sp(4)}# bar\n${sp(4)}baz\n===\n`))).toContain(
      '<h1>foo # bar baz</h1>',
    )
  })

  it('leaves a marker within three columns opening its own block', () => {
    // CommonMark reads: <p>foo</p>\n<h1>bar</h1>\n<p>===</p> - three columns in,
    // the heading interrupts the paragraph, so there is nothing to underline.
    // carve-php reads the same. This is the control the fold must not swallow.
    expect(carveToHtml(markdownToCarve(`foo\n${sp(3)}# bar\n===\n`))).toBe(
      '<p>foo</p>\n<section id="bar">\n  <h1>bar</h1>\n  <p>===</p>\n</section>',
    )
  })

  it('leaves an underline four columns in as paragraph text', () => {
    // CommonMark reads: <p>foo\nbar\n===</p> - four columns in the `===` is code
    // rather than an underline, so no heading forms. carve-php reads the same.
    expect(carveToHtml(markdownToCarve(`foo\n${sp(4)}bar\n${sp(4)}===\n`))).toBe(
      '<p>foo\nbar\n===</p>',
    )
  })
})
