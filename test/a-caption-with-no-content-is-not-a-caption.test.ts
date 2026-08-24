import { describe, it, expect } from 'vitest'
import { htmlToAst, htmlToCarve, parse, renderCarve, renderHtml } from '../src/index.js'
import type { Document, Figure, FigureGroup } from '../src/index.js'

/**
 * markup-carve/carve-js#1423: `^` with nothing after it is not a caption line.
 *
 * A caption run that reaches the page as nothing left a bare caret behind, which
 * the reparse reads as more of the block ABOVE it - so the figure was lost AND
 * the target was damaged. That is an ADDITION, not a loss: the source came back
 * saying something the tree never said, so it is fixed rather than declared with
 * a `structure-unspellable` row (markup-carve/carve#1658 governs the losses).
 *
 * The two halves are one cause. The importer built a `figure` from a `<figure>`
 * that has no caption to build one from (PART 9 §4b: the node IS the captioned
 * wrapper), and the writer emitted the line whether or not it spelled anything.
 */
describe('a caption with no content is not a caption', () => {
  const types = (doc: Document) => doc.children.map((child) => child.type)

  describe('the writer drops a caption line that would spell nothing', () => {
    // Each row is a captionable host (PART 9 §4). The caption is emptied on the
    // PARSED tree, which is the shape an AST ingest or an importer delivers -
    // no Carve source spells an empty caption, so none can reach this.
    const hosts: Array<[string, string]> = [
      ['image', '![a](x)\n^ c\n'],
      ['block_quote', '> q\n^ c\n'],
      ['code_block', '```\nx\n```\n^ c\n'],
    ]

    for (const [host, source] of hosts) {
      it(`writes the ${host} alone, and the target still re-reads as itself`, () => {
        const parsed = parse(source)
        const figure = parsed.children[0] as Figure
        expect(figure.type).toBe('figure')
        expect(figure.target.type).toBe(host)

        const emptied: Document = { ...parsed, children: [{ ...figure, caption: [] }] }
        const written = renderCarve(emptied)

        expect(written).not.toContain('^')
        expect(types(parse(written))).toEqual([host])
      })
    }

    it('writes the interchange-only table figure alone (PART 12 §17)', () => {
      // A captioned table is a `table` carrying its own caption, so this figure
      // has no Carve source at all - it is built here the only way it is ever
      // reached, through the tree.
      const table = parse('| a |\n').children[0]
      expect(table.type).toBe('table')

      const emptied: Document = {
        type: 'document',
        children: [{ type: 'figure', target: table as never, caption: [] }],
      }
      const written = renderCarve(emptied)

      expect(written).not.toContain('^')
      expect(types(parse(written))).toEqual(['table'])
    })

    it('writes a figure group without a group caption line', () => {
      const parsed = parse(':::: figure\n![a](x)\n::::\n^ c\n')
      const group = parsed.children[0] as FigureGroup
      expect(group.type).toBe('figure_group')

      const emptied: Document = { ...parsed, children: [{ ...group, caption: [] }] }
      const written = renderCarve(emptied)

      expect(written).not.toContain('^')
      expect(types(parse(written))).toEqual(['figure_group'])
    })

    it('keeps the line for a caption that spells a NO-BREAK SPACE', () => {
      // PART 11 §7 puts U+00A0 on the CONTENT side of the layout/content split,
      // so this caption spells something and the line stays. It is the shape
      // that separates "renders to nothing" from "is empty", and a trim written
      // in the host language's whitespace would fail it.
      const parsed = parse('![a](x)\n^ c\n')
      const figure = parsed.children[0] as Figure
      const nbsp: Document = {
        ...parsed,
        children: [{ ...figure, caption: [{ type: 'text', value: ' ' }] }],
      }
      const written = renderCarve(nbsp)

      expect(written).toBe('![a](x)\n^  \n')
      expect(types(parse(written))).toEqual(['figure'])
    })

    it('keeps the line for a caption that spells text', () => {
      expect(renderCarve(parse('![a](x)\n^ c\n'))).toBe('![a](x)\n^ c\n')
    })
  })

  describe('the importer does not build a figure it has no caption for', () => {
    // Every captionable target, and both spellings of "no caption": the element
    // absent, and the element present but empty.
    const inputs: Array<[string, string, string]> = [
      ['no figcaption, image', '<figure><img src="g.jpg" alt="G"></figure>', 'image'],
      ['empty figcaption, image', '<figure><img src="g.jpg" alt="G"><figcaption></figcaption></figure>', 'image'],
      ['whitespace figcaption, image', '<figure><img src="g.jpg" alt="G"><figcaption>   </figcaption></figure>', 'image'],
      ['no figcaption, quote', '<figure><blockquote><p>q</p></blockquote></figure>', 'block_quote'],
      ['no figcaption, code', '<figure><pre><code>x</code></pre></figure>', 'code_block'],
      ['no figcaption, table', '<figure><table><tr><td>x</td></tr></table></figure>', 'table'],
      ['no figcaption, paragraph', '<figure><p>plain</p></figure>', 'paragraph'],
    ]

    for (const [label, html, expected] of inputs) {
      it(`${label}: both exits say ${expected}`, () => {
        const tree = htmlToAst(html).value
        const { value, report } = htmlToCarve(html)

        expect(types(tree)).toEqual([expected])
        // `parse(htmlToCarve(h)) == htmlToAst(h)` (docs/html-import.md), and no
        // carve-out applies here - nothing was unspellable.
        expect(types(parse(value))).toEqual(types(tree))
        expect(renderHtml(parse(value))).toBe(renderHtml(tree))
        expect(value).not.toContain('^')
        expect(report.diagnostics.map((d) => d.code)).toEqual(['element-unwrapped'])
      })
    }

    it('keeps the figure for a caption holding only a NO-BREAK SPACE', () => {
      // The importer's "nothing" has to be Carve's, not the host language's:
      // `trim()` counts U+00A0 as whitespace and PART 11 §7 does not, so asking
      // the wrong one here unwrapped a figure the writer would have written a
      // caption line for - the two halves disagreeing about one word.
      const html = '<figure><img src="g.jpg" alt="G"><figcaption>&nbsp;</figcaption></figure>'
      const { value, report } = htmlToCarve(html)

      expect(types(htmlToAst(html).value)).toEqual(['figure'])
      expect(value).toBe('![G](g.jpg)\n^ \u00a0\n')
      expect(types(parse(value))).toEqual(['figure'])
      expect(report.diagnostics).toEqual([])
    })

    it('keeps the figure when the caption says something', () => {
      const html = '<figure><img src="g.jpg" alt="G"><figcaption>cap</figcaption></figure>'
      const { value, report } = htmlToCarve(html)

      expect(value).toBe('![G](g.jpg)\n^ cap\n')
      expect(types(htmlToAst(html).value)).toEqual(['figure'])
      expect(report.diagnostics).toEqual([])
    })

    it('reports the attributes an unwrapped figure could not carry', () => {
      const { report } = htmlToCarve('<figure id="f"><img src="g.jpg" alt="G"></figure>')

      expect(report.diagnostics.map((d) => d.code)).toEqual(['element-unwrapped', 'attribute-dropped'])
    })

    it('leaves an authored paragraph around the image alone, with its own declared row', () => {
      // The unwrap returns the body as it imported, NOT the caption host: with
      // no figure there is no image-target slot to take the wrapper off for, so
      // the paragraph stays and takes carve-js#1422's row instead.
      const html = '<figure><p><img src="g.jpg" alt="G"></p></figure>'
      const { report } = htmlToCarve(html)

      expect(types(htmlToAst(html).value)).toEqual(['paragraph'])
      expect(report.diagnostics.map((d) => d.code)).toEqual(['element-unwrapped', 'structure-unspellable'])
    })
  })
})
