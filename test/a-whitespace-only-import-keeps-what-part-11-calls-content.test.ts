import { describe, expect, it } from 'vitest'
import { carveToHtml, fromAstJson, htmlToAst, htmlToCarve, renderCarve } from '../src/index.js'

/**
 * Two rulings, one line between them: which characters are CONTENT and which
 * are layout (markup-carve/carve#1628 and markup-carve/carve#1621, clauses in
 * markup-carve/carve#1631, this engine's half in markup-carve/carve-js#1400).
 *
 * PART 11 §7 already drew that line for U+00A0 on the way out - a trailing
 * no-break space IS content. These are the inbound face of the same line, and
 * the writer's face of it.
 */
describe('PART 11 §7: what a whitespace-only import keeps', () => {
  /**
   * The divider is the two-character `whitespace` terminal - a space and a tab
   * - and NOTHING else. Verified against the parser rather than assumed: a lone
   * one of these characters is a paragraph when read back, where a lone space
   * or tab line is a blank line.
   */
  const content: Array<[string, string, string]> = [
    ['a no-break space', '&nbsp;', '\u00A0'],
    ['a narrow no-break space', '&#8239;', '\u202F'],
    ['an ideographic space', '&#12288;', '\u3000'],
  ]

  for (const [name, entity, char] of content) {
    it(`keeps ${name}, verbatim`, () => {
      const html = `<p>${entity}</p>`
      expect(htmlToCarve(html).value).toBe(`${char}\n`)
      // Verbatim means verbatim: normalizing it to U+0020 was the defect, and
      // U+0020 would then be trimmed away as layout.
      expect(htmlToAst(html).value.children).toEqual([
        { type: 'paragraph', children: [{ type: 'text', value: char }] },
      ])
      expect(htmlToCarve(html).report.diagnostics).toEqual([])
    })

    it(`${name} is a paragraph when the source is read back`, () => {
      // The premise the keep half rests on. If this ever changes, the character
      // moved across the line and the rule above moves with it.
      expect(carveToHtml(`${char}\n`)).toContain('<p>')
    })
  }

  const layout: Array<[string, string]> = [
    ['a space', '<p> </p>'],
    ['a tab', '<p>&#9;</p>'],
  ]

  for (const [name, html] of layout) {
    it(`builds no node for ${name}, and reports the drop`, () => {
      expect(htmlToAst(html).value.children).toEqual([])
      expect(htmlToCarve(html).value).toBe('\n')
      const rows = htmlToCarve(html).report.diagnostics
      expect(rows.map((row) => row.code)).toEqual(['element-dropped'])
      expect(rows[0]?.message).toBe('Dropped whitespace-only <p> holding no content character')
      expect(rows[0]?.path).toBe('/p[1]')
    })
  }

  it('reads the whole shared fixture the way the fixture does', () => {
    // The spec fixture's own input, asserted here because the shared runner
    // cannot see it until this engine's pin advances past the clause.
    const html =
      '<ul><li>a</li></ul><p>&nbsp;</p><ul><li>b</li></ul><p> </p><p>c</p>' +
      '<p>&#9;</p><p>&#8239;</p><p>&#12288;</p>'
    expect(htmlToCarve(html).value).toBe('- a\n\n\u00A0\n\n- b\n\nc\n\n\u202F\n\n\u3000\n')
    expect(htmlToCarve(html).report.diagnostics.map((row) => row.path)).toEqual(['/p[4]', '/p[6]'])
  })

  it('leaves a genuinely empty block alone', () => {
    // §7 weighs the characters a block HOLDS, and this one holds none - there
    // is nothing for the clause to call layout. Named so the boundary of the
    // change is a decision rather than an accident.
    expect(htmlToAst('<p></p>').value.children).toEqual([{ type: 'paragraph', children: [] }])
  })
})

/**
 * PART 11 §10j: an unspellable block does not cancel the adjacency it cannot
 * spell.
 */
describe('PART 11 §10j: a block that spells nothing keeps the list boundary', () => {
  const list = (text: string) => ({
    type: 'list' as const,
    ordered: false,
    tight: true,
    bulletChar: '-',
    items: [
      { type: 'list_item', children: [{ type: 'paragraph', children: [{ type: 'text', value: text }] }] },
    ],
  })
  // Hand-built with no `pos`: this is the payload an editor hands back. No
  // Carve source spells a whitespace-only paragraph - a lone space line is a
  // BLANK line - so the parse-driven corpus cannot reach this tree at all.
  const payload = (between: unknown) => ({
    type: 'document',
    srcByteLength: 0,
    children: [list('a'), ...(between === null ? [] : [between]), list('b')],
  })
  const written = (between: unknown) => renderCarve(fromAstJson(JSON.parse(JSON.stringify(payload(between)))))
  const lists = (between: unknown) => (carveToHtml(written(between)).match(/<ul[\s>]/g) ?? []).length

  it('writes the boundary across a whitespace-only paragraph', () => {
    // The shape the ruling turns on. The paragraph is not empty, so a writer
    // counting characters treated it as a block that separates the two lists -
    // and then wrote nothing of it, so the lists came back as ONE loose list.
    // What was lost is a document boundary, not a blank line.
    expect(lists({ type: 'paragraph', children: [{ type: 'text', value: ' ' }] })).toBe(2)
  })

  it('agrees with itself about the empty paragraph, which it already got right', () => {
    // The self-contradiction that settled the ruling: the two trees differ in
    // nothing this writer can put on the page, and it wrote different pages.
    expect(lists({ type: 'paragraph', children: [] })).toBe(2)
    expect(written({ type: 'paragraph', children: [{ type: 'text', value: ' ' }] })).toBe(
      written({ type: 'paragraph', children: [] }),
    )
  })

  it('leaves a block that DOES reach the page separating them', () => {
    // The control that separates §10j from "always write a boundary between
    // two lists". A thematic break and a no-break-space paragraph both spell
    // something, so they part the lists as they always did - and no boundary
    // is written, because none is needed.
    expect(lists({ type: 'thematic_break' })).toBe(2)
    expect(written({ type: 'thematic_break' })).toContain('---')
    expect(lists({ type: 'paragraph', children: [{ type: 'text', value: '\u00A0' }] })).toBe(2)
    expect(written({ type: 'paragraph', children: [{ type: 'text', value: '\u00A0' }] })).toContain('\u00A0')
  })

  it('still loses the block itself, and bounds the loss to it', () => {
    // §10j does not claim the paragraph survives - it claims the BOUNDARY
    // does. Asserting more here would pin a promise the clause never made, so
    // the claim is exactly that: the page is the one with nothing between the
    // two lists, and the boundary is on it.
    expect(written({ type: 'paragraph', children: [{ type: 'text', value: ' ' }] })).toBe(written(null))
  })

  it('is asked over what a block SPELLS, not over its type', () => {
    // A test written against `paragraph` passes the shape above and misses the
    // rule. The control: with nothing between them at all, the boundary is
    // written - so the mechanism is present and a fix that simply stopped
    // writing boundaries would not look like a pass here.
    expect(lists(null)).toBe(2)
  })
})
