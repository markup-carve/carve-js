import { describe, it, expect } from 'vitest'
import { parse, lintCarve } from '../src/index.js'

/**
 * Inline positions inside a container used to be measured against the
 * container's STRIPPED text, so they pointed at unrelated source: a text node
 * inside a blockquote reported offsets starting at 0, and `carve lint` reported
 * a column short by the prefix the container removed (#444).
 *
 * Wrong positions are worse than missing ones - a consumer uses the number and
 * lands somewhere else with nothing signalling a problem, which is what PART 12
 * §4's rule against invented values is about.
 *
 * These assert by SLICING THE SOURCE with the reported offsets, so a span that
 * is present but wrong fails.
 */
const textNodes = (node: unknown): Array<Record<string, any>> => {
  const out: Array<Record<string, any>> = []
  const walk = (n: any): void => {
    if (!n || typeof n !== 'object') return
    if (n.type === 'text') out.push(n)
    for (const key of ['children', 'items', 'cells', 'rows']) {
      if (Array.isArray(n[key])) n[key].forEach(walk)
    }
  }
  walk(node)
  return out
}

describe('inline positions inside containers', () => {
  const cases: Record<string, string> = {
    blockquote: '# H\n\n> quoted text\n',
    'nested blockquote': '# H\n\n> > deeply quoted\n',
    'list item': '# H\n\n- item one\n- item two\n',
    'nested list': '# H\n\n- outer\n  - inner text\n',
    admonition: '# H\n\n::: note\nbody text\n:::\n',
    'blockquote in a list': '# H\n\n- item\n\n  > quoted inside\n',
  }

  for (const [label, src] of Object.entries(cases)) {
    it(`slices back to the source: ${label}`, () => {
      const nodes = textNodes(parse(src))
      expect(nodes.length).toBeGreaterThan(0)
      for (const node of nodes) {
        expect(node.pos, `${label}: a text node has no pos`).toBeDefined()
        expect(src.slice(node.pos.startOffset, node.pos.endOffset)).toBe(node.value)
      }
    })
  }

  it('reports the document column, not the column within the container', () => {
    // `[^nope]` starts at column 13 of `- item with [^nope] here`; before the
    // fix this said 11, short by the `- ` marker.
    const [warning] = lintCarve('# T\n\n- item with [^nope] here\n')
    expect(warning!.line).toBe(3)
    expect(warning!.column).toBe(13)
  })

  it('reports the document column inside a blockquote too', () => {
    const [warning] = lintCarve('# T\n\n> quoted [^nope] here\n')
    expect(warning!.line).toBe(3)
    expect(warning!.column).toBe(10)
  })

  it('maps continuation lines, not just the first line of a block', () => {
    // The scanner walks the container's stripped text, so after the first
    // newline a single base offset drifts by the prefix each following line
    // carries. Per-line anchors are what make this land.
    for (const src of ['# H\n\n> one\n> two\n', '# H\n\n- a\n  b\n', '# H\n\nalpha\nbeta\n']) {
      for (const node of textNodes(parse(src))) {
        expect(src.slice(node.pos.startOffset, node.pos.endOffset)).toBe(node.value)
      }
    }
  })

  it('handles a varying prefix width down the same container', () => {
    // `>`, `> ` and `>  ` are all valid, so the prefix is per-line rather than
    // one constant for the block.
    const src = '# H\n\n>one\n> two\n>  three\n'
    for (const node of textNodes(parse(src))) {
      expect(src.slice(node.pos.startOffset, node.pos.endOffset)).toBe(node.value)
    }
  })

  it('leaves reconstructed content alone rather than guessing', () => {
    // A line block expands leading whitespace and a table reassembles cells, so
    // neither line is a suffix of its document line and no exact mapping exists.
    // Those keep whatever they had - the point is that nothing here INVENTS a
    // mapping for them. Asserted as "does not throw and still parses", so this
    // test does not pin the wrong values as correct.
    expect(() => parse('::: |\nline one\nline two\n:::\n')).not.toThrow()
    expect(() => parse('| a | b |\n+ cont | more |\n')).not.toThrow()
  })
})

