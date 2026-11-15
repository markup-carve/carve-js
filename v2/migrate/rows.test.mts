import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { migrateTree } from './index.ts'

interface Case { children?: unknown[], root?: Record<string, unknown>, path: string, expected: unknown, source?: string,
  also?: Record<string, unknown> }
const text = (value: string): Record<string, unknown> => ({ type: 'text', value })
const paragraph = (...children: unknown[]): Record<string, unknown> => ({ type: 'paragraph', children })
const item = (...children: unknown[]): Record<string, unknown> => ({ type: 'list_item', children })
const list = (...items: unknown[]): Record<string, unknown> => ({ type: 'list', ordered: false, items })
const cell = (...children: unknown[]): Record<string, unknown> => ({ type: 'table_cell', header: false, children })
const table = (...cells: unknown[]): Record<string, unknown> => ({ type: 'table', rows: [{ type: 'table_row', cells }] })

function at(value: unknown, path: string): unknown {
  let current = value
  for (const step of path.split('.')) {
    if (current === null || typeof current !== 'object') return undefined
    current = Reflect.get(current, Number.isInteger(Number(step)) ? Number(step) : step) as unknown
  }
  return current
}

const cases: Record<string, Case> = {
  'T-001': { children: [paragraph({ type: 'critic_substitution', old: 'before', new: 'after' })],
    path: 'document.children.0.children.0.type', expected: 'delete' },
  'T-002': { children: [paragraph(text('a'), { type: 'escaped_text', value: 'b' })],
    path: 'document.children.0.children.0.value', expected: 'ab' },
  'T-003': { children: [table(cell(text('a'), { type: 'cell_wrap', line: 1 }, text('b')))],
    path: 'document.children.0.children.0.children.0.children.0.children.0.children.0.value', expected: 'a b' },
  'T-004': { children: [paragraph({ type: 'code', value: 'x', cellWraps: [1] })],
    path: 'document.children.0.children.0.cellWraps', expected: undefined },
  'T-005': { children: [paragraph({ type: 'link', key: '  Ref  ', rawRef: '[Ref][]', children: [text('Ref')] })],
    path: 'document.children.0.children.0.refForm', expected: 'collapsed',
    also: { 'document.children.0.children.0.rawRef': undefined, 'document.children.0.children.0.key': 'Ref' } },
  'T-006': { children: [paragraph({ type: 'footnote_ref', key: '  Ref  ' })],
    path: 'document.children.0.children.0.key', expected: 'Ref' },
  'T-007': { children: [paragraph(text('x'))], root: { attrs: { order: ['b', 'a'], keyValues: { a: '1', b: '2' } } },
    path: 'document.attrs.keyValues', expected: [['b', '2'], ['a', '1']] },
  'T-008': { children: [{ type: 'image', src: '/x', alt: 'x' }],
    path: 'document.children.0.role', expected: 'image' },
  'T-009': { children: [{ type: 'line_block', lines: [], children: [paragraph(text('a'), { type: 'hard_break' }, text('b'))] }],
    path: 'document.children.0.children.1.type', expected: 'line' },
  'T-010': { children: [{ type: 'heading', level: 1, attrs: { id: 'authored' }, children: [text('H')] }],
    path: 'document.children.0.attrs.id', expected: 'authored' },
  'T-011': { children: [{ type: 'block_quote', fenced: true, children: [paragraph(text('x'))] }],
    path: 'document.children.0.fenced', expected: undefined,
    also: { 'layout.nodes.0.fenced': true } },
  'T-012': { children: [{ type: 'definition_list', spacing: 'loose', children: [
    { type: 'definition_term', children: [text('t')] }, { type: 'definition_description', children: [paragraph(text('d'))] }] }],
    path: 'document.children.0.spacing', expected: undefined },
  'T-013': { children: [paragraph({ type: 'image', src: '/x', alt: 'x' })],
    root: { stages: ['blockImagePromotion'] }, path: 'document.stages', expected: [] },
  'T-014': { children: [list({ type: 'list_item', task: { mark: 'x', status: 'cancelled' }, children: [paragraph(text('x'))] })],
    path: 'document.children.0.children.0.task', expected: { mark: 'x' } },
  'T-015': { children: [paragraph({ type: 'link', key: 'r', form: 'collapsed', children: [text('r')] })],
    path: 'document.children.0.children.0.refForm', expected: 'collapsed' },
  'T-016': { children: [paragraph({ type: 'xref', key: 'h', namespace: 'heading', form: 'title' })],
    path: 'document.children.0.children.0.display', expected: 'title' },
  'T-017': { children: [{ type: 'link_reference_definition', key: 'r', href: '/u', title: 'Tip' }],
    path: 'document.children.0.tooltip', expected: 'Tip' },
  'T-018': { children: [{ ...paragraph({ type: 'math', value: 'x', display: true }), blockMath: true }],
    path: 'document.children.0.role', expected: 'math' },
  'T-019': { children: [paragraph({ type: 'ruby', pairs: [{ type: 'rubyPair', base: [text('字')], annotation: [text('ji')] }] })],
    path: 'document.children.0.children.0.pairs.0.type', expected: 'ruby_pair' },
  'T-020': { children: [paragraph({ type: 'citation_group', raw: '[@a]',
    items: [{ type: 'citation', key: 'a', suppressAuthor: true }] })],
    path: 'document.children.0.children.0.children.0.mode', expected: 'suppress-author' },
  'T-021': { children: [paragraph({ type: 'citation_group', raw: '[@a]', mode: 'normal',
    items: [{ type: 'citation', key: 'a' }] })],
    path: 'document.children.0.children.0.mode', expected: undefined },
  'T-022': { children: [paragraph({ type: 'citation_group', raw: '[@a]', items: [
    { type: 'citation', key: 'a', locatorLabel: 'page', locatorValue: '7' }] })],
    path: 'document.children.0.children.0.children.0.locator',
    expected: { label: 'page', children: [text('7')] } },
  'T-023': { children: [list({ type: 'list_item', task: { mark: 'x', status: 'done' }, children: [paragraph(text('x'))] })],
    path: 'document.children.0.children.0.task.status', expected: undefined },
  'T-024': { children: [{ type: 'include', path: 'a.crv', options: [['shift', '2'], ['code', '']] }],
    path: 'document.children.0.options', expected: { shift: 2, code: true } },
  'T-025': { children: [{ type: 'thematic_break', marker: '---' }],
    path: 'document.children.0.marker', expected: undefined },
  'T-026': { children: [{ type: 'link_reference_definition', key: 'r', href: '/u' }],
    path: 'document.children.0.type', expected: 'link_reference_definition' },
  'T-027': { children: [{ type: 'admonition', kind: 'custom', children: [paragraph(text('x'))] }],
    path: 'document.children.0.attrs.classes', expected: ['custom'] },
  'T-028': { children: [paragraph(text('x'))], path: 'document.astVersion', expected: '2.0' },
  'T-029': { children: [{ ...paragraph(text('x')), lang: 'en', dir: 'ltr' }],
    path: 'document.children.0.lang', expected: 'en' },
  'T-030': { children: [{ type: 'footnote', label: '  note ', children: [paragraph(text('x'))] }],
    path: 'document.children.0.key', expected: 'note' },
  'T-031': { children: [{ type: 'code_block', content: 'x\n', lang: 'js', header: 'Title', label: 'G' }],
    path: 'document.children.0.syntax', expected: 'js',
    also: { 'document.children.0.value': 'x\n', 'document.children.0.title.0.value': 'Title',
      'document.children.0.groupLabel': 'G', 'document.children.0.content': undefined } },
  'T-032': { children: [{ type: 'raw_block', format: 'html', content: '<b>x</b>\n' }],
    path: 'document.children.0.value', expected: '<b>x</b>\n' },
  'T-033': { children: [{ type: 'comment', block: true, content: 'x\n' }],
    path: 'document.children.0.form', expected: 'block' },
  'T-034': { children: [{ type: 'list', ordered: true, start: 0, tight: false, items: [item(paragraph(text('x')))] }],
    path: 'document.children.0.marker.start', expected: 0,
    also: { 'document.children.0.marker.kind': 'ordered', 'document.children.0.spacing': 'loose' } },
  'T-035': { children: [list(item(paragraph(text('x'))))],
    path: 'document.children.0.children.0.type', expected: 'list_item' },
  'T-036': { children: [table(cell(text('x')))],
    path: 'document.children.0.children.0.type', expected: 'table_body' },
  'T-037': { children: [table(cell(text('x')))],
    path: 'document.children.0.children.0.children.0.children.0.children.0.type', expected: 'cell_paragraph' },
  'T-038': { children: [{ type: 'figure', target: 'image', shortCaption: [text('short')],
    children: [paragraph(text('x'))], caption: { type: 'caption', children: [paragraph(text('cap'))] } }],
    path: 'document.children.0.kind', expected: 'image',
    also: { 'document.children.0.caption.short.0.value': 'short', 'document.children.0.target': undefined } },
  'T-039': { children: [paragraph({ type: 'mention', user: 'alice' })],
    path: 'document.children.0.children.0.target', expected: 'alice',
    also: { 'document.children.0.children.0.kind': 'user', 'document.children.0.children.0.user': undefined } },
  'T-040': { children: [paragraph({ type: 'inline_footnote', inline: [text('note')] })],
    path: 'document.children.0.children.0.children.0.value', expected: 'note' },
  'T-041': { children: [paragraph({ type: 'inline_extension', name: 'note', content: [text('x')] })],
    path: 'document.children.0.children.0.children.0.value', expected: 'x' },
  'T-042': { children: [paragraph({ type: 'heading_ref', target: 'h', form: 'title' })],
    path: 'document.children.0.children.0.type', expected: 'xref' },
  'T-043': { children: [paragraph({ type: 'substitution', old: 'a', new: 'b' })],
    path: 'document.children.0.children.1.type', expected: 'insert' },
  'T-044': { children: [paragraph({ type: 'image', src: '/x', alt: 'x', targetKind: 'url' })],
    path: 'document.children.0.children.0.alt', expected: 'x' },
  'T-045': { children: [table({ type: 'table_cell', header: true, scope: 'col', children: [text('x')] })],
    path: 'document.children.0.children.0.children.0.children.0.scope', expected: 'col' },
  'T-046': { children: [{ type: 'heading', level: 1, generatedId: 'h', children: [text('H')] }],
    path: 'document.children.0.generatedId', expected: 'h' },
  'T-047': { children: [paragraph(text('x'))], source: 'x\n',
    path: 'layout.source', expected: 'x\n' },
  'T-048': { children: [paragraph({ type: 'link', key: 'r', rawRef: '[r][]', children: [text('r')] })],
    path: 'document.children.0.children.0.rawRef', expected: undefined },
  'T-049': { children: [{ type: 'include', path: 'a.crv', section: 'intro', options: [['code', '']] }],
    path: 'document.children.0.section', expected: 'intro' },
  'T-050': { children: [{ type: 'block_extension', name: 'test.note', version: '1', children: [],
    fallback: [paragraph(text('safe'))], source: { form: 'div', name: 'note', body: 'safe\n' } }],
    root: { extensions: [{ name: 'test.note', version: '1', required: false, slots: [] }] },
    path: 'document.children.0.source.body', expected: 'safe\n',
    also: { 'document.children.0.fallback.0.type': 'paragraph' } },
}

