import { describe, it, expect } from 'vitest'
import { markdownToCarve } from '../src/markdown-migrate.js'
import { carveToCarve, carveToHtml } from '../src/index.js'

/**
 * Markdown's one to three columns of slack inside a quote are the QUOTE's, not
 * the block's. Carve reads a block opener only AT its container's content
 * column, so a run carried across with its slack stopped being an opener and
 * fell back into the paragraph above (carve-js#2030, carve-js#2031).
 *
 * Every expectation is cmark-gfm 0.29.0.gfm.13, the reader the importers answer
 * to (carve#2187), quoted at the case. carve-php is right on the thematic run
 * and carries the same defect on the heading and the deeper quote marker, so it
 * is not the reference here.
 *
 * Pinned at the RENDERED level: a rule that was not a rule, a heading that was
 * not a heading. `carve fmt` is asserted alongside, because the fixed point is
 * what pins the empty quote line the render cannot see.
 */
const sp = (n: number): string => ' '.repeat(n)
const lines = (...rows: string[]): string => rows.join('\n') + '\n'

describe('the slack inside a quote', () => {
  describe('the fixtures carry the columns they claim', () => {
    it('builds indentation as bytes', () => {
      expect(Buffer.from(sp(3)).toString('hex')).toBe('202020')
      expect(Buffer.from('> ' + sp(3) + '***').toString('hex')).toBe('3e20' + '202020' + '2a2a2a')
    })
  })

  describe('a thematic run three columns in', () => {
    it('is a rule, not the paragraphs text', () => {
      // cmark-gfm: <blockquote><p>a</p><hr /><hr /></blockquote>.
      const carve = markdownToCarve(lines('> a', '>' + sp(4) + '***', '> ---'))
      const html = carveToHtml(carve)
      expect(html).toMatch(/<p>a<\/p>/)
      expect(html.match(/<hr>/g)).toHaveLength(2)
      expect(html).not.toContain('***')
    })

    it('takes the underscore spelling too, and stops swallowing the line below', () => {
      // cmark-gfm: <blockquote><blockquote><p>a</p><hr /><p>===</p>
      //   </blockquote></blockquote> - the `===` underlines nothing.
      const carve = markdownToCarve(lines('> > a', '> >' + sp(4) + '___', '> > ==='))
      const html = carveToHtml(carve)
      expect(html).toContain('<hr>')
      expect(html).toContain('===')
    })

    it('reaches a four-deep quote', () => {
      const carve = markdownToCarve(lines('> > > > a', '> > > >' + sp(4) + '***'))
      expect(carveToHtml(carve)).toContain('<hr>')
    })
  })

  describe('a heading three columns in', () => {
    it('is a heading, and keeps its text', () => {
      // cmark-gfm: <blockquote><p>a</p><h1>b</h1></blockquote>. carve-rs writes
      // the same shape, an empty quote line included.
      const carve = markdownToCarve(lines('> a', '>' + sp(4) + '# b'))
      expect(carve).toBe(lines('> a', '>', '> # b'))
      expect(carveToHtml(carve)).toMatch(/<h1[^>]*>b<\/h1>/)
    })

    it('is a heading inside a nested quote as well', () => {
      const carve = markdownToCarve(lines('> > a', '> >' + sp(4) + '## b'))
      expect(carveToHtml(carve)).toMatch(/<h2[^>]*>b<\/h2>/)
    })
  })

  describe('a deeper quote marker three columns in', () => {
    it('opens the inner quote instead of reading as text', () => {
      // cmark-gfm: <blockquote><p>a</p><blockquote><p>q</p></blockquote>
      //   </blockquote>.
      const carve = markdownToCarve(lines('> a', '>' + sp(4) + '> q'))
      const html = carveToHtml(carve)
      expect(html).toMatch(/<blockquote>[\s\S]*<blockquote><p>q<\/p><\/blockquote>/)
      expect(html).not.toContain('&gt; q')
    })
  })

  describe('the import is what fmt writes', () => {
    it('sets each of the three apart from the paragraph above it', () => {
      for (const marker of ['***', '# b', '> q']) {
        const carve = markdownToCarve(lines('> a', '>' + sp(4) + marker))
        expect(carveToCarve(carve)).toBe(carve)
      }
    })

    it('and does so at no slack too, where the reading was already right', () => {
      for (const marker of ['***', '# b', '> q']) {
        const carve = markdownToCarve(lines('> a', '> ' + marker))
        expect(carveToCarve(carve)).toBe(carve)
      }
    })
  })

  describe('controls - the slack that stays', () => {
    it('leaves a link reference definition as paragraph text', () => {
      // A definition cannot interrupt a paragraph (CommonMark 4.7), so dedenting
      // one would spell a definition the source does not hold - and Carve renders
      // nothing for a definition, so the line would be gone.
      const carve = markdownToCarve(lines('> a', '>' + sp(4) + '[r]: /u'))
      expect(carveToHtml(carve)).toContain('[r]: /u')
    })

    it('leaves a lone pipe row as paragraph text', () => {
      // A pipe table needs its delimiter row, so nothing opens here.
      expect(carveToHtml(markdownToCarve(lines('> a', '>' + sp(4) + '| b | c |')))).toContain('| b | c |')
    })

    it('leaves plain prose where it stands', () => {
      const carve = markdownToCarve(lines('> a', '>' + sp(4) + 'text'))
      expect(carveToHtml(carve)).toMatch(/<p>a\s+text<\/p>/)
    })

    it('keeps a run four columns in as text, with its escape', () => {
      // Four columns in nothing opens: indented code cannot interrupt a
      // paragraph, so the run is the paragraph's and carries the escape.
      const carve = markdownToCarve(lines('> a', '>' + sp(5) + '***'))
      expect(carve).toContain('\\*\\*\\*')
      const html = carveToHtml(carve)
      expect(html).toContain('***')
      expect(html).not.toContain('<hr>')
    })

    it('still writes a block inside a quoted item at the items column', () => {
      // With an item open the dedent is the ITEM's, not the quote's, and that
      // path is unchanged.
      const carve = markdownToCarve(lines('> - a', '>' + sp(3) + '# h'))
      expect(carveToHtml(carve)).toMatch(/<li>[\s\S]*<h1/)
    })
  })

  describe('intraword emphasis, which Carve spells braced', () => {
    it('keeps the emphasis a bare marker cannot carry', () => {
      // cmark-gfm and GitHub: a<em>b</em>c. carve-rs writes `a{/b/}c`.
      const carve = markdownToCarve('a*b*c\n')
      expect(carve).toBe('a{/b/}c\n')
      expect(carveToHtml(carve)).toBe('<p>a<em>b</em>c</p>')
    })

    it('keeps intraword strong, whose bare spelling also lost a star', () => {
      // Written bare it was no strong AND one star shorter, so a reader saw
      // `a*b*c` where the source said `a**b**c`.
      const carve = markdownToCarve('a**b**c\n')
      expect(carve).toBe('a{*b*}c\n')
      expect(carveToHtml(carve)).toBe('<p>a<strong>b</strong>c</p>')
    })

    it('keeps intraword bold italic, nested the way GFM nests it', () => {
      const carve = markdownToCarve('a***b***c\n')
      expect(carveToHtml(carve)).toBe('<p>a<em><strong>b</strong></em>c</p>')
    })

    it('keeps intraword strikethrough, which also lost a tilde', () => {
      const carve = markdownToCarve('a~~b~~c\n')
      expect(carve).toBe('a{~b~}c\n')
      expect(carveToHtml(carve)).toContain('<s>b</s>')
    })

    it('braces a run flanked on one side only', () => {
      expect(markdownToCarve('a*b* c\n')).toBe('a{/b/} c\n')
      expect(carveToHtml(markdownToCarve('a*b* c\n'))).toContain('<em>b</em>')
    })

    it('reaches one nested inside a strong span', () => {
      const carve = markdownToCarve('x **a*b*c** y\n')
      expect(carveToHtml(carve)).toContain('<strong>a<em>b</em>c</strong>')
    })

    describe('controls - what stays literal', () => {
      it('leaves an underscore run alone, which cannot open intraword', () => {
        // CommonMark: `_` does not open or close intraword, so `a_b_c` is text.
        expect(markdownToCarve('a_b_c\n')).toBe('a_b_c\n')
        expect(carveToHtml(markdownToCarve('a_b_c\n'))).toBe('<p>a_b_c</p>')
      })

      it('leaves arithmetic alone', () => {
        expect(markdownToCarve('2 * 3 * 4\n')).toBe('2 * 3 * 4\n')
      })

      it('keeps the bare spelling where nothing flanks the run', () => {
        expect(markdownToCarve('*em* and **strong** and ~~s~~\n')).toBe('/em/ and *strong* and ~s~\n')
      })
    })
  })
})
