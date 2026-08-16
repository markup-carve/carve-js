import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'
import { lintCarve } from '../src/lint.js'
import { parse } from '../src/parse.js'
import { renderCarve } from '../src/render-carve.js'

/*
 * A cell's attribute block binds AFTER the kind marker and after the alignment
 * marker, in every cell (spec §5 T10, corpus 319).
 *
 * `header_cell` had no attributes slot at all, so an attributed header cell was
 * unspellable. Giving it one in the position `data_cell` used - glued to the
 * opening `|`, ahead of the `=` - is ambiguous by construction: `|{#x}=R|`
 * reads either as an attributed header cell or as a data cell whose content
 * starts with `=`, and the grammar reads the second. Once `=` has committed the
 * cell to header, everything after it is unambiguous.
 */
const html = (src: string) => carveToHtml(src).replace(/\s+/g, ' ').trim()
const fmt = (src: string) => renderCarve(parse(src))

describe('a cell attribute block binds after the markers', () => {
  it('attaches to a header cell, which had no spelling before', () => {
    expect(html('|={.total} Total |= 99 |\n| a | b |')).toContain(
      '<th scope="col" class="total">Total</th>',
    )
  })

  it('attaches after BOTH markers on a header cell', () => {
    expect(html('|=~{#score} Score |\n| 9 |')).toContain(
      '<th scope="col" id="score" style="text-align: center;">Score</th>',
    )
  })

  it('attaches after a data cell\'s alignment marker', () => {
    expect(html('|= Item |= Cost |\n| Pen |>{.num} 9 |')).toContain(
      '<td class="num" style="text-align: right;">9</td>',
    )
  })

  it('reaches the scope values position cannot derive', () => {
    // §5 T9 documented this spelling as the way to reach `colgroup` and
    // `rowgroup`. It was not expressible under the old productions, where the
    // braces rendered as text.
    expect(html('|={scope="colgroup"} a |')).toContain('<th scope="colgroup">a</th>')
  })

  it('still glues to the opening pipe on a cell with no marker', () => {
    expect(html('| a |{.x} b |')).toContain('<td class="x">b</td>')
  })

  it('keeps a space before the block literal', () => {
    expect(html('| {.x} b |')).toContain('<td>{.x} b</td>')
  })

  it('composes with the row attributes, which did NOT move', () => {
    const out = html('|=<{.h} Name |=>{.c} Score |{.head}\n| Ann |>{.num} 9 |{.win}')
    expect(out).toContain('<tr class="head">')
    expect(out).toContain('<th scope="col" class="h" style="text-align: left;">Name</th>')
    expect(out).toContain('<tr class="win">')
  })
})

describe('the two shapes the retired order owned', () => {
  // These are the measurement behind "this rule adds a position rather than
  // retiring one anybody implemented": both already read this way before the
  // change, in this engine and in the spec's own oracle.
  it('reads a marker after the block as CONTENT, not alignment', () => {
    expect(html('|{#x}< content |')).toBe(
      '<table> <tbody> <tr><td id="x">&lt; content</td></tr> </tbody> </table>',
    )
  })

  it('reads the ambiguous shape as a data cell', () => {
    expect(html('|{#x}=R|')).toBe(
      '<table> <tbody> <tr><td id="x">=R</td></tr> </tbody> </table>',
    )
  })
})

describe('the canonical writer emits the markers first', () => {
  // The round-trip failure this rule exists to close: the writer had no native
  // spelling for an attributed header cell, so it promoted the row with a GFM
  // delimiter row instead - syntax the AST never asked for.
  it('writes an attributed header cell natively', () => {
    expect(fmt('|={.total} Total |= 99 |\n| a | b |')).toBe(
      '|={.total}Total|=99|\n| a | b |\n',
    )
  })

  it('never writes the block ahead of the kind marker', () => {
    for (const src of [
      '|={.total} Total |= 99 |\n| a | b |',
      '|=~{#score} Score |\n| 9 |',
      '|={scope="colgroup"} a |',
    ]) {
      expect(fmt(src)).not.toMatch(/\|\{[^{}]*\}=/)
    }
  })

  it('keeps toHtml(fmt(x)) == toHtml(x) on every shape the rule touches', () => {
    for (const src of [
      '|={.total} Total |= 99 |\n| a | b |',
      '|=~{#score} Score |\n| 9 |',
      '|= Item |= Cost |\n| Pen |>{.num} 9 |',
      '|{#x}< content |',
      '|{#x}=R|',
      '|={scope="colgroup"} a |',
      '|=<{.h} Name |=>{.c} Score |{.head}\n| Ann |>{.num} 9 |{.win}',
    ]) {
      expect(html(fmt(src)), src).toBe(html(src))
      expect(fmt(fmt(src)), src).toBe(fmt(src))
    }
  })

  it('still promotes a span-marker header row with a delimiter row', () => {
    // `header_cell` admits no span marker, so that shape keeps the fallback.
    expect(fmt('| < | b |\n|---|---|\n| x | y |')).toBe('| < | b |\n|---|---|\n| x | y |\n')
  })
})

