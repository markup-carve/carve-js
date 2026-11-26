// C2-W-158: the writer's entries on a supplied tree stand in document order of their paths (carve#6619).
import { describe, expect, it } from 'vitest'
import { decodeTree, writeWithDiagnostics } from '../src/index.ts'

const text = (value: string) => ({ type: 'text', value })
const plain = (header = false) => ({ type: 'table_cell', header, children: [{ type: 'cell_paragraph', children: [text('x')] }] })
const blocks = () => ({ type: 'table_cell', header: false,
  children: [{ type: 'paragraph', children: [text('a')] }, { type: 'paragraph', children: [text('b')] }] })
const row = (cells: object[]) => ({ type: 'table_row', children: cells })

function entries(tree: object): string[] {
  return writeWithDiagnostics(decodeTree(JSON.stringify(tree))).diagnostics.map((entry) => `${entry.code} ${entry.path}`)
}

describe('C2-W-158: write diagnostics in document order', () => {
  it('lists the fields of a table group before the nodes inside it (CC-2045)', () => {
    const table = { type: 'table', columns: [{ type: 'table_column' }, { type: 'table_column' }], children: [
      { type: 'table_head', attrs: { id: 'head' }, children: [row([plain(true), plain(true)])] },
      { type: 'table_body', attrs: { id: 'body' }, children: [row([plain(), plain()]), row([plain(), blocks()])] },
      { type: 'table_foot', attrs: { id: 'foot' }, children: [row([plain(), plain()])] },
    ] }
    expect(entries({ type: 'document', astVersion: '2.0', children: [table] })).toEqual([
      'field-unspellable /children/0/children/0/attrs',
      'field-unspellable /children/0/children/1/attrs',
      'structure-unspellable /children/0/children/1/children/1/children/1',
      'field-unspellable /children/0/children/2/attrs',
    ])
  })

  it('compares each index as a number', () => {
    const rows = Array.from({ length: 12 }, (_, at) => row([plain(), at === 2 || at === 10 ? blocks() : plain()]))
    const table = (attrs?: object) => ({ type: 'table', columns: [{ type: 'table_column' }, { type: 'table_column' }],
      children: [{ type: 'table_body', ...(attrs === undefined ? {} : { attrs }), children: rows }] })
    const children = [table(), ...Array.from({ length: 9 }, () => ({ type: 'paragraph', children: [text('p')] })),
      table({ id: 'late' })]
    expect(entries({ type: 'document', astVersion: '2.0', children })).toEqual([
      'structure-unspellable /children/0/children/0/children/2/children/1',
      'structure-unspellable /children/0/children/0/children/10/children/1',
      'field-unspellable /children/10/children/0/attrs',
      'structure-unspellable /children/10/children/0/children/2/children/1',
      'structure-unspellable /children/10/children/0/children/10/children/1',
    ])
  })

  it('lists the fields of the document before its blocks, two fields in the key order of the tree', () => {
    const body = { type: 'table', columns: [{ type: 'table_column' }, { type: 'table_column' }],
      children: [{ type: 'table_body', children: [row([plain(), blocks()])] }] }
    expect(entries({ type: 'document', astVersion: '2.0', lang: 'de',
      metadata: { keywords: ['a'], abstract: [{ type: 'paragraph', children: [text('s')] }] }, children: [body] })).toEqual([
      'field-unspellable /metadata/keywords',
      'field-unspellable /metadata/abstract',
      'field-unspellable /lang',
      'structure-unspellable /children/0/children/0/children/0/children/1',
    ])
  })
})
