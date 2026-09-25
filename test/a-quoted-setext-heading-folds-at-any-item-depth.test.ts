import { describe, expect, it } from 'vitest'
import { markdownToCarve } from '../src/markdown-migrate.js'
import { carveToHtml } from '../src/index.js'

/**
 * carve-js#2013 folded the setext heading a quoted paragraph makes when a list
 * item holds the quote, at ONE item of depth. Two items deep the source was left
 * alone: the heading vanished and a rule nobody wrote took its place
 * (carve-js#2022).
 *
 * The item collector consumes only the OUTERMOST marker into an entry's prefix,
 * so one item of depth leaves `> foo` on the text and two leave `- > foo` over
 * `  > bar`. `heldInContainer` read the quote off the text directly, found none
 * behind those columns, and answered "no container" for every line - so no
 * paragraph was registered inside the quote and the fold had nothing to fold.
 * Peeling the item lead before reading the quote makes it depth-independent,
 * which is why the depths here run to four rather than stopping at the two the
 * report named.
 *
 * The peel is skipped on a CONTINUED line, where a quote marker four columns in
 * is text of the paragraph above. Peeled there, `>     > bar` under `> foo` read
 * as a quote inside the quote and took its own paragraph back out of the fold -
 * measured as a regression on six cases before the gate went in, which is what
 * the lazy-marker control below stands on.
 *
 * Every `CommonMark reads` claim is `commonmark` 0.31.2 and every carve-php one
 * carve-php at `c85ae8df`, where the depth-independent half already landed
 * (carve-php#2344). What is pinned is the RENDER, because what was wrong is what
 * a reader saw: a heading became a paragraph and a horizontal rule.
 *
 * Indentation is the subject, so `sp()` builds every run of spaces.
 */
const sp = (n: number): string => ' '.repeat(n)

/** `depth` bullets, the innermost holding a quote, over its indented body. */
const nested = (depth: number, held: string, underline: string): string => {
  const open = '- '.repeat(depth)
  const cont = sp(2 * depth)
  return `${open}> foo\n${cont}> ${sp(4)}${held}\n${cont}> ${underline}\n`
}

describe('a quoted setext heading folds at any item depth', () => {
  it('builds the columns as bytes, not as a pasted literal', () => {
    expect(Buffer.from(sp(4)).toString('hex')).toBe('20202020')
    expect(nested(2, '# bar', '---')).toBe('- - > foo\n    >     # bar\n    > ---\n')
  })

  // The ten shapes carve-js#2013 swept, plus the tilde fence and the two
  // remaining thematic spellings. CommonMark reads one heading for every row at
  // every depth; before the fix depth two and past it gave a quoted paragraph
  // plus an `<hr>` under the dash form and a paragraph under the equals form.
  const held: Array<[string, string]> = [
    ['a heading marker', '# bar'],
    ['a bullet marker', '- bar'],
    ['a quote marker', '> bar'],
    ['a plus marker', '+ bar'],
    ['an ordered marker', '1. bar'],
    ['a star bullet', '* bar'],
    ['a backtick fence opener', '```'],
    ['a tilde fence opener', '~~~'],
    ['a star thematic break', '***'],
    ['an underscore thematic break', '___'],
    ['a dash thematic break', '---'],
    ['a pipe row', '| bar'],
    ['a link reference definition', '[r]: /u'],
    ['plain text', 'bar'],
  ]

  // Depth one is the case carve-js#2013 left working: it passes on both sides of
  // reverting this change, so it is what says the change reached the deeper
  // columns instead of rewriting the fold.
  const depths = [1, 2, 3, 4]

  for (const depth of depths) {
    it.each(held)(`folds %s under a dash underline at ${depth} items of depth`, (_name, line) => {
      const html = carveToHtml(markdownToCarve(nested(depth, line, '---')))
      expect(html).toContain('<h2')
      expect(html).not.toContain('<hr')
      expect(html).not.toContain('<p>')
    })

    it.each(held)(`folds %s under an equals underline at ${depth} items of depth`, (_name, line) => {
      const html = carveToHtml(markdownToCarve(nested(depth, line, '===')))
      expect(html).toContain('<h1')
      expect(html).not.toContain('<p>')
    })
  }

  it('writes the heading inside the quote, at the depth the item nests it', () => {
    expect(markdownToCarve(nested(2, '# bar', '---'))).toBe('- - > ## foo # bar\n')
    expect(markdownToCarve(nested(4, '# bar', '---'))).toBe('- - - - > ## foo # bar\n')
  })

  it('folds a quoted paragraph with no indent at all, at depth', () => {
    // The narrowness control from the other direction: this one needed no
    // peeling of a four-column line and still needs the quote to be seen.
    expect(markdownToCarve('- - > foo\n    > ---\n')).toBe('- - > ## foo\n')
  })

  it('folds a line three columns in, which is still continuation text', () => {
    expect(markdownToCarve('- - > foo\n    >    bar\n    > ---\n')).toBe('- - > ## foo bar\n')
  })

  it('leaves a marker at the quote content column opening its own block', () => {
    // Zero columns in, the marker is a marker and the paragraph ends at it, so
    // there is nothing left to underline. Both oracles read a heading of its own.
    const html = carveToHtml(markdownToCarve('- - > foo\n    > # bar\n'))
    expect(html).toContain('<p>foo</p>')
    expect(html).toContain('<h1')
  })

  it('still folds a lazy quote marker four columns into a document-level quote', () => {
    // The control for the `continued` gate: the `>` here is text of the
    // paragraph above, not a quote inside the quote.
    expect(markdownToCarve('> foo\n>     > bar\n> ---\n')).toBe('> ## foo > bar\n')
    expect(markdownToCarve('> > foo\n> >     > bar\n> > ---\n')).toBe('> > ## foo > bar\n')
    expect(markdownToCarve('> - foo\n>       > bar\n>   ---\n')).toBe('> - ## foo > bar\n')
  })
})
