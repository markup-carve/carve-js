// One test per clause of spec/0.2/source-layout.md. The clauses C2-L-030 to C2-L-044 are rules for
// a writer: here they are tested from the side of the record, which is that both spellings give
// one tree and differ in the fact the rule reads. The writer rule itself is tested with the writer.
import { describe, expect, it } from 'vitest'
import { type AstNode } from '../src/ast.ts'
import { treesEqual } from '../src/ast-json.ts'
import { CarveTreeError, validateTree } from '../src/ast-validate.ts'
import {
  CarveLayoutError, type NodeLayout, parse, parseWithDiagnostics, parseWithLayout, type SourceLayout, utf8Length, validateLayout,
} from '../src/index.ts'
import { EXAMPLES } from './support/conformance.ts'

function layoutOf(src: string): SourceLayout {
  return parseWithLayout(src).layout
}

/** The entry of the node at `path`, or undefined. */
function entry(src: string, path: string): NodeLayout | undefined {
  return layoutOf(src).nodes.find((node) => node.path === path)
}

/** The node or value at an RFC 6901 pointer, or undefined. */
function resolvePointer(root: unknown, pointer: string): unknown {
  let value = root
  for (const step of pointer.split('/').slice(1)) {
    if (typeof value !== 'object' || value === null) return undefined
    value = (value as Record<string, unknown>)[step]
  }
  return value
}

/** The reason a reader gives for refusing `record`, with the path, or null when it accepts it. */
function refusal(record: unknown): string | null {
  try {
    validateLayout(record)
    return null
  } catch (error) {
    if (!(error instanceof CarveLayoutError)) throw error
    return `${error.path}: ${error.reason}`
  }
}

/** A valid record with one entry, changed by `change`. */
function recordWith(change: (record: Record<string, unknown>, entry: Record<string, unknown>) => void): unknown {
  const record = JSON.parse(JSON.stringify(layoutOf('. a\n'))) as Record<string, unknown>
  change(record, (record['nodes'] as Record<string, unknown>[])[0]!)
  return record
}

const FIRST = '/children/0'
const CELL = '/children/0/children/0/children/0/children/0'

describe('what the sidecar is', () => {
  it('C2-L-001: the record is returned only on request, and the tree holds none of it', () => {
    expect(Object.keys(parseWithDiagnostics('. a'))).toEqual(['document', 'diagnostics'])
    expect(Object.keys(parseWithLayout('. a'))).toEqual(['document', 'diagnostics', 'layout'])
    const list = parseWithLayout('. a').document.children![0]!
    expect(Object.keys(list).sort()).toEqual(['children', 'marker', 'pos', 'spacing', 'type'])
  })

  it('C2-L-002: two documents that differ only in the record are the same document', () => {
    const bare = parseWithLayout('. a')
    const numbered = parseWithLayout('1. a')
    expect(treesEqual(bare.document, numbered.document)).toBe(true)
    expect(bare.layout.nodes[0]!.bare).toBe(true)
    expect(numbered.layout.nodes[0]!.bare).toBe(false)
  })

  it('C2-L-003: the tree is the same with and without the record, and a tree reader refuses a record', () => {
    const src = '{#i}\n- [x] a *b* [c][d]\n\n| a |\n+ b |\n^ T\n\n> q\n\n[d]: /u\n'
    expect(parseWithLayout(src).document).toEqual(parse(src))
    expect(parseWithLayout(src).diagnostics).toEqual(parseWithDiagnostics(src).diagnostics)
    expect(() => validateTree(layoutOf(src))).toThrow(CarveTreeError)
  })

  it('C2-L-004: every path of a record points into the tree it was returned with', () => {
    const result = parseWithLayout('- a\n- b\n\n> c\n')
    for (const node of result.layout.nodes) expect(resolvePointer(result.document, node.path)).toHaveProperty('type')
    // After an edit of the tree the path of the quote names another node.
    result.document.children!.shift()
    expect((resolvePointer(result.document, '/children/1') as AstNode | undefined)).toBeUndefined()
  })

  it('C2-L-005: a written source is a new input with a record of its own', () => {
    const first = layoutOf('1. a\n')
    const second = layoutOf('. a\n')
    expect(first.source).toBe('1. a\n')
    expect(second.source).toBe('. a\n')
    expect(second.nodes[0]!.bare).not.toBe(first.nodes[0]!.bare)
  })

  it('C2-L-006: a fact that contradicts the tree is not refused by a reader, since the tree wins', () => {
    expect(refusal(recordWith((_record, node) => {
      node['sourceFormat'] = 'csv'
    }))).toBeNull()
  })
})

