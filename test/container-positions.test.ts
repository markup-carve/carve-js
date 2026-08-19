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

  it('spans a row including its opening and closing pipes', () => {
    const row = table().rows[0]!
    const codepoints = [...src]
    expect(codepoints.slice(row.pos.startOffset, row.pos.endOffset).join('')).toBe('| aaa | bbb |')
  })

  it('omits a merged CELL span but keeps the row', () => {
    // `+ cont` appends to the previous row's cells, so a merged cell's content
    // sits in two column ranges on non-adjacent lines. One range covering both
    // would swallow the neighbouring column on the line between - cell 1 would
    // CONTAIN cell 0 - so the cell has none, per PART 12 §4.
    //
    // The ROW is a different shape: it occupies a contiguous run of lines that
    // no sibling row overlaps, so a span exists and withholding it lost a
    // position for no reason (carve-js#462).
    const merged = parse('| a | b |\n+ cont | more |\n').children[0] as {
      rows: Array<Record<string, any>>
    }
    const row = merged.rows[0]!
    expect(row.cells[0]!.pos).toBeUndefined()
    expect(row.pos).toBeDefined()
    expect(row.pos.startLine).toBe(1)
    expect(row.pos.endLine).toBe(2)
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

  it('ends the quoted block where the caption begins', () => {
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

  it('anchors a cell holding an escaped pipe', () => {
    // The row splitter used to resolve `\|` itself, which made the cell text one
    // character shorter than its source - not a verbatim slice, so no anchor -
    // AND made a cell the one place in the engine where an escape does not
    // become an `escaped_text` node. It now keeps the escape, so the segment is
    // verbatim and the inline scanner produces the node (#462).
    const src = '| a \\| b | c |\n'
    const codepoints = [...src]
    const table = parse(src).children[0] as { rows: Array<Record<string, any>> }
    const [escaped, plain] = table.rows[0]!.cells

    const types = escaped.children.map((c: any) => c.type)
    expect(types).toEqual(['text', 'escaped_text', 'text'])

    for (const child of escaped.children) {
      expect(child.pos).toBeDefined()
    }
    // The escape's own span covers BOTH source characters, not just the pipe.
    const esc = escaped.children[1]!
    expect(codepoints.slice(esc.pos.startOffset, esc.pos.endOffset).join('')).toBe('\\|')
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

describe('multi-line terms and admonition titles', () => {
  it('anchors a wrapped definition term to its continuation line', () => {
    // The continuation folds in whole, indent included, and the scanner strips
    // that indent - so a single base offset drifts by it (#441).
    const src = '- one\n  :: term\n wrapped\n'
    const codepoints = [...src]
    const found: any[] = []
    const walk = (n: any): void => {
      if (!n || typeof n !== 'object') return
      if (Array.isArray(n)) return n.forEach(walk)
      if (n.type === 'text') found.push(n)
      for (const k of Object.keys(n)) if (k !== 'pos') walk(n[k])
    }
    walk(parse(src))

    expect(found.map((n) => n.value)).toContain('wrapped')
    for (const node of found) {
      expect(node.pos).toBeDefined()
      expect(codepoints.slice(node.pos.startOffset, node.pos.endOffset).join('')).toBe(node.value)
    }
  })

  it('anchors an admonition title inside its quotes', () => {
    // Unanchored, the scanner measured from offset 0 and reported the span of
    // `::: tip` for the text "Pro Tip".
    const src = '::: tip "Pro Tip"\nbody\n:::\n'
    const codepoints = [...src]
    const admonition = parse(src).children[0] as { title?: Array<Record<string, any>> }

    expect(admonition.title).toBeDefined()
    for (const node of admonition.title!) {
      expect(node.pos).toBeDefined()
      expect(codepoints.slice(node.pos.startOffset, node.pos.endOffset).join('')).toBe(node.value)
    }
  })
})

describe('line blocks', () => {
  const textNodesOf = (root: unknown): Array<Record<string, any>> => {
    const out: Array<Record<string, any>> = []
    const walk = (n: any): void => {
      if (!n || typeof n !== 'object') return
      if (Array.isArray(n)) return n.forEach(walk)
      if (n.type === 'text' || n.type === 'hard_break') out.push(n)
      for (const k of Object.keys(n)) if (k !== 'pos') walk(n[k])
    }
    walk(root)
    return out
  }

  it('anchors a stanza whose lines are verbatim', () => {
    const src = '::: |\n*Bold* and /italic/,\nplain line.\n:::\n'
    const codepoints = [...src]
    const nodes = textNodesOf(parse(src))

    expect(nodes.length).toBeGreaterThan(0)
    for (const node of nodes) {
      expect(node.pos).toBeDefined()
      if (node.type === 'text') {
        expect(codepoints.slice(node.pos.startOffset, node.pos.endOffset).join('')).toBe(node.value)
      }
    }
  })

  it('keeps the break span when a soft break becomes a hard break', () => {
    // Same source, different meaning inside a line block - building a fresh
    // node dropped the position.
    const src = '::: |\none\ntwo\n:::\n'
    const breaks = textNodesOf(parse(src)).filter((n) => n.type === 'hard_break')
    expect(breaks).toHaveLength(1)
    expect(breaks[0]!.pos).toBeDefined()
  })

  it('anchors a SPACE-indented stanza, because the rewrite keeps its length', () => {
    // The indent becomes one U+E000 sentinel per space, so the line is not a
    // verbatim slice but every character still sits at its own offset. This
    // used to decline, which left a whole stanza unplaced over one indented
    // line (#462).
    const src = '::: |\nRoses are red,\n  Violets are blue.\n:::\n'
    const codepoints = [...src]

    for (const node of textNodesOf(parse(src))) {
      expect(node.pos).toBeDefined()
      // The span must cover the source the node came from. Comparing to the
      // node's value directly would fail on the indent alone - the value spells
      // it with sentinels - so compare after putting the spaces back.
      if (typeof node.value !== 'string') continue
      const slice = codepoints.slice(node.pos!.startOffset, node.pos!.endOffset).join('')
      expect(slice).toBe(node.value.replaceAll('\ue000', ' '))
    }
  })

  it('declines to anchor the TEXT of a TAB-indented stanza', () => {
    // A tab expands to up to four sentinels, so everything after it shifts and
    // no offset inside a line is trustworthy. Absent beats wrong.
    const src = '::: |\nRoses are red,\n\tViolets are blue.\n:::\n'
    for (const node of textNodesOf(parse(src))) {
      if (node.type === 'text') expect(node.pos).toBeUndefined()
    }
  })

  it('still anchors the BREAKS of a TAB-indented stanza', () => {
    // The break is the newline ENDING a line, which line geometry knows exactly
    // - the tab shifts offsets within a line, not the line's own extent. Losing
    // these to the blanket rule above left them unplaced for no reason (#549).
    const src = '::: |\nRoses are red,\n\tViolets are blue.\n:::\n'
    const breaks = textNodesOf(parse(src)).filter((n) => n.type === 'hard_break')
    expect(breaks).toHaveLength(1)
    for (const node of breaks) {
      expect(node.pos).toBeDefined()
      expect(src.slice(node.pos!.startOffset, node.pos!.endOffset)).toBe('\n')
    }
  })

  it('anchors the PARAGRAPH of a TAB-indented stanza', () => {
    // The stanza's own extent is first-line start to last-line end, which no
    // amount of in-line tab expansion moves. It was being dropped along with
    // the inline offsets by a single over-broad gate (#549).
    const src = '::: |\nRoses are red,\n\tViolets are blue.\n:::\n'
    const para = (parse(src).children[0] as any).children[0]
    expect(para.type).toBe('paragraph')
    expect(para.pos).toBeDefined()
    expect(src.slice(para.pos.startOffset, para.pos.endOffset)).toBe(
      'Roses are red,\n\tViolets are blue.',
    )
  })
})

describe('hard-breaks block', () => {
  it('keeps the break span when converting a soft break', () => {
    // `::: ` + backslash turns every line ending into a hard break. Building a
    // fresh node for it dropped the span the soft break already had - the same
    // slip the line block fixed earlier (#462).
    const src = '::: \\\none\ntwo\n:::\n'
    const codepoints = [...src]
    const breaks: Array<{ pos?: { startOffset: number; endOffset: number } }> = []
    const walk = (n: unknown): void => {
      if (!n || typeof n !== 'object') return
      if (Array.isArray(n)) return n.forEach(walk)
      const rec = n as Record<string, unknown>
      if (rec['type'] === 'hard_break') breaks.push(rec as never)
      for (const k of Object.keys(rec)) if (k !== 'pos') walk(rec[k])
    }
    walk(parse(src))

    expect(breaks).toHaveLength(1)
    expect(breaks[0]!.pos).toBeDefined()
    // The break IS the line ending it came from.
    expect(
      codepoints.slice(breaks[0]!.pos!.startOffset, breaks[0]!.pos!.endOffset).join(''),
    ).toBe('\n')
  })
})

describe('a `+` continuation quote', () => {
  it('anchors the quoted lines around the attached block', () => {
    // The `+` splices a flush-left block into the quote body and inserts blank
    // separators, so the body's lines are no longer a contiguous run of the
    // document's. Walking `start + i` then fell off the source at the first
    // splice and every following line lost its position (#462).
    const src = '> quoted\n+\n- item\n> more\n'
    const codepoints = [...src]
    const placed: string[] = []
    const walk = (n: unknown): void => {
      if (!n || typeof n !== 'object') return
      if (Array.isArray(n)) return n.forEach(walk)
      const rec = n as Record<string, unknown>
      if (rec['type'] === 'text' && rec['pos']) {
        const pos = rec['pos'] as { startOffset: number; endOffset: number }
        placed.push(codepoints.slice(pos.startOffset, pos.endOffset).join(''))
      }
      for (const k of Object.keys(rec)) if (k !== 'pos') walk(rec[k])
    }
    walk(parse(src))

    // Each placed span must slice back to its own text, not merely exist. The
    // list inside the attached block is placed too: the line map carries
    // duplicate numbers where the synthetic separators borrow a real line, so
    // the inversion has to pick the candidate that actually ends with the line
    // rather than the first one it finds (#462).
    expect(placed).toEqual(['quoted', 'item', 'more'])
  })

  it('never reports a span that runs backwards', () => {
    // The synthetic separators used to borrow the `+` marker's line, which sits
    // BEFORE the attached block - so a block spanning first-to-last line
    // reported an end offset earlier than its start.
    const src = '> quoted\n+\n- item\n> more\n'
    const walk = (n: unknown): void => {
      if (!n || typeof n !== 'object') return
      if (Array.isArray(n)) return n.forEach(walk)
      const rec = n as Record<string, unknown>
      const pos = rec['pos'] as { startOffset: number; endOffset: number } | undefined
      if (pos) expect(pos.endOffset).toBeGreaterThanOrEqual(pos.startOffset)
      for (const k of Object.keys(rec)) if (k !== 'pos') walk(rec[k])
    }
    walk(parse(src))
  })
})
