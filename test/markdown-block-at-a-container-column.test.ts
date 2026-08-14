import { describe, it, expect } from 'vitest'
import { markdownToCarve } from '../src/markdown-migrate.js'
import { carveToHtml } from '../src/index.js'

/**
 * A block held by a list item is measured from, and written back to, that
 * item's content column.
 *
 * markup-carve/carve-js#1045 taught the importer to do this for HTML blocks.
 * Every other block branch still measured and emitted at absolute column 0
 * (carve-js#1048), so a block inside an item was read as something else or
 * written outside the item:
 *
 * - a paragraph sitting AT a nested item's content column matched the
 *   four-column code test, so it became a top-level code fence and the
 *   paragraph was gone;
 * - a quote or a heading at an item's content column looked like Markdown's
 *   1-3 space slack and was dedented out of the item;
 * - genuine indented code inside an item was emitted at column 0 carrying the
 *   item's columns as leading whitespace of the sample;
 * - a rule, a setext heading and a GFM table header were all written at column
 *   0, and for the table the body rows stayed behind, splitting it in two.
 *
 * Every expectation was measured through `commonmark` and `marked`, never
 * through carve-js: #1045 exists because the importer's own output was once
 * taken as evidence that the importer was right. Those readings are quoted in
 * comments; what is asserted is the reading they establish.
 *
 * Indentation is the SUBJECT of this file, so no fixture pastes a run of
 * spaces. `sp()` builds every one of them and `lines()` joins them, so a
 * formatter that rewrote a literal could not leave the test passing while
 * testing nothing.
 */
const sp = (n: number): string => ' '.repeat(n)
const lines = (...rows: string[]): string => rows.join('\n') + '\n'

