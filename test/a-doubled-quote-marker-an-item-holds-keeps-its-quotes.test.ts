import { describe, it, expect } from 'vitest'
import { markdownToCarve } from '../src/markdown-migrate.js'
import { carveToCarve, carveToHtml } from '../src/index.js'

/**
 * Carve reads a quote only in its spaced form, so `>>` is text there and a
 * doubled Markdown marker has to be respelled `> > ` on its way in. The
 * document-level path peels the markers into a prefix and writes them back
 * spaced; a quote a LIST ITEM holds is written from the item's own branches,
 * which left the two characters as the source spelled them, and both quotes
 * went missing from the imported document (carve-js#2035).
 *
 * Four emit points had to reach the respelling: the item's own line, a later
 * line the item holds at the quote's column, the same line one to three columns
 * past it, and the quote run that writes an item of its own.
 *
 * Every expectation is cmark-gfm 0.29.0.gfm.13, the reader the importers answer
 * to (carve#2187), quoted at the case. carve-php fixed the same defect in
 * markup-carve/carve-php#2351 and agrees on every shape below.
 *
 * Pinned at the RENDERED level as well as the spelling: what was wrong is that
 * a reader saw two literal `>` characters where the source had two quotes.
 */
const sp = (n: number): string => ' '.repeat(n)
const lines = (...rows: string[]): string => rows.join('\n') + '\n'
// The rendering with its layout whitespace collapsed, so a case can name the
// element and the text it holds in one string.
const html = (carve: string, smartTypography: 'glyph' | 'source' = 'glyph'): string =>
  carveToHtml(carve, { smartTypography })
    .replace(/\s+id="[^"]*"/g, '')
    .replace(/>\s+</g, '><')
    .replace(/\s+/g, ' ')
    .trim()