describe('shape', () => {
  it('C2-L-007: the record has six fields and no others', () => {
    const record = layoutOf('a\n')
    expect(Object.keys(record)).toEqual(['version', 'encoding', 'source', 'lineEndings', 'bom', 'nodes'])
    expect(record).toMatchObject({ version: 2, encoding: 'utf-8', source: 'a\n', lineEndings: 'lf', bom: false })
    expect(layoutOf('a').lineEndings).toBe('none')
    expect(layoutOf('a\r\nb\r\n').lineEndings).toBe('crlf')
    expect(layoutOf('a\rb').lineEndings).toBe('cr')
    expect(layoutOf('a\r\nb\n').lineEndings).toBe('mixed')
    expect(layoutOf('﻿a').bom).toBe(true)
    expect(refusal(recordWith((changed) => {
      delete changed['bom']
    }))).toBe('/bom: is missing')
    expect(refusal(recordWith((changed) => {
      changed['tree'] = {}
    }))).toBe('/tree: is not a field of the record')
    expect(refusal(recordWith((changed) => {
      changed['lineEndings'] = 'nel'
    }))).toBe('/lineEndings: is not one of none, lf, crlf, cr, mixed')
    expect(refusal(recordWith((changed) => {
      changed['encoding'] = 'utf-16'
    }))).toBe('/encoding: is not utf-8')
    expect(refusal([])).toBe(': the record is not an object')
  })

  it('C2-L-008: a reader refuses a version it does not implement', () => {
    expect(refusal(recordWith((changed) => {
      changed['version'] = 1
    }))).toBe('/version: version 1 is not implemented')
    expect(refusal(recordWith((changed) => {
      changed['version'] = 3
    }))).toBe('/version: version 3 is not implemented')
  })

  it('C2-L-009: an entry has path, startByte and endByte, the facts, and no other field', () => {
    expect(refusal(recordWith((_record, node) => {
      node['column'] = 1
    }))).toBe('/nodes/0/column: is not a field of a node entry')
    expect(refusal(recordWith((_record, node) => {
      delete node['startByte']
    }))).toBe('/nodes/0/startByte: is not an integer of at least 0')
    expect(refusal(recordWith((_record, node) => {
      node['bare'] = 'yes'
    }))).toBe('/nodes/0/bare: is not a boolean')
    expect(refusal(recordWith((_record, node) => {
      node['markerColumn'] = -1
    }))).toBe('/nodes/0/markerColumn: is not an integer of at least 0')
    expect(refusal(recordWith((_record, node) => {
      node['rawRef'] = 1
    }))).toBe('/nodes/0/rawRef: is not a string')
  })

  it('C2-L-010: a path is a JSON Pointer into the tree, and a slot is named by its field', () => {
    const result = parseWithLayout('a\n\nb\n\n- c\n')
    expect(resolvePointer(result.document, '/children/2/children/0')).toMatchObject({ type: 'list_item' })
    expect(result.layout.nodes.map((node) => node.path)).toContain('/children/2/children/0')
    const captioned = parseWithLayout('| a |\n^ T [x][y]\n')
    expect(captioned.layout.nodes.map((node) => node.path)).toEqual([FIRST, `${FIRST}/caption`, `${FIRST}/caption/children/0/children/1`])
    expect(resolvePointer(captioned.document, `${FIRST}/caption`)).toMatchObject({ type: 'caption' })
    const titled = parseWithLayout('::: note "see [a][b]"\nx\n:::\n')
    expect(titled.layout.nodes.map((node) => node.path)).toContain(`${FIRST}/title/1`)
    expect(resolvePointer(titled.document, `${FIRST}/title/1`)).toMatchObject({ type: 'link', key: 'b' })
    expect(refusal(recordWith((_record, node) => {
      node['path'] = 'children/0'
    }))).toBe('/nodes/0/path: is not a JSON Pointer')
    expect(refusal(recordWith((_record, node) => {
      node['path'] = '/a~2'
    }))).toBe('/nodes/0/path: is not a JSON Pointer')
  })

  it('C2-L-011: entries are sorted by path as strings, and no path stands twice', () => {
    const src = Array.from({ length: 12 }, (_value, index) => `p${index}\n`).join('\n')
    const paths = layoutOf(src).nodes.map((node) => node.path)
    expect(paths.slice(0, 5)).toEqual(['/children/0', '/children/1', '/children/10', '/children/11', '/children/2'])
    expect(paths).toEqual([...paths].sort((a, b) => (a < b ? -1 : 1)))
    const record = layoutOf('. a\n. b\n')
    expect(refusal({ ...record, nodes: [record.nodes[1], record.nodes[0]] })).toBe('/nodes/1/path: is not sorted by path')
    expect(refusal({ ...record, nodes: [record.nodes[0], record.nodes[0]] })).toBe('/nodes/1/path: is a duplicate path')
  })

  it('C2-L-012: a range counts UTF-8 bytes, a byte-order mark and every CR as they stand, and stays inside the source', () => {
    const result = parseWithLayout('﻿é\r\n\r\n- ü\r\n')
    const item = result.layout.nodes.find((node) => node.path === '/children/1/children/0')!
    const pos = result.document.children![1]!.children![0]!.pos!
    expect([item.startByte, item.endByte]).toEqual([pos.startOffset, pos.endOffset])
    expect([item.startByte, item.endByte]).toEqual([9, 13])
    expect(refusal(recordWith((_record, node) => {
      node['endByte'] = 5
    }))).toBe('/nodes/0/endByte: is past the end of the source')
    expect(refusal(recordWith((_record, node) => {
      node['startByte'] = 3
      node['endByte'] = 2
    }))).toBe('/nodes/0/startByte: is behind endByte')
    // The wrap offset counts bytes of the value too: `é ` is three bytes.
    expect(entry('| é |\n+ ü |\n', CELL)!.wraps![0]!.offset).toBe(3)
  })

  it('C2-L-013: a node without pos has the range from its first piece to its last', () => {
    const result = parseWithLayout('| a |\n+ b |\n')
    const cell = resolvePointer(result.document, CELL) as AstNode
    expect(cell.pos).toBeUndefined()
    expect(result.layout.nodes.find((node) => node.path === CELL)).toMatchObject({ startByte: 1, endByte: 10 })
    // A cell that spans rows runs to its fragment in the continuation row of the row below.
    expect(entry('| a | b |\n| ^ | c |\n+ z | y |\n', CELL)).toMatchObject({ startByte: 1, endByte: 24 })
  })

  it('C2-L-014: an entry stands only where a fact was measured, and an absent fact is no value', () => {
    const nodes = layoutOf('a *b* `c`\n').nodes
    expect(nodes.map((node) => node.path)).toEqual([FIRST])
    expect(Object.keys(nodes[0]!)).toEqual(['path', 'startByte', 'endByte', 'blankLinesBefore', 'blankLinesAfter'])
    expect(refusal({ version: 2, encoding: 'utf-8', source: 'a', lineEndings: 'none', bom: false, nodes: [] })).toBeNull()
    expect(refusal({ version: 2, encoding: 'utf-8', source: 'a', lineEndings: 'none', bom: false, nodes: [{ path: '', startByte: 0, endByte: 1 }] })).toBeNull()
  })

  it('C2-L-015: a record never reports a default as what the author wrote', () => {
    // A thematic break and a heading are recorded as typed, not in their canonical form.
    expect(entry('*****\n', FIRST)!.markerRaw).toBe('*****')
    expect(entry('# a\n', FIRST)!.markerRaw).toBe('#')
    // A bullet list has no numbering, so its entry has no `bare`.
    expect(entry('- a\n', FIRST)).not.toHaveProperty('bare')
  })

  it('the first example of the document: the facts it shows are in the record, which holds more', () => {
    const record = layoutOf('. a\n. b\n')
    expect(record).toMatchObject({ version: 2, encoding: 'utf-8', source: '. a\n. b\n', lineEndings: 'lf', bom: false })
    expect(record.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: '/children/0', startByte: 0, endByte: 7, bare: true }),
      expect.objectContaining({ path: '/children/0/children/0', startByte: 0, endByte: 3, markerRaw: '.', markerColumn: 0, contentColumn: 2 }),
      expect.objectContaining({ path: '/children/0/children/1', startByte: 4, endByte: 7, markerRaw: '.', markerColumn: 0, contentColumn: 2 }),
    ]))
  })
})