describe('a block at its container content column', () => {
  describe('the fixtures really carry the columns they claim', () => {
    it('builds indentation as bytes, not as a pasted literal', () => {
      expect(Buffer.from(sp(4)).toString('hex')).toBe('20202020')
      expect(Buffer.from(lines('- a', sp(2) + 'b')).toString('hex')).toBe('2d20610a2020620a')
      // A tab is one byte and four columns; the two are not interchangeable.
      expect(Buffer.from('\t').toString('hex')).toBe('09')
    })
  })

  describe('a paragraph at a nested items content column', () => {
    it('stays a paragraph in the item instead of becoming code', () => {
      // commonmark + marked: <li><p>b</p><p>continuation</p></li>, nested.
      // The nested item's content column is 4, so code would start at 8.
      const md = lines('- a', '  - b', '', sp(4) + 'continuation')
      const carve = markdownToCarve(md)
      expect(carve).toBe(lines('- a', '  - b', '', sp(4) + 'continuation'))
      expect(carveToHtml(carve)).not.toContain('<pre>')
      expect(carveToHtml(carve)).toContain('continuation')
    })

    it('is not only a nested-item problem', () => {
      // `- b` has content column 2, so column 4 is two past it, not four.
      // commonmark: item `b` holds a second paragraph.
      const md = lines('- a', '', '- b', '', sp(4) + 'still a paragraph')
      expect(markdownToCarve(md)).toBe(
        lines('- a', '', '- b', '', sp(4) + 'still a paragraph'),
      )
      expect(carveToHtml(markdownToCarve(md))).not.toContain('<pre>')
    })

    it('counts a tab as four columns, so the item still holds it', () => {
      // A tab is ONE character and FOUR columns. Measured in characters it
      // looked less indented than the item's content column and closed it.
      // commonmark: <li><p>a</p><p>continuation</p></li>.
      const md = lines('- a', '', '\tcontinuation')
      const carve = markdownToCarve(md)
      expect(carve).toBe(lines('- a', '', '\tcontinuation'))
      expect(carveToHtml(carve)).not.toContain('<pre>')
    })

    it('does not swallow a quote or a rule that sits at that column', () => {
      // commonmark: a <blockquote> and an <hr> INSIDE item `b`. Both used to
      // be carried off into the code fence the column-0 test opened.
      const quote = markdownToCarve(lines('- a', '  - b', '', sp(4) + '> quoted'))
      expect(quote).toBe(lines('- a', '  - b', '', sp(4) + '> quoted'))
      expect(carveToHtml(quote)).toContain('<blockquote>')

      const rule = markdownToCarve(lines('- a', '  - b', '', sp(4) + '***'))
      expect(rule).toBe(lines('- a', '  - b', '', sp(4) + '---'))
      expect(carveToHtml(rule)).toContain('<hr>')
    })
  })

  describe('a quote or a heading at an items content column', () => {
    it('keeps the block quote inside the item', () => {
      // commonmark + marked: <li><p>item</p><blockquote>…</blockquote></li>.
      const carve = markdownToCarve(lines('- item', '', sp(2) + '> quoted'))
      expect(carve).toBe(lines('- item', '', sp(2) + '> quoted'))
      expect(carveToHtml(carve)).toMatch(/<li>[\s\S]*<blockquote>/)
    })

    it('keeps it inside an ordered item, whose column is 3', () => {
      const carve = markdownToCarve(lines('1. item', '', sp(3) + '> quoted'))
      expect(carve).toBe(lines('1. item', '', sp(3) + '> quoted'))
      expect(carveToHtml(carve)).toMatch(/<li>[\s\S]*<blockquote>/)
    })

    it('keeps the heading inside the item', () => {
      // commonmark + marked: <li><p>item</p><h1>Head</h1></li>.
      const carve = markdownToCarve(lines('- item', '', sp(2) + '# Head'))
      expect(carve).toBe(lines('- item', '', sp(2) + '# Head'))
      expect(carveToHtml(carve)).toMatch(/<li>[\s\S]*<h1[^>]*>Head<\/h1>/)
    })
  })

  describe('genuine indented code inside an item', () => {
    it('is fenced at the items column with no residual indent', () => {
      // Column 6 is exactly four past the item's content column 2, so
      // commonmark puts a code block holding `code();` inside the item. The
      // fence used to land at column 0 carrying two of the item's columns.
      const carve = markdownToCarve(lines('- item', '', sp(6) + 'code();'))
      expect(carve).toBe(lines('- item', '', sp(2) + '```', sp(2) + 'code();', sp(2) + '```'))
      expect(carveToHtml(carve)).toContain('<code>code();')
      expect(carveToHtml(carve)).not.toContain('<code>  code();')
    })

    it('does the same at a nested items column', () => {
      const carve = markdownToCarve(lines('- a', '  - b', '', sp(8) + 'code here'))
      expect(carve).toBe(
        lines('- a', '  - b', '', sp(4) + '```', sp(4) + 'code here', sp(4) + '```'),
      )
      expect(carveToHtml(carve)).toContain('<code>code here')
    })
  })

  describe('the remaining block branches', () => {
    it('writes a thematic break at the items column', () => {
      const carve = markdownToCarve(lines('- item', '', sp(2) + '***'))
      expect(carve).toBe(lines('- item', '', sp(2) + '---'))
      expect(carveToHtml(carve)).toMatch(/<li>[\s\S]*<hr>/)
    })

    it('writes a converted setext heading at the items column', () => {
      const carve = markdownToCarve(lines('- item', '', sp(2) + 'Title', sp(2) + '====='))
      expect(carve).toBe(lines('- item', '', sp(2) + '# Title'))
      expect(carveToHtml(carve)).toMatch(/<li>[\s\S]*<h1[^>]*>Title<\/h1>/)
    })

    it('keeps a GFM table whole by writing its header at the items column', () => {
      // marked (commonmark has no tables): a full table inside the item. The
      // header used to be written at column 0 while the body row stayed at
      // column 2, which split one table into a table and a paragraph.
      const carve = markdownToCarve(
        lines('- item', '', sp(2) + '| a | b |', sp(2) + '| --- | --- |', sp(2) + '| 1 | 2 |'),
      )
      expect(carve).toBe(lines('- item', '', sp(2) + '|= a |= b |', sp(2) + '| 1 | 2 |'))
      const html = carveToHtml(carve)
      expect(html).toMatch(/<li>[\s\S]*<table>/)
      expect(html).toContain('<td>1</td>')
      expect(html).not.toContain('<p>| 1 | 2 |</p>')
    })
  })

  describe('controls - the document level is unchanged', () => {
    it('still fences top-level indented code at column 0', () => {
      expect(markdownToCarve(lines('para', '', sp(4) + 'code'))).toBe(
        lines('para', '', '```', 'code', '```'),
      )
    })

    it('still dedents a top-level quote and heading out of their 1-3 space slack', () => {
      expect(markdownToCarve(lines('para', '', sp(2) + '> quoted'))).toBe(
        lines('para', '', '> quoted'),
      )
      expect(markdownToCarve(lines('para', '', sp(2) + '## Head'))).toBe(
        lines('para', '', '## Head'),
      )
    })

    it('leaves a continuation below the code threshold alone', () => {
      expect(markdownToCarve(lines('- a', '', sp(2) + 'continuation'))).toBe(
        lines('- a', '', sp(2) + 'continuation'),
      )
    })

    it('leaves lazy continuation, which has no blank line before it, alone', () => {
      expect(markdownToCarve(lines('- a', sp(4) + 'lazy'))).toBe(lines('- a', sp(4) + 'lazy'))
    })

    it('still reads column-4 code after the list has closed', () => {
      // A column-0 paragraph closes the item, so the column stack is empty
      // again and four columns mean code.
      expect(markdownToCarve(lines('- a', '', 'text', '', sp(4) + 'code'))).toBe(
        lines('- a', '', 'text', '', '```', 'code', '```'),
      )
    })

    it('still normalizes a spaced thematic break that could read as a bullet', () => {
      // `* * *` is a rule, not a bullet holding `* *` (CommonMark). Counted as
      // a list marker it opened a content column of 2 and padded the rule out
      // to it.
      for (const rule of ['* * *', '- - -', '_ _ _', '***', '___']) {
        expect(markdownToCarve(rule)).toBe('---')
      }
    })

    it('keeps a fenced code block inside an item exactly where it was', () => {
      const md = lines('- item', '', sp(2) + '```js', sp(2) + 'x = 1', sp(2) + '```')
      expect(markdownToCarve(md)).toBe(md)
    })
  })
})
