import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { parse, treesEqual, validateLayout, validateTree, write } from '../src/index.ts'
import { migrateTree } from './index.ts'

describe('stored tree migration', () => {
  it('C2-A-176 upgrades a bare 1.x paragraph and validates it', () => {
    const old = { type: 'document', children: [{ type: 'paragraph', children: [{ type: 'text', value: 'Hi' }] }] }
    const result = migrateTree(old)
    assert.equal(result.document.astVersion, '2.0')
    assert.equal(treesEqual(result.document, parse('Hi')), true)
    assert.doesNotThrow(() => validateTree(result.document))
  })

  it('C2-A-179 upgrades lists and task marks from an envelope', () => {
    const old = { astVersion: '1.2', document: { type: 'document', children: [{ type: 'list', ordered: false,
      tight: true, items: [{ type: 'list_item', checked: true, taskState: 'x', children: [
        { type: 'paragraph', children: [{ type: 'text', value: 'done' }] },
      ] }] }] } }
    const result = migrateTree(old)
    const list = result.document.children[0]
    assert.equal(list?.type, 'list')
    if (list?.type === 'list') {
      assert.deepEqual(list.marker, { kind: 'bullet', char: '-' })
      assert.equal(list.spacing, 'tight')
      assert.deepEqual(list.children[0]?.task, { mark: 'x' })
    }
  })

  it('C2-A-178 groups flat table rows and wraps cell text', () => {
    const old = { type: 'document', children: [{ type: 'table', rows: [{ type: 'table_row', cells: [
      { type: 'table_cell', header: true, children: [{ type: 'text', value: 'Head' }] },
    ] }, { type: 'table_row', cells: [
      { type: 'table_cell', header: false, children: [{ type: 'text', value: 'Body' }] },
    ] }] }] }
    const result = migrateTree(old)
    const table = result.document.children[0]
    assert.equal(table?.type, 'table')
    if (table?.type === 'table') {
      assert.equal(table.columns.length, 1)
      assert.deepEqual(table.children.map((child) => child.type), ['table_head', 'table_body'])
    }
    assert.equal(treesEqual(result.document, parse('|= Head |\n| Body |')), true)
  })

  it('C2-A-178 renames retired draft fields and keeps reference spelling in layout', () => {
    const old = { type: 'document', astVersion: '2.0', children: [
      { type: 'link_reference_definition', key: 'a', namespace: 'link', href: '/u', title: 'Tip' },
      { type: 'paragraph', children: [{ type: 'link', key: 'a', namespace: 'link', form: 'collapsed', rawRef: '[a][]',
        children: [{ type: 'text', value: 'a' }] }] },
    ] }
    const result = migrateTree(old)
    const definition = result.document.children[0]
    assert.equal(definition?.type === 'link_reference_definition' ? definition.tooltip : undefined, 'Tip')
    const paragraph = result.document.children[1]
    assert.equal(paragraph?.type === 'paragraph' && paragraph.children[0]?.type === 'link' ?
      paragraph.children[0].refForm : undefined, 'collapsed')
    assert.equal(result.layout.nodes.find((entry) => entry.path === '/children/1/children/0')?.rawRef, '[a][]')
  })

  it('C2-A-177 returns an already valid 2.0 tree by identity', () => {
    const document = parse('Hi')
    assert.equal(migrateTree(document).document, document)
  })

  it('C2-A-180 writes a migrated tree with source layout', () => {
    const source = 'Hello *world*\n'
    const old = { type: 'document', children: [{ type: 'paragraph', children: [
      { type: 'text', value: 'Hello ' }, { type: 'strong', children: [{ type: 'text', value: 'world' }] },
    ] }] }
    const result = migrateTree(old, { source })
    assert.equal(write(result.document, { layout: result.layout }), source)
  })

  it('C2-A-178 moves a cell wrap into the layout record', () => {
    const old = { type: 'document', children: [{ type: 'table', rows: [{ type: 'table_row', cells: [
      { type: 'table_cell', header: false, children: [
        { type: 'text', value: 'a' }, { type: 'cell_wrap', line: 1 }, { type: 'text', value: 'b' },
      ] },
    ] }] }] }
    const result = migrateTree(old)
    assert.doesNotThrow(() => validateLayout(result.layout))
    assert.deepEqual(result.layout.nodes.find((entry) => entry.wraps !== undefined)?.wraps, [
      { line: 1, path: '/children/0/children/0/children/0/children/0/children/0/children/0', offset: 2 },
    ])
  })

  it('C2-A-178 decodes include options and retired citation fields', () => {
    const old = { type: 'document', astVersion: '0.2', children: [
      { type: 'include', path: 'chapter.crv', options: [['shift', '2'], ['code', ''], ['cols', 'name,price']] },
      { type: 'paragraph', children: [{ type: 'citation_group', raw: '[@a]', items: [
        { type: 'citation', key: 'a', suppressAuthor: true, locatorLabel: 'page', locatorValue: '7' },
      ] }] },
    ] }
    const result = migrateTree(old)
    assert.equal(result.document.children[0]?.type, 'include')
    if (result.document.children[0]?.type === 'include') {
      assert.deepEqual(result.document.children[0].options, { shift: 2, code: true, cols: ['name', 'price'] })
    }
    assert.equal(result.document.children[1]?.type, 'paragraph')
    if (result.document.children[1]?.type === 'paragraph') {
      const group = result.document.children[1].children[0]
      assert.equal(group?.type, 'citation_group')
      if (group?.type === 'citation_group') assert.equal(group.children[0]?.mode, 'suppress-author')
    }
  })

  it('C2-A-177 migrates ruby pairs and drops stored task status', () => {
    const old = { type: 'document', astVersion: '2.0', children: [
      { type: 'paragraph', children: [{ type: 'ruby', pairs: [{ type: 'rubyPair',
        base: [{ type: 'text', value: '字' }], annotation: [{ type: 'text', value: 'ji' }],
      }] }] },
      { type: 'list', marker: { kind: 'bullet', char: '-' }, spacing: 'tight', children: [
        { type: 'list_item', task: { mark: 'x', status: 'cancelled' }, children: [] },
      ] },
    ] }
    const result = migrateTree(old)
    const paragraph = result.document.children[0]
    assert.equal(paragraph?.type, 'paragraph')
    if (paragraph?.type === 'paragraph') {
      const ruby = paragraph.children[0]
      assert.equal(ruby?.type, 'ruby')
      if (ruby?.type === 'ruby') assert.equal(ruby.pairs[0]?.type, 'ruby_pair')
    }
    const list = result.document.children[1]
    assert.equal(list?.type, 'list')
    if (list?.type === 'list') assert.deepEqual(list.children[0]?.task, { mark: 'x' })
  })
})
