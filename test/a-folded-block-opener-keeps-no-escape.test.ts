import { describe, it, expect } from 'vitest'
import { markdownToCarve } from '../src/markdown-migrate.js'
import { carveToCarve, carveToHtml } from '../src/index.js'

/**
 * A marker folded into a setext heading loses the escape the paragraph reading
 * needed for it.
 *
 * markup-carve/carve#2244 ruled the bare form canonical: an importer does not
 * escape a character that needs no escaping. A marker only opens a block at the
 * start of a line, and the fold puts every line of the run on ONE line, so the
 * escape there protects against nothing - it puts a backslash in front of a
 * construct that is not present, and anyone editing the file afterwards has to
 * know it is decorative.
 *
 * ASSERTED ON THE PRODUCED CARVE BYTES, not through a render. Both spellings
 * render byte-identical HTML, which is the whole reason the escape is
 * droppable, so a test going through the render cannot see this change at all.
 * `rendersTheSame` below states that premise rather than assuming it: if a
 * marker ever becomes load-bearing in that position, the pair stops matching
 * and the bare expectation beside it is no longer the right answer.
 *
 * THE PARAGRAPH PATH IS THE CONTROL, and it is load-bearing for a reason the
 * unformatted file does not show. The same input without the underline stays a
 * two-line paragraph whose second line sits four columns in, where a marker
 * opens nothing - but `carve fmt` dedents that line to column 0 and writes the
 * escape itself, so the bare spelling there does not survive formatting. A fix
 * that dropped the escape everywhere would pass every heading row above and
 * leave a file the canonical writer disagrees with.
 */

const folded = (marker: string): string => markdownToCarve(`foo\n    ${marker} bar\n---\n`).trim()
const paragraph = (marker: string): string => markdownToCarve(`foo\n    ${marker} bar\n`).trim()

/* The six markers carve#2244 measured, plus one the same branch reaches. */
const RULED = ['#', '-', '>', '+', '1.', '*']

describe('a block opener folded into a setext heading', () => {
  for (const marker of RULED) {
    it(`writes \`${marker}\` bare`, () => {
      expect(folded(marker)).toBe(`## foo ${marker} bar`)
    })
  }

  it('writes a pipe bare too, which the same branch escaped', () => {
    /* Not in carve#2244's table of six: that row was a carve-php folding defect
     * rather than a spelling difference, so the two engines were never compared
     * on it. The escape is dead here for the same reason as the six. */
    expect(folded('|')).toBe('## foo | bar')
  })

  it('leaves the other branches of the same helper bare', () => {
    expect(markdownToCarve('foo\n    [ref]: /u\n---\n').trim()).toBe('## foo [ref]: /u')
    expect(markdownToCarve('foo\n    ***\n---\n').trim()).toBe('## foo ***')
    expect(markdownToCarve('foo\n    1) bar\n---\n').trim()).toBe('## foo 1) bar')
    expect(markdownToCarve('foo\n    ###### bar\n---\n').trim()).toBe('## foo ###### bar')
  })

  it('does not touch a fence, which both engines already spelled the same way', () => {
    /* The backticks are escaped by the verbatim-delimiter rule, not by the
     * block-opener helper, so this row is outside the ruling and unchanged. */
    expect(markdownToCarve('foo\n    ```js\n---\n').trim()).toBe('## foo \\`\\`\\`js')
  })
})

describe('the escape the fold drops was load-bearing nowhere', () => {
  const rendersTheSame = (bare: string, escaped: string): void => {
    expect(carveToHtml(`${bare}\n`)).toBe(carveToHtml(`${escaped}\n`))
  }

  for (const marker of [...RULED, '|']) {
    it(`\`${marker}\` renders the same bare and escaped`, () => {
      const escaped = marker === '1.' ? '1\\.' : `\\${marker}`
      rendersTheSame(`## foo ${marker} bar`, `## foo ${escaped} bar`)
    })
  }

  it('a trailing marker is literal too, since Carve has no closing sequence', () => {
    rendersTheSame('## foo bar #', '## foo bar \\#')
    rendersTheSame('# a ##', '# a \\#\\#')
  })
})

describe('the paragraph that does not fold keeps its escape', () => {
  for (const marker of ['#', '-', '>', '1.', '*']) {
    it(`escapes \`${marker}\` at the start of a continuation line`, () => {
      const escaped = marker === '1.' ? '1\\.' : `\\${marker}`
      expect(paragraph(marker)).toBe(`foo\n    ${escaped} bar`)
    })
  }

  it('the canonical writer writes that escape itself, which is why it stays', () => {
    /* `carve fmt` dedents a continuation line to column 0 and escapes the marker
     * there, so the bare spelling would not survive formatting. That is the
     * difference from the fold, which has no column left to be dedented to. */
    expect(carveToCarve('foo\n    # bar\n')).toBe('foo\n\\# bar\n')
    expect(carveToHtml('foo\n\\# bar\n')).not.toBe(carveToHtml('foo\n# bar\n'))
  })
})
