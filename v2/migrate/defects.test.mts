// Stored 0.1 trees whose migration lost or corrupted content, each named by the clause or row that decides it.
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { validateTree } from '../src/index.ts'
import { migrateTree } from './index.ts'

const paragraph = (inline: unknown[]): unknown => ({ type: 'document', astVersion: '1.2', children: [{ type: 'paragraph', children: inline }] })
const first = (result: ReturnType<typeof migrateTree>): unknown => result.document.children[0]
const inline = (result: ReturnType<typeof migrateTree>): unknown => {
  const block = result.document.children[0]
  return block?.type === 'paragraph' ? block.children[0] : undefined
}
const codes = (result: ReturnType<typeof migrateTree>): string[] => result.diagnostics.map((entry) => `${entry.code} ${entry.path ?? ''}`)

describe('migration defects', () => {
  it('C2-A-102: a math label becomes numberPrefix and keeps its number; on inline math both are a loss', () => {
    const display = migrateTree(paragraph([{ type: 'math', display: true, content: 'E', label: 'Equation', number: 1 }]))
    assert.deepEqual(inline(display), { type: 'math', display: true, value: 'E', numberPrefix: 'Equation', number: 1 })
    const text = migrateTree(paragraph([{ type: 'math', display: false, content: 'E', label: 'Eq', number: 2 }]))
    assert.deepEqual(inline(text), { type: 'math', display: false, value: 'E' })
    assert.deepEqual(codes(text), ['migration-loss /children/0/children/0/label'])
  })

  it('T-019: a ruby pair record without a type becomes a ruby_pair with its base and annotation', () => {
    const result = migrateTree(paragraph([{ type: 'ruby', pairs: [{ base: [{ type: 'text', value: 'k' }],
      annotation: [{ type: 'text', value: 'r' }] }] }]))
    assert.deepEqual(inline(result), { type: 'ruby', pairs: [{ type: 'ruby_pair', base: [{ type: 'text', value: 'k' }],
      annotation: [{ type: 'text', value: 'r' }] }] })
    assert.deepEqual(result.diagnostics, [])
  })

  it('T-037: the blocks of a table cell become its block children', () => {
    const result = migrateTree({ type: 'document', astVersion: '1.2', children: [{ type: 'table', rows: [{ type: 'table_row',
      cells: [{ type: 'table_cell', header: false, blocks: [{ type: 'paragraph', children: [{ type: 'text', value: 'x' }] }] }] }] }] })
    const table = first(result)
    assert.equal(table !== null && typeof table === 'object' && 'children' in table, true)
    assert.match(JSON.stringify(table), /"type":"table_cell",("header":false,)?"children":\[\{"type":"paragraph","children":\[\{"type":"text","value":"x"\}\]\}\]/)
  })

  it('T-050, C2-A-122: a single block fallback becomes a list and a 0.1 payload a list of one', () => {
    const fallback = { type: 'paragraph', children: [{ type: 'text', value: 'fb' }] }
    const result = migrateTree({ type: 'document', astVersion: '1.2', children: [{ type: 'block_extension', name: 'acme.chart',
      version: '1', fallback, payload: { format: 'application/json', value: { a: 1 } } }] })
    assert.deepEqual(first(result), { type: 'block_extension', name: 'acme.chart', version: '1', children: [], fallback: [fallback],
      payload: [{ format: 'application/json', value: { a: 1 } }] })
    assert.deepEqual(result.document.extensions, [{ name: 'acme.chart', version: '1', required: false, slots: [] }])
    const bad = migrateTree({ type: 'document', astVersion: '1.2', children: [{ type: 'block_extension', name: 'acme.chart',
      version: '1', fallback, payload: { a: 1 } }] })
    assert.equal(JSON.stringify(first(bad)).includes('payload'), false)
    assert.deepEqual(codes(bad), ['migration-loss /children/0/payload'])
  })

  it('C2-A-107: an unresolved 0.1 reference loses its empty href, a resolved empty one keeps it', () => {
    const reference = { ref: 'r', rawRef: '[x][r]', children: [{ type: 'text', value: 'x' }] }
    const unresolved = inline(migrateTree(paragraph([{ type: 'link', href: '', ...reference }])))
    assert.equal(JSON.stringify(unresolved).includes('href'), false)
    const resolved = inline(migrateTree(paragraph([{ type: 'link', href: '', resolved: true, ...reference }])))
    assert.equal((resolved as { href?: string }).href, '')
    const image = inline(migrateTree(paragraph([{ type: 'image', src: '', alt: 'x', ref: 'r', rawRef: '![x][r]', resolved: true }])))
    assert.equal((image as { src?: string }).src, '')
    const missing = inline(migrateTree(paragraph([{ type: 'image', src: '', alt: 'x', ref: 'r', rawRef: '![x][r]' }])))
    assert.equal(JSON.stringify(missing).includes('src'), false)
  })

  it('C2-A-180, C2-A-012, C2-A-017: an envelope vocabulary string and a declaration 0.1 cannot name are reported', () => {
    const result = migrateTree({ astVersion: '1.2', vocabulary: 'https://example.org/ast/other',
      extensions: [{ id: 'https://markup-carve.org/ext/citations', version: '1' }, { id: 'acme.x', version: '2', required: false }],
      document: { type: 'document', children: [], srcByteLength: 0 } })
    assert.deepEqual(result.envelope?.extensions, [{ name: 'acme.x', version: '2', required: false, slots: [] }])
    assert.equal(result.envelope?.vocabulary, undefined)
    assert.deepEqual(codes(result), ['migration-loss /vocabulary', 'migration-loss /extensions/0'])
    const core = migrateTree({ astVersion: '1.2', vocabulary: 'https://markup-carve.org/ast/core',
      document: { type: 'document', children: [] } })
    assert.deepEqual(core.diagnostics, [])
  })

  it('T-041, C2-A-123: a qualified inline extension takes the version its 0.1 declaration gives, and a fallback', () => {
    const node = { type: 'inline_extension', name: 'acme.x', content: [{ type: 'text', value: 'x' }] }
    const declared = migrateTree({ astVersion: '1.2', extensions: [{ id: 'acme.x', version: '1', required: false }],
      document: paragraph([node]) })
    assert.deepEqual(inline(declared), { type: 'inline_extension', name: 'acme.x', version: '1',
      children: [{ type: 'text', value: 'x' }], fallback: [{ type: 'text', value: 'x' }] })
    assert.deepEqual(declared.document.extensions, [{ name: 'acme.x', version: '1', required: false, slots: [] }])
    const own = migrateTree({ astVersion: '1.2', extensions: [{ id: 'acme.x', version: '1', required: false }],
      document: paragraph([{ ...node, fallback: [{ type: 'text', value: 'f' }] }]) })
    assert.deepEqual((inline(own) as { fallback?: unknown }).fallback, [{ type: 'text', value: 'f' }])
    const bare = migrateTree(paragraph([node]))
    assert.deepEqual(inline(bare), { type: 'text', value: 'x' })
    assert.deepEqual(codes(bare), ['migration-loss /children/0/children/0'])
  })

  it('C2-A-069: a block comment of a 0.1 line block becomes a line that holds it', () => {
    const result = migrateTree({ type: 'document', astVersion: '1.2', children: [{ type: 'line_block', children: [
      { type: 'comment', block: true, content: 'x' }] }] })
    assert.deepEqual(first(result), { type: 'line_block', children: [{ type: 'line', children: [
      { type: 'comment', value: 'x', form: 'block' }] }] })
  })

  it('C2-A-141: code point offsets become UTF-8 byte offsets with the source, and are dropped and reported without it', () => {
    const old = paragraph([{ type: 'text', value: 'é ', pos: { startLine: 1, endLine: 1, startColumn: 1, endColumn: 3,
      startOffset: 0, endOffset: 2 } }, { type: 'strong', children: [{ type: 'text', value: 'x' }],
      pos: { startLine: 1, endLine: 1, startColumn: 3, endColumn: 6, startOffset: 2, endOffset: 5 } }])
    const withSource = migrateTree(old, { source: 'é *x*' })
    const block = withSource.document.children[0]
    const strong = block?.type === 'paragraph' ? block.children[1] : undefined
    assert.equal(strong?.pos?.startOffset, 3)
    assert.equal(strong?.pos?.endOffset, 6)
    assert.equal(strong?.pos?.startColumn, 3)
    const without = migrateTree(old)
    assert.equal(JSON.stringify(without.document).includes('"pos"'), false)
    assert.deepEqual(codes(without), ['migration-loss /children/0/children/0/pos'])
    assert.doesNotThrow(() => validateTree(without.document))
    const ascii = migrateTree(paragraph([{ type: 'text', value: 'a', pos: { startLine: 1, endLine: 1, startColumn: 1,
      endColumn: 2, startOffset: 0, endOffset: 1 } }]))
    assert.deepEqual(ascii.diagnostics, [])
    assert.equal(JSON.stringify(ascii.document).includes('"pos"'), true)
  })
})