describe('facts moved out of the tree', () => {
  it('C2-L-016: bare is the form of the first marker of an ordered list', () => {
    expect(entry('. a\n. b\n', FIRST)!.bare).toBe(true)
    expect(entry('1. a\n2. b\n', FIRST)!.bare).toBe(false)
    expect(entry('. a\n2. b\n', FIRST)!.bare).toBe(true)
    expect(entry('1. a\n. b\n', FIRST)!.bare).toBe(false)
    expect(entry('a. x\n', FIRST)!.bare).toBe(false)
    expect(entry('1) x\n', FIRST)!.bare).toBe(false)
    expect(entry('{start=5}\n. a\n', FIRST)!.bare).toBe(true)
  })

  it('C2-L-017: fenced tells a quote fence from quote lines', () => {
    expect(entry('> a\n', FIRST)!.fenced).toBe(false)
    expect(entry('::: >\na\n:::\n', FIRST)!.fenced).toBe(true)
    expect(entry('> > a\n', `${FIRST}/children/0`)!.fenced).toBe(false)
    expect(treesEqual(parse('> a\n'), parse('::: >\na\n:::\n'))).toBe(true)
  })

  it('C2-L-018: hardBreakOpener tells the two forms of a hard-break block, on a div with the class only', () => {
    expect(entry('::: \\\na\nb\n:::\n', FIRST)!.hardBreakOpener).toBe(true)
    expect(entry('{.hardbreaks}\n:::\na\nb\n:::\n', FIRST)!.hardBreakOpener).toBe(false)
    expect(entry('::: hardbreaks\na\nb\n:::\n', FIRST)!.hardBreakOpener).toBe(false)
    expect(entry('{.x}\n::: \\\na\n:::\n', FIRST)!.hardBreakOpener).toBe(true)
    expect(entry('::: x\na\n:::\n', FIRST)).not.toHaveProperty('hardBreakOpener')
    expect(entry('::: note\na\n:::\n', FIRST)).not.toHaveProperty('hardBreakOpener')
  })

  it('C2-L-019: continuationLines counts the continuation rows of a row, the empty ones included', () => {
    const row = '/children/0/children/0/children/0'
    expect(entry('| a |\n+ b |\n', row)!.continuationLines).toBe(1)
    expect(entry('| a | b |\n+ | |\n+ c | |\n', row)!.continuationLines).toBe(2)
    expect(entry('| a |\n+ b |\n%% note\n+ c |\n', row)!.continuationLines).toBe(2)
    expect(entry('> | a |\n> + b |\n', `/children/0${row}`)!.continuationLines).toBe(1)
    expect(entry('| a |\n| b |\n+ c |\n', '/children/0/children/0/children/1')!.continuationLines).toBe(1)
    // A row with no continuation row has no entry.
    expect(entry('| a |\n| b |\n+ c |\n', row)).toBeUndefined()
  })

  it('C2-L-020: a wrap names the row, the node whose value holds the break and the byte offset in it', () => {
    const text = `${CELL}/children/0/children/0`
    expect(entry('| a |\n+ b |\n+ c |\n', CELL)!.wraps).toEqual([{ line: 1, path: text, offset: 2 }, { line: 2, path: text, offset: 4 }])
    // The row with an empty fragment is counted, and has no wrap.
    expect(entry('| a |\n+ |\n+ c |\n', CELL)!.wraps).toEqual([{ line: 2, path: text, offset: 2 }])
    // The break stands in the text of the strong span and in the value of the code span.
    expect(entry('| *a |\n+ b* |\n', CELL)!.wraps).toEqual([{ line: 1, path: `${text}/children/0`, offset: 2 }])
    expect(entry('| `a |\n+ b` |\n', CELL)!.wraps).toEqual([{ line: 1, path: text, offset: 2 }])
    // A cell that spans rows says how many rows below its own the continuation row stands.
    expect(entry('| a | b |\n| ^ | c |\n+ z | y |\n', CELL)!.wraps).toEqual([{ line: 1, path: text, offset: 2, row: 1 }])
    expect(entry('| a | b |\n+ q | |\n| ^ | c |\n+ z | y |\n', CELL)!.wraps).toEqual([
      { line: 1, path: text, offset: 2, row: 0 }, { line: 1, path: text, offset: 4, row: 1 },
    ])
    expect(entry('| a |\n| b |\n', CELL)).toBeUndefined()
    const record = layoutOf('| a |\n+ b |\n+ c |\n')
    const cell = record.nodes.find((node) => node.path === CELL)!
    expect(refusal({ ...record, nodes: [{ ...cell, wraps: [cell.wraps![1], cell.wraps![0]] }] })).toBe('/nodes/0/wraps/1/line: is not sorted by line')
    expect(refusal({ ...record, nodes: [{ ...cell, wraps: [{ line: 0, path: '', offset: 0 }] }] })).toBe('/nodes/0/wraps/0/line: is not an integer of at least 1')
    expect(refusal({ ...record, nodes: [{ ...cell, wraps: [{ line: 1, path: '', offset: 0, column: 1 }] }] })).toBe('/nodes/0/wraps/0/column: is not a field of a wrap')
  })

  it('C2-L-021: the joining space is the character before the offset, and a cell that starts with a fragment has offset 0', () => {
    const result = parseWithLayout('| ab |\n+ cd |\n')
    const wrap = result.layout.nodes.find((node) => node.path === CELL)!.wraps![0]!
    const value = (resolvePointer(result.document, wrap.path) as AstNode).value!
    expect(value).toBe('ab cd')
    expect(value[wrap.offset - 1]).toBe(' ')
    expect(value.slice(wrap.offset)).toBe('cd')
    // The cell a failed span mark leaves is empty, and so is the place of a cell that a fragment forms (C2-B-173, C2-B-176).
    expect(entry('| ^ |\n+ b |\n', CELL)!.wraps).toEqual([{ line: 1, path: `${CELL}/children/0/children/0`, offset: 0 }])
    const formed = '/children/0/children/0/children/0/children/1'
    expect(entry('| a |\n+ b | new |\n', formed)!.wraps).toEqual([{ line: 1, path: `${formed}/children/0/children/0`, offset: 0 }])
  })

  it('C2-L-022: rawRef holds the reference as typed, and the tree its folded key and its form', () => {
    const result = parseWithLayout('[a][ B  c ] [d][] ![e][f]{.x} [g](h)\n')
    const facts = result.layout.nodes.filter((node) => node.rawRef !== undefined).map((node) => [node.path, node.rawRef])
    expect(facts).toEqual([
      ['/children/0/children/0', '[a][ B  c ]'], ['/children/0/children/2', '[d][]'], ['/children/0/children/4', '[e][f]'],
    ])
    expect(resolvePointer(result.document, '/children/0/children/0')).toMatchObject({ type: 'link', key: 'B c', form: 'full' })
    // A reference that crosses lines of a quote is held without the quote marks.
    expect(entry('> [a\n> b][c]\n', '/children/0/children/0/children/0')!.rawRef).toBe('[a\nb][c]')
  })

  it('C2-L-023: sourceFormat says how a table was written', () => {
    expect(entry('| a |\n', FIRST)!.sourceFormat).toBe('pipe')
    expect(entry('{table}\n```csv\na\n```\n', FIRST)!.sourceFormat).toBe('csv')
    expect(entry('{table}\n```tsv\na\n```\n', FIRST)!.sourceFormat).toBe('tsv')
    expect(entry('```csv\na\n```\n', FIRST)).not.toHaveProperty('sourceFormat')
    expect(refusal(recordWith((_record, node) => {
      node['sourceFormat'] = 'html'
    }))).toBe('/nodes/0/sourceFormat: is not one of pipe, csv, tsv')
  })

  it('the second example of the document: the facts it shows are in the record, which holds more', () => {
    const record = layoutOf('| a |\n+ b |\n')
    expect(record.nodes).toEqual([
      expect.objectContaining({ path: '/children/0', startByte: 0, endByte: 11, sourceFormat: 'pipe' }),
      { path: '/children/0/children/0/children/0', startByte: 0, endByte: 11, continuationLines: 1 },
      {
        path: '/children/0/children/0/children/0/children/0', startByte: 1, endByte: 10,
        wraps: [{ line: 1, path: '/children/0/children/0/children/0/children/0/children/0/children/0', offset: 2 }],
      },
    ])
    expect(resolvePointer(parse('| a |\n+ b |\n'), `${CELL}/children/0/children/0`)).toMatchObject({ value: 'a b' })
  })
})