describe('the lint rule for the retired order', () => {
  const rules = (src: string) =>
    lintCarve(src).filter((w) => w.rule === 'table-cell-attribute-before-marker')

  it('reports a block written before an alignment marker', () => {
    const [warning] = rules('|{#x}< content |')
    expect(warning?.line).toBe(1)
    expect(warning?.column).toBe(2)
    // The message names BOTH spellings, because the author is the one who has to
    // choose: the two render differently and the linter cannot know which was
    // meant.
    expect(warning?.message).toContain('"<{#x}"')
    expect(warning?.message).toContain('literal content')
  })

  it('reports each of the three markers, in every cell of the row', () => {
    expect(rules('|{#x}> a |{#y}~ b |')).toHaveLength(2)
    expect(rules('|{#x}< a |')).toHaveLength(1)
  })

  it('leaves the new order and a deliberate space alone', () => {
    expect(rules('|<{#x} content |')).toEqual([])
    expect(rules('|{#x} < content |')).toEqual([])
    expect(rules('|={.a} h |\n| x |')).toEqual([])
  })

  it('does not fire on prose that is not a table row', () => {
    expect(rules('a |{#x}< b')).toEqual([])
  })

  // Split with the parser's own splitter, not a pipe regex. A pipe behind a
  // backslash or inside a code span does not open a cell, so there is no cell
  // for the block to be misplaced in.
  it('does not read an escaped pipe or a code-span pipe as a cell boundary', () => {
    expect(rules('| a \\|{#x}< b |')).toEqual([])
    expect(rules('| `x |{#x}< y` |')).toEqual([])
  })

  it('points at the block on an indented row, and past a row attribute block', () => {
    expect(rules('  |{#x}< content |')[0]?.column).toBe(4)
    expect(rules('|{#x}< a |{.r}')).toHaveLength(1)
  })

  // A table opens inside a blockquote and inside a list item too, and the
  // column has to survive the prefix that got it there.
  it('finds a row inside a container, and keeps the column pointing at the block', () => {
    expect(html('> |{#x}< a |')).toContain('<blockquote>')
    expect(rules('> |{#x}< a |')[0]?.column).toBe(4)
    expect(rules('- |{#x}< a |')[0]?.column).toBe(4)
    expect(rules('> > |{#x}< a |')[0]?.column).toBe(6)
    expect(rules('> |<{#x} a |')).toEqual([])
  })

  it('does not fire inside a verbatim region', () => {
    expect(rules('```\n|{#x}< content |\n```')).toEqual([])
  })

  // A comment body is discarded text - it reaches no output at all - so there
  // is nothing there for a silent degradation to happen to.
  it('does not fire inside a comment, and still fires below one', () => {
    expect(rules('%%%\n|{#x}< content |\n%%%')).toEqual([])
    expect(rules('%%%\n|{#x}< content |\n%%%\n\n|{#x}< content |')[0]?.line).toBe(5)
  })

  // A leading `|` with no closing one is a paragraph, so there is no cell for
  // the block to be misplaced in.
  it('does not fire on a pipe-leading line that is not a row', () => {
    expect(html('|{#x}< content')).toContain('<p>')
    expect(rules('|{#x}< content')).toEqual([])
  })

  // NOT a rewrite. Turning `|{#x}< content |` into `|<{#x} content |` ADDS
  // `text-align: left` and REMOVES a literal `<` from the content, so a
  // formatter doing it in its default path would break the round-trip invariant
  // on a document that is currently correct.
  // The separator space this used to pin is gone: an attribute block ends the
  // alignment scan by itself, so the sigil stays content without it, and
  // carve-php and carve-rs both write the glued form. What the case is about -
  // the `<` is NOT promoted to a marker - is unchanged.
  it('leaves the source alone through fmt', () => {
    expect(fmt('|{#x}< content |')).toBe('|{#x}< content|\n')
    expect(html(fmt('|{#x}< content |'))).toBe(html('|{#x}< content |'))
  })
})