describe('table rows and cells carry exact spans', () => {
  const src = '| aaa | bbb |\n| ccc | ddd |\n'
  const table = () => parse(src).children[0] as { rows: Array<Record<string, any>> }

  it('gives every cell a span that slices back to its own source', () => {
    const codepoints = [...src]
    for (const row of table().rows) {
      for (const cell of row.cells) {
        expect(cell.pos).toBeDefined()
        const slice = codepoints.slice(cell.pos.startOffset, cell.pos.endOffset).join('')
        // The cell's source region, delimiters excluded, padding kept.
        expect(src).toContain(slice)
        expect(slice.trim()).not.toBe('')
      }
    }
  })

  it('places cells at the right columns', () => {
    const [first, second] = table().rows[0]!.cells
    // `| aaa | bbb |` - the pipe is column 1, so the first cell opens at 2.
    expect(first.pos.startColumn).toBe(2)
    expect(second.pos.startColumn).toBe(8)
  })

  it('spans a row from its first cell to its last', () => {
    const row = table().rows[0]!
    const codepoints = [...src]
    expect(codepoints.slice(row.pos.startOffset, row.pos.endOffset).join('')).toBe(' aaa | bbb ')
  })

  it('omits the span when a continuation row merges into a cell', () => {
    // `+ cont` appends to the previous row's cells, so their content comes from
    // two non-adjacent lines and no single span covers it. PART 12 §4 forbids
    // inventing one, so there is none rather than a range spanning the join.
    const merged = parse('| a | b |\n+ cont | more |\n').children[0] as {
      rows: Array<Record<string, any>>
    }
    const row = merged.rows[0]!
    expect(row.cells[0]!.pos).toBeUndefined()
    expect(row.pos).toBeUndefined()
  })

  it('still resolves the merged content itself', () => {
    // Losing the span must not lose the text.
    const merged = parse('| a | b |\n+ cont | more |\n').children[0] as {
      rows: Array<{ cells: Array<{ children: Array<{ value?: string }> }> }>
    }
    expect(merged.rows[0]!.cells[0]!.children.map((c) => c.value ?? '').join('')).toBe('a cont')
  })
})

describe('a figure gives its target a span too', () => {
  it('spans the image itself, not the image plus caption', () => {
    const src = '![alt](img.png)\n^ Caption\n'
    const codepoints = [...src]
    const figure = parse(src).children[0] as Record<string, any>

    expect(figure.type).toBe('figure')
    // The block loop attaches a span to the FIGURE; without this the node it
    // wraps had none at all (PART 12 §4).
    expect(figure.target.pos).toBeDefined()
    expect(codepoints.slice(figure.target.pos.startOffset, figure.target.pos.endOffset).join('')).toBe(
      '![alt](img.png)',
    )
    // And the figure still covers the caption.
    expect(codepoints.slice(figure.pos.startOffset, figure.pos.endOffset).join('')).toContain('^ Caption')
  })

  it('ends the quoted block where the attribution begins', () => {
    const src = '> Stay hungry, stay foolish.\n^ Steve Jobs\n'
    const codepoints = [...src]
    const figure = parse(src).children[0] as Record<string, any>

    expect(figure.target.type).toBe('block_quote')
    expect(codepoints.slice(figure.target.pos.startOffset, figure.target.pos.endOffset).join('')).toBe(
      '> Stay hungry, stay foolish.',
    )
  })

  it('leaves an uncaptioned block exactly as it was', () => {
    // The target only needs its own span when a figure wraps it; a bare block
    // still gets one from the block loop.
    const src = '![alt](img.png)\n'
    const image = parse(src).children[0] as Record<string, any>
    expect(image.type).toBe('image')
    expect(image.pos).toBeDefined()
  })
})

describe('table cells anchor their inline content', () => {
  it('gives inline nodes inside a cell spans that slice back', () => {
    const src = '| a *b* c | d |\n'
    const codepoints = [...src]
    const table = parse(src).children[0] as { rows: Array<Record<string, any>> }
    for (const cell of table.rows[0]!.cells) {
      for (const node of cell.children) {
        if (node.type !== 'text') continue
        expect(node.pos).toBeDefined()
        expect(codepoints.slice(node.pos.startOffset, node.pos.endOffset).join('')).toBe(node.value)
      }
    }
  })

  it('declines to anchor a cell holding an escaped pipe', () => {
    // `\|` is two source characters for one content character, so the cell text
    // is not a verbatim slice and offsets would drift past it. The anchor is
    // kept only when the source at the computed offset MATCHES the content, so
    // this case fails that check rather than being detected syntactically.
    const src = '| a \\| b | c |\n'
    const table = parse(src).children[0] as { rows: Array<Record<string, any>> }
    const [escaped, plain] = table.rows[0]!.cells
    expect(escaped.children.find((c: any) => c.type === 'text')?.pos).toBeUndefined()
    // The neighbouring cell is unaffected.
    expect(plain.children.find((c: any) => c.type === 'text')?.pos).toBeDefined()
  })

  it('emits no inline position inside an unmappable container', () => {
    // A `+` continuation marker means the quote's lines are not a suffix of the
    // document's, so nothing inside it can be located. Absent beats wrong.
    const src = '> quoted\n+\n- item\n> more\n'
    const codepoints = [...src]
    const walk = (n: any, out: any[] = []): any[] => {
      if (!n || typeof n !== 'object') return out
      if (Array.isArray(n)) { n.forEach((c) => walk(c, out)); return out }
      if (n.type === 'text') out.push(n)
      for (const k of Object.keys(n)) if (k !== 'pos') walk(n[k], out)
      return out
    }
    for (const node of walk(parse(src))) {
      // Either no position, or one that is actually correct - never a wrong one.
      if (node.pos?.startOffset !== undefined) {
        expect(codepoints.slice(node.pos.startOffset, node.pos.endOffset).join('')).toBe(node.value)
      }
    }
  })
})