describe('measured facts', () => {
  it('C2-L-024: markerRaw is the marker as typed, and markerColumn the column of its first character', () => {
    const marker = (src: string, path: string): unknown[] => [entry(src, path)!.markerRaw, entry(src, path)!.markerColumn]
    const item = `${FIRST}/children/0`
    expect(marker('- a\n', item)).toEqual(['-', 0])
    expect(marker('  * a\n', item)).toEqual(['*', 2])
    expect(marker('12. a\n', item)).toEqual(['12.', 0])
    expect(marker('iv)  a\n', item)).toEqual(['iv)', 0])
    expect(marker('-{.x} [x] a\n', item)).toEqual(['-', 0])
    expect(marker('# a\n', FIRST)).toEqual(['#', 0])
    expect(marker('=== a\n', FIRST)).toEqual(['===', 0])
    expect(marker(' ****  \n', FIRST)).toEqual(['****', 1])
    expect(marker(':: t\n: d\n', item)).toEqual(['::', 0])
    expect(marker(':: t\n: d\n', `${FIRST}/children/1`)).toEqual([':', 0])
    expect(marker('[^n]: a\n', FIRST)).toEqual(['[^n]:', 0])
    expect(marker('[r]: /u\n', FIRST)).toEqual(['[r]:', 0])
    expect(marker('*[A]: b\n', FIRST)).toEqual(['*[A]:', 0])
    // C2-B-003, C2-B-004: columns count from behind the quote mark and its space, and a tab runs to the next stop.
    expect(marker('> - a\n', `${FIRST}/children/0/children/0`)).toEqual(['-', 0])
    expect(marker('>   - a\n', `${FIRST}/children/0/children/0`)).toEqual(['-', 2])
    expect(marker('\t- a\n', item)).toEqual(['-', 4])
    expect(entry('-\ta\n', FIRST)).not.toHaveProperty('markerRaw')
    expect(entry('- a\n', item)!.contentColumn).toBe(2)
    expect(entry('-   a\n', item)!.contentColumn).toBe(4)
    expect(entry('- [x] a\n', item)!.contentColumn).toBe(6)
    expect(entry('10. a\n', item)!.contentColumn).toBe(4)
    expect(entry(':: t\n:   d\n', `${FIRST}/children/1`)!.contentColumn).toBe(4)
    expect(entry('[^n]: a\n', FIRST)!.contentColumn).toBe(6)
    expect(entry('> - a\n', `${FIRST}/children/0/children/0`)!.contentColumn).toBe(2)
  })

  it('C2-L-024: openerRaw tells a tilde from a backtick and gives the length, without the info string', () => {
    const fence = (src: string, path = FIRST): unknown[] => [entry(src, path)!.openerRaw, entry(src, path)!.closerRaw]
    expect(fence('```js\nx\n```\n')).toEqual(['```', '```'])
    expect(fence('~~~~ js "t"\nx\n~~~~~\n')).toEqual(['~~~~', '~~~~~'])
    expect(fence('```=html\n<b>\n```\n')).toEqual(['```', '```'])
    expect(fence(':::: x\na\n::::\n')).toEqual(['::::', '::::'])
    expect(fence('::: note\na\n:::::\n')).toEqual([':::', ':::::'])
    expect(fence('::: toc\n:::\n')).toEqual([':::', ':::'])
    expect(fence('::: |\na\n:::\n')).toEqual([':::', ':::'])
    expect(fence('::: >\na\n:::\n')).toEqual([':::', ':::'])
    expect(fence('%%%\na\n%%%%\n')).toEqual(['%%%', '%%%%'])
    expect(fence('---toml\na = 1\n---\n')).toEqual(['---', '---'])
    expect(entry('> a\n', FIRST)).not.toHaveProperty('openerRaw')
    expect(entry('{table}\n```csv\na\n```\n', FIRST)).not.toHaveProperty('openerRaw')
  })

  it('C2-L-024: metadataSeparatorRaw is the separator behind a label or a term mark, whitespace included', () => {
    expect(entry('[^n]:   a\n', FIRST)!.metadataSeparatorRaw).toBe(':   ')
    expect(entry('[r]: /u\n', FIRST)!.metadataSeparatorRaw).toBe(': ')
    expect(entry('*[A]: b\n', FIRST)!.metadataSeparatorRaw).toBe(': ')
    expect(entry('::  t\n: d\n', `${FIRST}/children/0`)!.metadataSeparatorRaw).toBe('  ')
  })

  it('C2-L-024: a caption is attached to the block before it', () => {
    expect(entry('| a |\n^ T\n', `${FIRST}/caption`)!.attachment).toBe('preceding')
    expect(entry('```\nx\n```\n^ T\n', `${FIRST}/caption`)!.attachment).toBe('preceding')
    expect(refusal(recordWith((_record, node) => {
      node['attachment'] = 'detached'
    }))).toBe('/nodes/0/attachment: is not one of preceding, none')
  })

  it('C2-L-025: continuationStyle has one value, in the order lazy, indent, marker_line, none', () => {
    const item = `${FIRST}/children/0`
    expect(entry('- a\n', item)!.continuationStyle).toBe('marker_line')
    expect(entry('- a\n  b\n', item)!.continuationStyle).toBe('indent')
    expect(entry('- a\n\n  b\n', item)!.continuationStyle).toBe('indent')
    expect(entry('- a\nb\n', item)!.continuationStyle).toBe('lazy')
    // A lazy line wins over a line that reaches the content column.
    expect(entry('- a\n  b\nc\n', item)!.continuationStyle).toBe('lazy')
    expect(entry('1.  a\n  b\n', item)!.continuationStyle).toBe('lazy')
    // A later line that is no paragraph line and stands left of the content column is neither.
    expect(entry('1.  a\n  ```\n  x\n  ```\n', item)!.continuationStyle).toBe('none')
    expect(entry('[^n]: a\n  b\n', FIRST)!.continuationStyle).toBe('lazy')
    expect(entry('[^n]: a\n\n      b\n', FIRST)!.continuationStyle).toBe('indent')
    expect(entry(':: t\n: d\n  e\n', `${FIRST}/children/1`)!.continuationStyle).toBe('indent')
    expect(entry('> - a\n>   b\n', `${FIRST}/children/0/children/0`)!.continuationStyle).toBe('indent')
    expect(entry('> - a\nb\n', `${FIRST}/children/0/children/0`)!.continuationStyle).toBe('lazy')
  })

  it('C2-L-026: the blank lines around a block are the authored counts', () => {
    const blanks = (src: string, path: string): number[] => [entry(src, path)!.blankLinesBefore!, entry(src, path)!.blankLinesAfter!]
    expect(blanks('a\n\n\n\nb\n\n', FIRST)).toEqual([0, 3])
    expect(blanks('a\n\n\n\nb\n\n', '/children/1')).toEqual([3, 1])
    expect(blanks('\n\na\n', FIRST)).toEqual([2, 0])
    expect(blanks('a\n  \t\nb\n', FIRST)).toEqual([0, 1])
    // Inside a quote a blank line carries the mark, and a line without it is outside.
    expect(blanks('> a\n>\n>\n> b\n>\n\nc\n', `${FIRST}/children/0`)).toEqual([0, 2])
    expect(blanks('> a\n>\n>\n> b\n>\n\nc\n', `${FIRST}/children/1`)).toEqual([2, 1])
    expect(blanks('> a\n>\n>\n> b\n>\n\nc\n', '/children/1')).toEqual([1, 0])
    // The blank lines between two items stand around the items, not inside the first.
    expect(blanks('- a\n\n\n- b\n', `${FIRST}/children/0`)).toEqual([0, 2])
    expect(blanks('- a\n\n\n- b\n', `${FIRST}/children/0/children/0`)).toEqual([0, 0])
    expect(blanks('- a\n\n\n- b\n', `${FIRST}/children/1`)).toEqual([2, 0])
    expect(blanks('::: x\n\na\n\n\n:::\n', `${FIRST}/children/0`)).toEqual([1, 2])
    expect(blanks('a\n\n{.x}\n# b\n', '/children/1')).toEqual([1, 0])
    expect(blanks('a\r\n\r\nb\r\n', '/children/1')).toEqual([1, 0])
  })

  it('C2-L-027: the two runs come as a pair, the closer is empty where the block is unclosed, and the opener is never empty', () => {
    const fence = (src: string, path = FIRST): unknown[] => [entry(src, path)!.openerRaw, entry(src, path)!.closerRaw]
    expect(fence('```\nx\n')).toEqual(['```', ''])
    expect(fence('::: x\na\n')).toEqual([':::', ''])
    expect(fence('::: x\n')).toEqual([':::', ''])
    expect(fence('::: |\na\n')).toEqual([':::', ''])
    expect(fence('%%%\na\n')).toEqual(['%%%', ''])
    expect(fence('---\na: 1\n')).toEqual(['---', ''])
    // C2-B-125: a run closes the innermost div it is long enough for, so the outer div here is unclosed.
    expect(fence(':::: a\n::: b\nx\n::::\n')).toEqual(['::::', ''])
    expect(fence(':::: a\n::: b\nx\n::::\n', `${FIRST}/children/0`)).toEqual([':::', '::::'])
    expect(fence(':::: a\n::: |\nx\n::::\n')).toEqual(['::::', ''])
    // A run inside an item opens a div there and closes nothing outside the item.
    expect(fence('::: a\n- x\n  :::\n')).toEqual([':::', ''])
    expect(fence('::: a\n- x\n  :::\n', `${FIRST}/children/0/children/0/children/1`)).toEqual([':::', ''])
    expect(fence(':::: a\n:::\nx\n')).toEqual(['::::', ''])
    for (const node of layoutOf('```\na\n```\n\n::: x\nb\n').nodes) expect(node.openerRaw === undefined).toBe(node.closerRaw === undefined)
    expect(refusal(recordWith((_record, node) => {
      node['openerRaw'] = '```'
    }))).toBe('/nodes/0: openerRaw and closerRaw come as a pair')
    expect(refusal(recordWith((_record, node) => {
      node['closerRaw'] = ''
    }))).toBe('/nodes/0: openerRaw and closerRaw come as a pair')
    expect(refusal(recordWith((_record, node) => {
      node['openerRaw'] = ''
      node['closerRaw'] = ''
    }))).toBe('/nodes/0/openerRaw: is empty')
  })

  it('C2-L-028: no value for a continuation marker, and no fact for a leading or a trailing pipe', () => {
    expect(refusal(recordWith((_record, node) => {
      node['continuationStyle'] = 'explicit'
    }))).toBe('/nodes/0/continuationStyle: is not one of lazy, indent, marker_line, none')
    expect(refusal(recordWith((_record, node) => {
      node['attachment'] = 'continuation'
    }))).toBe('/nodes/0/attachment: is not one of preceding, none')
    expect(refusal(recordWith((_record, node) => {
      node['leadingPipe'] = true
    }))).toBe('/nodes/0/leadingPipe: is not a field of a node entry')
    const facts = new Set(layoutOf('| a |\n+ b |\n\n- c\n  d\n').nodes.flatMap((node) => Object.keys(node)))
    expect(facts.has('leadingPipe') || facts.has('trailingPipe')).toBe(false)
  })

  it('C2-L-029: a fact that the document does not define is refused', () => {
    for (const fact of ['trailingPipe', 'cellWraps', 'marker', 'pos']) {
      expect(refusal(recordWith((_record, node) => {
        node[fact] = true
      }))).toBe(`/nodes/0/${fact}: is not a field of a node entry`)
    }
  })
})

