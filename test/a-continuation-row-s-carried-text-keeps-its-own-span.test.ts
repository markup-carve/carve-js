import { describe, it, expect } from 'vitest'
import { parse } from '../src/index.js'
import { expectBuiltInputScansLinearly, perfIt } from './helpers/scaling.js'

/**
 * A `+` continuation row joins its fragment onto the cell's source with a SPACE
 * that stands in for the row boundary, so the cell's assembled text is not a
 * slice of the document and one base offset drifts from the join onward.
 *
 * The old answer was to drop the anchor for the whole cell, which cost every
 * inline in it a position - including the ones that sit ENTIRELY inside one
 * fragment and are verbatim slices of their own line. PART 12 §4 exempts nodes
 * that cannot be placed, not nodes that have not been placed: a run of source a
 * node owns end to end is a span that exists (markup-carve/carve-js#1153).
 *
 * Every assertion below reads the span as THE SLICE IT SELECTS. A rendered-HTML
 * assertion cannot fail on a position defect, which is how this class hides:
 * the three corpus documents that carried it render byte-identically either way.
 */
const slice = (source: string, pos: { startOffset: number; endOffset: number }): string =>
  [...source].slice(pos.startOffset, pos.endOffset).join('')

const cell = (source: string, row = 0, index = 0): any =>
  (parse(source).children[0] as any).rows[row].cells[index]

describe("a continuation row's carried text", () => {
  it('places the text before the join, which is one run of source', () => {
    // corpus 333-a-continuation-row-s-open-run-and-an-escaped-closing-pipe
    const source = '| a `b |\n+ c` |\n'
    const text = cell(source).children[0]

    expect(text.type).toBe('text')
    expect(text.value).toBe('a ')
    expect(text.pos, 'the run "a " sits unbroken on line 1').toBeDefined()
    expect(slice(source, text.pos)).toBe('a ')
    expect(text.pos.startOffset).toBe(2)
    expect(text.pos.endOffset).toBe(4)
    expect(text.pos.startLine).toBe(1)
  })

  it('places the text AFTER the join from the continuation line', () => {
    const source = '| /a/ *b* `c |\n+ d` e |\n'
    const nodes = cell(source).children
    const tail = nodes[nodes.length - 1]

    expect(tail.value).toBe(' e')
    expect(slice(source, tail.pos)).toBe(' e')
    expect(tail.pos.startLine, 'measured from line 2, not from the cell start').toBe(2)
  })

  it('places every inline of the first fragment, not only the first', () => {
    const source = '| /a/ *b* `c |\n+ d` e |\n'
    const [emphasis, gap, strong] = cell(source).children

    expect(slice(source, emphasis.pos)).toBe('/a/')
    expect(slice(source, emphasis.children[0].pos)).toBe('a')
    expect(slice(source, gap.pos)).toBe(' ')
    expect(slice(source, strong.pos)).toBe('*b*')
    expect(slice(source, strong.children[0].pos)).toBe('b')
  })

  it('anchors a cell whose content comes only from the continuation row', () => {
    // The base cell is empty, so nothing is joined and the whole content is a
    // verbatim slice of line 2 - anchored there rather than at the base row.
    const source = '| | b |\n+ c | d |\n'
    const text = cell(source).children[0]

    expect(text.value).toBe('c')
    expect(slice(source, text.pos)).toBe('c')
    expect(text.pos.startLine).toBe(2)
  })

  it('keeps the cell inside a container on DOCUMENT offsets', () => {
    const source = '> | a `b |\n> + c` |\n'
    const table = (parse(source).children[0] as any).children[0]
    const text = table.rows[0].cells[0].children[0]

    expect(slice(source, text.pos)).toBe('a ')
    expect(text.pos.startOffset, 'past the `> ` prefix, not local to the quote').toBe(4)
  })

  it('places nothing for a node that reaches across the row boundary', () => {
    // The verbatim run opens on line 1 and closes on line 2. Its VALUE is
    // assembled, and any span covering it would swallow the `|` / `+` structure
    // between the fragments - so it stays unplaced, as it was.
    const source = '| a `b |\n+ c` |\n'
    const code = cell(source).children[1]

    expect(code.type).toBe('code')
    expect(code.value).toBe('b c')
    expect(code.pos).toBeUndefined()
  })

  it('places nothing for text that spans the join itself', () => {
    // corpus 237-a-continuation-row-carries-no-trailing-text. The joining space
    // is not in the document at all, so no slice selects "a c".
    const source = '| a | b |\n+ c | d |\n'
    const text = cell(source).children[0]

    expect(text.value).toBe('a c')
    expect(text.pos).toBeUndefined()
  })

  it('holds across more than one continuation row', () => {
    const source = '| a `b |\n+ c |\n+ d` |\n'
    const [text, code] = cell(source).children

    expect(slice(source, text.pos)).toBe('a ')
    expect(code.value).toBe('b c d')
    expect(code.pos).toBeUndefined()
  })

  it('leaves an uncontinued cell measured exactly as before', () => {
    const source = '| a `b` | c |\n'
    const [text, code] = cell(source).children

    expect(slice(source, text.pos)).toBe('a ')
    expect(slice(source, code.pos), "a code span's own delimiters are its").toBe('`b`')
    expect(slice(source, cell(source, 0, 1).children[0].pos)).toBe('c')
  })
})

// A cell accumulates one anchored range per continuation row and the inline
// scanner asks which range an offset falls in once per token, so a LINEAR
// lookup is quadratic in a tall cell that also carries inline markup. The
// existing continuation guard cannot catch it: its cells hold one long text
// node, so the token count does not grow with the rows and a linear scan reads
// flat. Both counts have to grow together, which is what this shape does.
describe('parser perf regression: anchored ranges in a tall cell', () => {
  perfIt('a continuation row per inline construct scales near-linearly', () => {
    expectBuiltInputScansLinearly(
      (input) => void parse(input),
      (repeats) => '| /a/ | b |\n' + '+ /c/ | d |\n'.repeat(repeats),
      {
        label: 'continuation rows carrying inline markup',
        // Fixed-width units: every row is the same eleven bytes, so 4x the
        // repeats is 4x the input and the helper's threshold means what it says.
        smallRepeats: 2000,
      },
    )
  })
})