describe('a doubled quote marker a list item holds', () => {
  describe('the fixtures carry the markers they claim', () => {
    it('builds the doubled marker as two bytes with no space between them', () => {
      expect(Buffer.from('- >> a').toString('hex')).toBe('2d20' + '3e3e' + '2061')
      expect(Buffer.from('  ' + sp(3)).toString('hex')).toBe('2020202020')
    })
  })

  describe("the item's own line", () => {
    it('keeps both quotes', () => {
      // cmark-gfm: <ul><li><blockquote><blockquote><p>foo bar</p>
      //   </blockquote></blockquote></li></ul>
      const carve = markdownToCarve(lines('- >> foo', '  >> bar'))
      expect(carve).toBe(lines('- > > foo', '  > > bar'))
      const out = html(carve)
      expect(out).toMatch(/<blockquote>\s*<blockquote>/)
      expect(out).toContain('<p>foo bar</p>')
      expect(out).not.toContain('&gt;&gt;')
    })

    it('keeps three of them', () => {
      // cmark-gfm nests three quotes.
      const carve = markdownToCarve(lines('- >>> a', '  >>> b'))
      expect(carve).toBe(lines('- > > > a', '  > > > b'))
      const out = html(carve)
      expect(out.match(/<blockquote>/g)).toHaveLength(3)
      expect(out).toContain('<p>a b</p>')
    })

    it('is reached past a nested item marker', () => {
      // cmark-gfm: <ul><li><ul><li><blockquote><blockquote><p>a b</p> …
      const carve = markdownToCarve(lines('- - >> a', '    >> b'))
      expect(carve).toBe(lines('- - > > a', '    > > b'))
      const out = html(carve)
      expect(out.match(/<blockquote>/g)).toHaveLength(2)
      expect(out).toContain('<p>a b</p>')
    })

    it('is reached past an ordered marker', () => {
      const carve = markdownToCarve(lines('1. >> a', '   >> b'))
      const out = html(carve)
      expect(out).toContain('<ol')
      expect(out.match(/<blockquote>/g)).toHaveLength(2)
      expect(out).toContain('<p>a b</p>')
    })

    it('holds on the only line of the item', () => {
      const carve = markdownToCarve(lines('- >> a'))
      expect(carve).toBe(lines('- > > a'))
      expect(html(carve)).toContain('<p>a</p>')
      expect(html(carve)).not.toContain('&gt;&gt;')
    })
  })

  describe('a later line the item holds', () => {
    it('makes a thematic break a rule, at the quote column', () => {
      // cmark-gfm: <ul><li><blockquote><blockquote><p>a</p><hr />
      //   </blockquote></blockquote></li></ul>. This is the line the ticket
      // reports as writing through byte for byte.
      const carve = markdownToCarve(lines('- >> a', '  >> ***'))
      expect(carve).toBe(lines('- > > a', '  > > ***'))
      const out = html(carve)
      expect(out).toContain('<p>a</p>')
      expect(out).toContain('<hr>')
      expect(out).not.toContain('***')
    })

    it('reads the same one to three columns further in', () => {
      // The slack is the QUOTE's, so cmark-gfm reads the same document. Before
      // the fix the slack was the discriminator: the path that dropped it also
      // respelled, and the path that stood at the column did neither, so one
      // import held both readings at once.
      for (const pre of [1, 2, 3]) {
        const carve = markdownToCarve(lines('- >> a', '  ' + sp(pre) + '>> ***'))
        const out = html(carve)
        expect(out).toContain('<p>a</p>')
        expect(out).toContain('<hr>')
        expect(out).not.toContain('&gt;&gt;')
      }
    })

    it('reads a heading as a heading', () => {
      const carve = markdownToCarve(lines('- >> a', '  >> # h'))
      const out = html(carve)
      expect(out).toContain('<p>a</p>')
      expect(out).toMatch(/<h1[^>]*>h<\/h1>/)
    })

    it('is reached where the item holds a list of its own', () => {
      // `quoteHoldsItem` turns off the branch that drops the slack, so this is
      // the line that only the column branch can write.
      const carve = markdownToCarve(lines('- >> a - x', '   >> b'))
      const out = html(carve)
      expect(out.match(/<blockquote>/g)).toHaveLength(2)
      expect(out).toContain('b')
      expect(out).not.toContain('&gt;&gt;')
    })

    it('is reached under the item’s own paragraph', () => {
      // cmark-gfm lets a quote interrupt a paragraph, so `>>` here opens two.
      const carve = markdownToCarve(lines('- text', '  >> a', '  >> b'))
      const out = html(carve)
      expect(out).toContain('text')
      expect(out.match(/<blockquote>/g)).toHaveLength(2)
      expect(out).toContain('<p>a b</p>')
    })
  })

  describe('an item a quote holds', () => {
    it('keeps the quotes its own item holds', () => {
      // cmark-gfm: <blockquote><ul><li><blockquote><blockquote><p>a b</p> …
      const carve = markdownToCarve(lines('> - >> a', '>   >> b'))
      expect(carve).toBe(lines('> - > > a', '>   > > b'))
      const out = html(carve)
      expect(out.match(/<blockquote>/g)).toHaveLength(3)
      expect(out).toContain('<p>a b</p>')
      expect(out).not.toContain('&gt;&gt;')
    })

    it('makes the break it holds a rule', () => {
      const carve = markdownToCarve(lines('> - >> a', '>   >> ***'))
      const out = html(carve)
      expect(out).toContain('<p>a</p>')
      expect(out).toContain('<hr>')
      expect(out).not.toContain('***')
    })

    it('opens the quote a line under a checkbox holds, the checkbox line aside', () => {
      // The marker on the checkbox line stays text; the line BELOW it stands at
      // the item's content column, where a quote does open. cmark-gfm reads the
      // two halves that way as well.
      const out = html(markdownToCarve(lines('> - [ ] >> a', '>   >> b')))
      expect(out).toContain('&gt;&gt; a')
      expect(out).toContain('<p>b</p>')
    })
  })

  describe('both typography modes read the import the same', () => {
    it('renders the quotes either way, a bare hyphen run included', () => {
      // The axis is awake here: a bare run reaches smart typography, so a
      // reader could see a dash where three hyphens were typed.
      const carve = markdownToCarve(lines('- >> a -- b', '  >> ***'))
      for (const mode of ['glyph', 'source'] as const) {
        const out = html(carve, mode)
        expect(out.match(/<blockquote>/g)).toHaveLength(2)
        expect(out).toContain('<hr>')
        expect(out).not.toContain('&gt;&gt;')
      }
    })
  })

  describe('what already held still holds', () => {
    // Controls: every one of these passes on BOTH sides of the fix.
    it('leaves a single marker alone, at the column and past it', () => {
      expect(markdownToCarve(lines('- > a', '  > b'))).toBe(lines('- > a', '  > b'))
      const out = html(markdownToCarve(lines('- > a', '  > b')))
      expect(out.match(/<blockquote>/g)).toHaveLength(1)
      expect(out).toContain('<p>a b</p>')
    })

    it('still respells a doubled marker at the document level', () => {
      const carve = markdownToCarve(lines('>> foo', '>> bar'))
      expect(carve).toBe(lines('> > foo', '> > bar'))
      expect(html(carve)).toContain('<p>foo bar</p>')
    })

    it('keeps an empty quote line free of a trailing space', () => {
      // The respelling writes `> ` per marker, so an empty line would have
      // grown one and the import would not be a fixed point of `carve fmt`.
      const carve = markdownToCarve(lines('- item', '  > quote', '  >', '  >' + sp(5) + 'code'))
      expect(carve).toBe(lines('- item', '  > quote', '  >', '  > ```', '  > code', '  > ```'))
      expect(carveToCarve(carve)).toBe(carve)
    })

    it('leaves the marker behind a task checkbox as text', () => {
      // cmark-gfm's tasklist extension only lifts a checkbox off a PARAGRAPH,
      // so the rest of that line is the paragraph's text and opens no quote.
      // Respelling it would spell two quotes the source does not hold.
      const carve = markdownToCarve(lines('- [ ] >> a'))
      expect(carve).toBe(lines('- [ ] \\>> a'))
      expect(html(carve)).toContain('&gt;&gt; a')
    })

    it('leaves the marker behind a checkbox inside a quote as text too', () => {
      // The pair itself is text here as well: the tasklist extension does not
      // reach a quoted list, so the box goes with the marker (carve-js#2047).
      // The `>>` then needs no escape of its own, the whole line being the item
      // paragraph's text.
      const carve = markdownToCarve(lines('> - [ ] >> a', '>   >> b'))
      expect(carve).toContain('- \\[ ] >> a')
      expect(html(carve)).toContain('[ ] &gt;&gt; a')
      expect(html(carve)).not.toContain('<input')
    })

    it('leaves a lazy continuation line four columns in as text', () => {
      // A quote cannot interrupt a paragraph from four columns in, so the
      // marker is the paragraph's text and keeps its escape.
      const carve = markdownToCarve(lines('- a', '      >> b'))
      expect(carve).toContain('\\>')
      expect(html(carve)).toContain('&gt;&gt; b')
    })

    it('keeps a fenced sample verbatim', () => {
      const carve = markdownToCarve(lines('- ```', '  >> not a quote', '  ```'))
      expect(carve).toContain('>> not a quote')
      expect(html(carve)).toContain('&gt;&gt; not a quote')
    })
  })
})