describe('defaults, from the side of the record', () => {
  it('C2-L-030: the bare dot and written numbers from 1 are one tree, and a start is in the tree', () => {
    expect(treesEqual(parse('. a\n. b\n'), parse('1. a\n2. b\n'))).toBe(true)
    // C2-B-045: the attribute and the first marker give the same start value.
    expect(treesEqual(parse('{start=3}\n. a\n'), parse('3. a\n'))).toBe(true)
    expect(parse('3. a\n').children![0]!.marker).toEqual({ kind: 'ordered', style: '1', delimiter: '.', start: 3 })
  })

  it('C2-L-031: a list with letters or with the paren is recorded as not bare', () => {
    expect(entry('a. x\n', FIRST)!.bare).toBe(false)
    expect(entry('ii)  x\n', FIRST)!.bare).toBe(false)
  })

  it('C2-L-032: the bullet character is in the tree, and no fact holds it', () => {
    expect(parse('* a\n').children![0]!.marker).toEqual({ kind: 'bullet', char: '*' })
    expect(Object.keys(entry('* a\n', FIRST)!)).toEqual(['path', 'startByte', 'endByte', 'blankLinesBefore', 'blankLinesAfter'])
  })

  it('C2-L-033: quote lines are the form a record states with fenced false', () => {
    expect(entry('> a\n> b\n', FIRST)).toMatchObject({ fenced: false })
  })

  it('C2-L-034: the two hard-break forms are one tree only when the class is last', () => {
    expect(treesEqual(parse('{.x}\n::: \\\na\nb\n:::\n'), parse('{.x .hardbreaks}\n:::\na\nb\n:::\n'))).toBe(true)
    expect(treesEqual(parse('{.x}\n::: \\\na\nb\n:::\n'), parse('{.hardbreaks .x}\n:::\na\nb\n:::\n'))).toBe(false)
    expect(entry('{.hardbreaks .x}\n:::\na\nb\n:::\n', FIRST)!.hardBreakOpener).toBe(false)
  })

  it('C2-L-035: a row on one line has no continuation fact, and is the tree of the wrapped row', () => {
    expect(layoutOf('| a b |\n').nodes.map((node) => node.path)).toEqual([FIRST])
    expect(treesEqual(parse('| a b |\n'), parse('| a |\n+ b |\n'))).toBe(true)
  })

  it('C2-L-036: a pipe table and a delimited table with the same cells are one tree', () => {
    expect(treesEqual(parse('|= a |\n| b |\n'), parse('{table}\n```csv\na\nb\n```\n'))).toBe(true)
    expect(entry('{table}\n```csv\n```\n', FIRST)!.sourceFormat).toBe('csv')
  })

  it('C2-L-037: the fence character and its length are in the record and not in the tree', () => {
    expect(treesEqual(parse('~~~~~\nx\n~~~~~\n'), parse('```\nx\n```\n'))).toBe(true)
    expect(entry('~~~~~\nx\n~~~~~\n', FIRST)!.openerRaw).toBe('~~~~~')
    expect(treesEqual(parse(':::::: x\na\n::::::\n'), parse('::: x\na\n:::\n'))).toBe(true)
  })

  it('C2-L-038: the heading marker is in the record and not in the tree', () => {
    expect(treesEqual(parse('## a\n'), parse('== a\n'))).toBe(true)
    expect([entry('## a\n', FIRST)!.markerRaw, entry('== a\n', FIRST)!.markerRaw]).toEqual(['##', '=='])
  })

  it('C2-L-039: the length of a thematic break is in the record and not in the tree', () => {
    expect(treesEqual(parse('*******\n'), parse('***\n'))).toBe(true)
    expect(entry('*******\n', FIRST)!.markerRaw).toBe('*******')
  })

  it('C2-L-040: the tree of a reference holds what a writer needs with no record: the text, the key and the form', () => {
    const link = resolvePointer(parse('[a][ B ] [c][]\n'), '/children/0/children/0')
    expect(link).toMatchObject({ key: 'B', form: 'full', children: [{ type: 'text', value: 'a' }] })
    expect(resolvePointer(parse('[a][ B ] [c][]\n'), '/children/0/children/2')).toMatchObject({ key: 'c', form: 'collapsed' })
  })

  it('C2-L-041: blank lines, content columns and the frontmatter opener are recorded as typed', () => {
    expect(entry('---yaml\na: 1\n---\n\n\n-    b\n', '/children/1')).toMatchObject({ blankLinesBefore: 2 })
    expect(entry('---yaml\na: 1\n---\n\n\n-    b\n', '/children/1/children/0')).toMatchObject({ contentColumn: 5 })
    expect(entry('---yaml\na: 1\n---\n', FIRST)).toMatchObject({ openerRaw: '---' })
  })

  it('C2-L-042: the record states each of the spellings that have two equal forms', () => {
    const src = '. a\n\n> b\n\n::: \\\nc\n:::\n\n| d |\n+ e |\n\n[f][g]\n'
    const facts = new Set(layoutOf(src).nodes.flatMap((node) => Object.keys(node)))
    for (const fact of ['bare', 'fenced', 'hardBreakOpener', 'sourceFormat', 'continuationLines', 'wraps']) expect(facts.has(fact)).toBe(true)
  })

  it('C2-L-043: the record states the spellings that have one canonical form as typed', () => {
    const src = '---\na: 1\n---\n\n# a\n\n*****\n\n~~~~\nb\n~~~~\n'
    const nodes = layoutOf(src).nodes
    expect(nodes.map((node) => node.markerRaw ?? node.openerRaw)).toEqual(['---', '#', '*****', '~~~~'])
  })

  it('C2-L-044: no fact changes the tree', () => {
    const typed = '# a\n\n1. b\n\n::: >\nc\n:::\n\n~~~~\nd\n~~~~\n\n*****\n\n| e |\n+ f |\n'
    const canonical = '= a\n\n. b\n\n> c\n\n```\nd\n```\n\n***\n\n| e f |\n'
    expect(treesEqual(parse(typed), parse(canonical))).toBe(true)
    expect(layoutOf(typed).nodes).not.toEqual(layoutOf(canonical).nodes)
  })

  it('C2-L-045: markerColumn of a comment-only line inside a quote is the column of the quote mark', () => {
    expect(entry('> a\n>\n> %% c\n', `${FIRST}/children/1`)).toMatchObject({ markerColumn: 0 })
    expect(entry('> a\n>\n  > %% c\n', `${FIRST}/children/1`)).toMatchObject({ markerColumn: 2 })
    expect(entry('> > a\n> >\n>  > %% c\n', `${FIRST}/children/0/children/1`)).toMatchObject({ markerColumn: 1 })
    expect(entry('a\n\n%% c\n', '/children/1')).not.toHaveProperty('markerColumn')
    // A comment-only line closes nothing, so it is inside the quote also without the mark, and then has no column.
    expect(entry('> ***\n%% c\n', `${FIRST}/children/1`)).not.toHaveProperty('markerColumn')
    expect(entry('> a\n>\n> %% c\n', `${FIRST}/children/1`)).not.toHaveProperty('markerRaw')
  })

  it('C2-L-046: the seven facts a writer reads stand on the nodes the document names', () => {
    const src = '. a\n\n> b\n\n::: \\\nc\n:::\n\n| d |\n+ e |\n\n[f][g] ![h][]\n\n{table}\n```tsv\ni\n```\n'
    const result = parseWithLayout(src)
    const types = new Map<string, Set<string>>()
    for (const node of result.layout.nodes) {
      const type = (resolvePointer(result.document, node.path) as AstNode).type
      for (const fact of Object.keys(node)) types.set(fact, (types.get(fact) ?? new Set()).add(type))
    }
    expect([...types.get('bare')!]).toEqual(['list'])
    expect([...types.get('fenced')!]).toEqual(['block_quote'])
    expect([...types.get('hardBreakOpener')!]).toEqual(['div'])
    expect([...types.get('sourceFormat')!]).toEqual(['table'])
    expect([...types.get('continuationLines')!]).toEqual(['table_row'])
    expect([...types.get('wraps')!]).toEqual(['table_cell'])
    expect([...types.get('rawRef')!]).toEqual(['link', 'image'])
  })
})

describe('every example of the specification', () => {
  it('has a record a reader accepts, whose paths and ranges are those of the tree of parse', () => {
    expect(EXAMPLES.length).toBeGreaterThan(300)
    for (const example of EXAMPLES) {
      const result = parseWithLayout(example.input)
      const label = `${example.file} ${example.number}`
      expect(() => validateLayout(result.layout), label).not.toThrow()
      expect(result.document, label).toEqual(parse(example.input))
      expect(result.layout.source, label).toBe(example.input)
      const length = utf8Length(example.input)
      for (const node of result.layout.nodes) {
        const target = resolvePointer(result.document, node.path) as AstNode | undefined
        expect(target, `${label} ${node.path}`).toHaveProperty('type')
        expect(node.endByte, `${label} ${node.path}`).toBeLessThanOrEqual(length)
        if (target?.pos !== undefined) expect([node.startByte, node.endByte], `${label} ${node.path}`).toEqual([target.pos.startOffset, target.pos.endOffset])
        for (const wrap of node.wraps ?? []) expect(resolvePointer(result.document, wrap.path), `${label} ${wrap.path}`).toHaveProperty('type')
      }
    }
  })
})
