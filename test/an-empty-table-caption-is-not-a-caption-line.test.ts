import { describe, expect, it } from 'vitest'

import { carveToAstJson, carveToHtml, fromAstJson, htmlToCarve, parse, renderCarve } from '../src/index.js'
import type { Document, Table } from '../src/index.js'

/**
 * `^` WITH NOTHING AFTER IT IS NOT A CAPTION LINE (markup-carve/carve-js#1423),
 * and a table's own caption slot was the one host that clause never reached
 * (markup-carve/carve-js#1496).
 *
 * `<table><caption></caption><tr><td>a</td></tr></table>` wrote `| a |` and a
 * bare `^`, which re-reads as a paragraph holding a literal caret - so the
 * document came back saying something the tree never said, with an empty
 * report. That is an ADDITION rather than a loss, which is why it is fixed
 * rather than declared.
 *
 * THE PREDICATE IS REUSED RATHER THAN RESTATED. `captionLine` already answered
 * this for every FIGURE host; the table's row now goes through the same
 * `captionRow`, so there is one rule with one implementation. A second
 * mechanism would agree today and drift on the next clause.
 *
 * THE ASSERTIONS ARE ON THE RE-RENDER. A test pinning output bytes would pass a
 * fix that swapped one wrong spelling for another; what the ruling claims is
 * that no caret reaches the rendered document and the table is otherwise
 * untouched.
 */
describe('an empty table caption is not a caption line', () => {
  const table = (source: string): Table => parse(source).children[0] as Table
  const withCaption = (caption: Table['caption']): string =>
    renderCarve({ type: 'document', children: [{ ...table('| a |\n'), caption }] } as Document)

  const emptyCaptions: Array<[string, string]> = [
    ['an empty caption element', '<table><caption></caption><tr><td>a</td></tr></table>'],
    ['a caption holding one space', '<table><caption> </caption><tr><td>a</td></tr></table>'],
    ['a caption holding a tab', '<table><caption>\t</caption><tr><td>a</td></tr></table>'],
  ]

  for (const [what, html] of emptyCaptions) {
    it(`writes no caret for ${what}`, () => {
      const rendered = carveToHtml(htmlToCarve(html).value)
      expect(rendered).not.toContain('^')
      // The table itself is untouched - the risk in this shape of fix is
      // suppressing one case too many.
      expect(rendered).toContain('<td>a</td>')
      expect(rendered).not.toContain('<caption>')
    })
  }

  /*
   * THE OTHER DOOR. A tree carrying `caption: []` reaches the same writer
   * without passing the importer at all, so a fix guarding only the HTML path
   * leaves this one open.
   */
  const runs: Array<[string, Table['caption']]> = [
    ['an empty run', []],
    ['a run of spaces', [{ type: 'text', value: '   ' }]],
    ['a run of tabs and newlines', [{ type: 'text', value: '\t\n' }]],
  ]

  for (const [what, caption] of runs) {
    it(`writes no caret for a table the AST hands in with ${what}`, () => {
      const written = withCaption(caption)
      expect(written).toBe('| a |\n')
      expect(carveToHtml(written)).not.toContain('^')
    })
  }

  it('writes no caret for an empty caption arriving over the wire', () => {
    const wire = carveToAstJson('| a |\n^ Cap\n') as unknown as { children: Array<{ caption?: unknown }> }
    wire.children[0]!.caption = []
    const written = renderCarve(fromAstJson(wire as never))
    expect(written).toBe('| a |\n')
    expect(carveToHtml(written)).not.toContain('^')
  })

  /*
   * THE CONTROLS. A caption that spells something still writes its line and
   * still round-trips, and PART 11 §7's content side is unchanged: a caption
   * holding a NO-BREAK SPACE is content and keeps its line.
   */
  it('still writes the line for a caption that spells something', () => {
    const source = htmlToCarve('<table><caption>Cap</caption><tr><td>a</td></tr></table>').value
    expect(source).toBe('| a |\n^ Cap\n')
    expect(carveToHtml(source)).toContain('<caption>Cap</caption>')
    // Round trip: the written source re-parses to the same table and writes
    // itself back unchanged.
    expect(renderCarve(parse(source))).toBe(source)
  })

  it('still writes the line for a caption holding a no-break space', () => {
    const written = withCaption([{ type: 'text', value: '\u00a0' }])
    expect(written).toContain('^ ')
    expect(carveToHtml(written)).toContain('<caption>')
  })
})