const map = JSON.parse(readFileSync(join(import.meta.dirname, '../data/upgrade-map.json'), 'utf8')) as
  { tree: { id: string }[] }
assert.deepEqual(Object.keys(cases).sort(), map.tree.map((row) => row.id).sort())

for (const row of map.tree) {
  test(`${row.id}: ${row.id === 'T-034' ? 'zero start' : 'specified tree field change'}`, () => {
    const entry = cases[row.id]
    assert.ok(entry)
    const input = { type: 'document', astVersion: '1.2', children: entry.children ?? [], ...entry.root }
    const actual = migrateTree(input, entry.source === undefined ? {} : { source: entry.source })
    assert.deepEqual(at(actual, entry.path), entry.expected)
    for (const [path, expected] of Object.entries(entry.also ?? {})) assert.deepEqual(at(actual, path), expected)
  })
}

test('T-005: a raw reference that does not end in empty brackets stays full', () => {
  const input = { type: 'document', astVersion: '1.2', children: [
    paragraph({ type: 'link', key: 'r', rawRef: '[r][]suffix', children: [text('r')] }),
  ] }
  assert.equal(at(migrateTree(input), 'document.children.0.children.0.refForm'), 'full')
})

test('T-034: an authored start attribute of zero remains zero', () => {
  const input = { type: 'document', astVersion: '1.2', children: [
    { type: 'list', ordered: true, attrs: { keyValues: [['start', '0']] }, items: [item(paragraph(text('x')))] },
  ] }
  assert.equal(at(migrateTree(input), 'document.children.0.marker.start'), 0)
})

test('T-028: an input envelope receives the migrated document and matching version', () => {
  const extensions = [{ name: 'test.note', version: '1', required: false, slots: [] }]
  const input = { astVersion: '1.2', vocabulary: 'custom', extensions,
    document: { type: 'document', children: [paragraph(text('x'))] } }
  const output = migrateTree(input)
  assert.equal(at(output, 'envelope.astVersion'), '2.0')
  assert.equal(at(output, 'envelope.document'), output.document)
  assert.equal(at(output, 'envelope.vocabulary'), 'custom')
  assert.deepEqual(at(output, 'envelope.extensions'), extensions)
})
