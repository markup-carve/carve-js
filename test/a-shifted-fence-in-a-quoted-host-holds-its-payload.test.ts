import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

/*
 * A code or raw fence opened PAST a quoted list item's or footnote's content
 * column is still that host's fence. Section 24 C3 asks a processor to NAME such
 * an opener, not to refuse it, so the host holds its payload exactly as it holds
 * a canonical one - and a flush-left line then reaches no open paragraph and is
 * the document's (markup-carve/carve-js#2350).
 *
 * The quote tracker read the over-indented opener as pending prose instead, so it
 * believed the quote's paragraph was still open and folded the flush-left line
 * into the fence.
 *
 * Expectations are the executable spec's at markup-carve/carve `89157529`, in a
 * clean worktree reproducing its corpus 2100/2100. The three documents are corpus
 * category 519, which this repo's spec pin predates.
 */

describe('corpus 519: a shifted fence in a quoted item stores no continuation claim', () => {
  it('a flush line after an unclosed shifted fence is the document’s', () => {
    expect(carveToHtml('> - a\n>\n>     ```\n>     x\nflush\n')).toBe(
      '<blockquote>\n  <ul>\n    <li>a\n      <pre><code>x\n</code></pre>\n    </li>\n  </ul>\n</blockquote>\n<p>flush</p>',
    )
  })

  it('a flush line between two payload lines ends the quote there', () => {
    expect(carveToHtml('> - a\n>\n>     ~~~\n>     x\nz\n>     b\n>     ~~~\n')).toBe(
      '<blockquote>\n  <ul>\n    <li>a\n      <pre><code>x\n</code></pre>\n    </li>\n  </ul>\n</blockquote>\n<p>z</p>\n<blockquote><p>b\n~~~</p></blockquote>',
    )
  })

  it('reads a raw fence two quotes deep the same way', () => {
    expect(carveToHtml('> > - a\n> >\n> >     ```=html\n> >     x\nflush\n')).toBe(
      '<blockquote>\n  <blockquote>\n    <ul>\n      <li>a\n        x\n      </li>\n    </ul>\n  </blockquote>\n</blockquote>\n<p>flush</p>',
    )
  })

  // The fourth document of the family, and the control: with no blank line the
  // fence is mid-paragraph with no closer, so it is inline verbatim and the flush
  // line continues that paragraph. This one always agreed, and the fix must not
  // move it.
  it('leaves a mid-paragraph shifted fence as inline verbatim', () => {
    expect(carveToHtml('> - a\n>     ```\n>     x\nflush\n')).toBe(
      '<blockquote>\n  <ul>\n    <li>a\n<code>\nx\nflush</code></li>\n  </ul>\n</blockquote>',
    )
  })
})

describe('an over-indented opener still pairs with a dedented closer', () => {
  // The closer may sit at the opener's column or at the host's content column,
  // and the fence then really closes - so item text resumes and a flush-left line
  // continues it. This is what the pending slot used to be for.
  it('closes on a run at the host content column, and the item paragraph resumes', () => {
    expect(carveToHtml('> - a\n>     ```\n>\n>   ```\n>   a\nflush\n')).toBe(
      '<blockquote>\n  <ul>\n    <li>a\n      <pre><code>\n</code></pre>\n      a\nflush\n    </li>\n  </ul>\n</blockquote>',
    )
  })

  it('closes on a run at its own column', () => {
    expect(carveToHtml('> - a\n>\n>     ```\n>     x\n>     ```\n>\n>   z\nflush\n')).toBe(
      '<blockquote>\n  <ul>\n    <li><p>a</p>\n      <pre><code>x\n</code></pre>\n      <p>z\nflush</p>\n    </li>\n  </ul>\n</blockquote>',
    )
  })

  it('does not close on a run between the two columns', () => {
    expect(carveToHtml('> - a\n>\n>     ```\n>     x\n>    ```\n>\n>   z\nflush\n')).toBe(
      '<blockquote>\n  <ul>\n    <li>a\n      <pre><code>x\n ```\n\nz\n</code></pre>\n    </li>\n  </ul>\n</blockquote>\n<p>flush</p>',
    )
  })
})

describe('every host kind and fence spelling reads the same way', () => {
  it('sends the flush line out of the quote for each of them', () => {
    for (const depth of [1, 2]) {
      for (const [marker, column] of [['- ', 2], ['1. ', 3], ['- [x] ', 2], ['[^f]: ', 2]] as const) {
        for (const fence of ['```', '~~~', '```js', '```=html']) {
          for (const off of [1, 2, 3]) {
            const quote = '> '.repeat(depth)
            const source = `${quote}${marker}a\n${quote.trimEnd()}\n${quote}${' '.repeat(column + off)}${fence}\n` +
              `${quote}${' '.repeat(column + off)}x\nflush\n`
            expect(carveToHtml(source), source).toMatch(/<\/blockquote>\n<p>flush<\/p>$/)
          }
        }
      }
    }
  })
})
