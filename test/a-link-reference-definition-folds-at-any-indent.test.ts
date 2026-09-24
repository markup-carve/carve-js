import { describe, expect, it } from 'vitest'
import { markdownToCarve } from '../src/markdown-migrate.js'
import { carveToHtml } from '../src/index.js'

/**
 * A link reference definition cannot interrupt a paragraph at ANY indent, so a
 * setext underline below one takes it into the heading the whole paragraph
 * becomes. carve-js folded it only four columns in (carve-js#2016); at zero to
 * three columns the heading was lost and a second one was invented out of the
 * definition line.
 *
 * The four-column case already passed, so it is here as a row of the same table
 * rather than as the evidence: a test covering only four columns could not fail.
 *
 * INDENT IS NOT THE RULE, interruption is, which is what the controls pin. A
 * heading, a thematic break, a fence, a quote, a bullet and an HTML block can
 * all interrupt a paragraph, so none of them folds at column 0 and each opens
 * its own block. A fix that folded everything at any indent would pass the rows
 * above and fail every one of those.
 *
 * Every `CommonMark reads` note is the output of `commonmark` 0.31.2 and every
 * `carve-php` one of carve-php at `4d194aa`. Measuring an importer against the
 * parser it feeds answers the wrong question (carve-js#1045), so the oracles'
 * readings are recorded and the assertions pin the render, per the ticket.
 *
 * Indentation is the subject, so `sp()` builds every run of spaces.
 */
const sp = (n: number): string => ' '.repeat(n)

describe('a link reference definition folds into a setext heading at any indent', () => {
  it('builds each indent as bytes, not as a pasted literal', () => {
    expect(Buffer.from(sp(3)).toString('hex')).toBe('202020')
    expect(Buffer.from(sp(4)).toString('hex')).toBe('20202020')
  })

  // CommonMark reads <h2>foo\n[a]: /u</h2> for each of the dash rows and
  // <h1> for the equals ones; carve-php writes `## foo [a]: /u` and `# foo …`.
  const folds: Array<[string, string, string]> = [
    ['zero columns, dash', `foo\n[a]: /u\n---\n`, '<h2>foo [a]: /u</h2>'],
    ['three columns, dash', `foo\n${sp(3)}[a]: /u\n---\n`, '<h2>foo [a]: /u</h2>'],
    ['four columns, dash', `foo\n${sp(4)}[a]: /u\n---\n`, '<h2>foo [a]: /u</h2>'],
    ['zero columns, equals', `foo\n[a]: /u\n===\n`, '<h1>foo [a]: /u</h1>'],
    ['three columns, equals', `foo\n${sp(3)}[a]: /u\n===\n`, '<h1>foo [a]: /u</h1>'],
    ['four columns, equals', `foo\n${sp(4)}[a]: /u\n===\n`, '<h1>foo [a]: /u</h1>'],
    ['a definition carrying a title', `foo\n[a]: /u "t"\n---\n`, '<h2>foo [a]: /u “t”</h2>'],
    ['two definitions in a row', `foo\n[a]: /u\n[b]: /v\n---\n`, '<h2>foo [a]: /u [b]: /v</h2>'],
  ]

  it.each(folds)('folds %s', (_name, source, html) => {
    expect(carveToHtml(markdownToCarve(source))).toContain(html)
  })

  it('folds inside a list item, at the item column and four past it', () => {
    // CommonMark reads <ol><li><h2>foo\n[a]: /u</h2></li></ol> for both, and
    // carve-php writes `1. ## foo [a]: /u`. A container fold is a second code
    // path, so it needs its own rows: before the fix both rendered
    // `<li>foo\n[a]: /u<hr></li>`, losing the heading and inventing a rule.
    const html = '<ol>\n  <li>\n    <h2 id="foo-a-u">foo [a]: /u</h2>\n  </li>\n</ol>'
    expect(carveToHtml(markdownToCarve(`1. foo\n${sp(6)}[a]: /u\n${sp(3)}---\n`))).toBe(html)
    expect(carveToHtml(markdownToCarve(`1. foo\n${sp(3)}[a]: /u\n${sp(3)}---\n`))).toBe(html)
  })

  it('folds inside a block quote', () => {
    // CommonMark reads <blockquote><h2>foo\n[a]: /u</h2></blockquote>;
    // carve-php writes `> ## foo [a]: /u`.
    expect(carveToHtml(markdownToCarve('> foo\n> [a]: /u\n> ---\n'))).toBe(
      '<blockquote>\n  <h2 id="foo-a-u">foo [a]: /u</h2>\n</blockquote>',
    )
  })

  // THE CONTROLS. Each of these CAN interrupt a paragraph, so at column 0 it
  // opens its own block and no heading forms over the paragraph above. Both
  // oracles agree, and each reading was measured rather than assumed.
  const interrupts: Array<[string, string, string]> = [
    // CommonMark: <p>foo</p><h1>bar</h1><hr />
    ['a heading', 'foo\n# bar\n---\n', '<h1>bar</h1>'],
    // CommonMark: <p>foo</p><hr /><hr />
    ['a thematic break', 'foo\n***\n---\n', '<hr>\n<hr>'],
    // CommonMark: <p>foo</p><pre><code>---\n</code></pre>
    ['a fence', 'foo\n```\n---\n', '<pre><code>---\n</code></pre>'],
    // CommonMark: <p>foo</p><blockquote><p>bar</p></blockquote><hr />
    ['a quote', 'foo\n> bar\n---\n', '<blockquote><p>bar</p></blockquote>'],
    // CommonMark: <p>foo</p><ul><li>bar</li></ul><hr />
    ['a bullet', 'foo\n- bar\n---\n', '<ul>\n  <li>bar</li>\n</ul>'],
    // CommonMark: <p>foo</p><div>---
    ['an HTML block', 'foo\n<div>\n---\n', '<div>'],
  ]

  it.each(interrupts)('does not fold %s, which interrupts the paragraph', (_name, source, html) => {
    const out = carveToHtml(markdownToCarve(source))
    expect(out).toContain('<p>foo</p>')
    expect(out).toContain(html)
    expect(out).not.toContain('<h2>foo')
    expect(out).not.toContain('<h1>foo')
  })

  it('leaves a definition that opens a paragraph as a definition', () => {
    // CommonMark consumes it and reads the `---` as a rule, so no heading forms
    // over a definition with nothing above it. carve-php writes the same two
    // blocks. The control that keeps the relaxation tied to an OPEN paragraph.
    expect(markdownToCarve('[a]: /u\n---\n')).toBe('---\n\n[a]: /u\n')
    expect(markdownToCarve('foo\n\n[a]: /u\n---\n')).toBe('foo\n\n---\n\n[a]: /u\n')
  })

  it('does not resolve a reference to a definition it folded', () => {
    // CommonMark reads <h2>foo\n[a]: /u</h2><p>see [a]</p> - folded into the
    // heading, the definition is text and defines nothing. carve-php agrees.
    const out = carveToHtml(markdownToCarve('foo\n[a]: /u\n---\n\nsee [a]\n'))
    expect(out).toContain('<p>see [a]</p>')
    expect(out).not.toContain('href="/u"')
  })

  it('still folds a bare label, which is no definition at all', () => {
    // `[a]:` with no destination is a paragraph line, and both oracles fold it.
    // It already folded, so this holds the regex's documented narrowness.
    expect(carveToHtml(markdownToCarve('foo\n[a]:\n---\n'))).toContain('<h2>foo [a]:</h2>')
  })
})
