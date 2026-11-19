// T-007: every attribute record the 0.1 schema allows migrates to the 2.0 list of pairs and validates.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { validateTree } from '../src/index.ts'
import { WIRE_NESTED_RECORDS, WIRE_REQUIRED, WIRE_VALUE_KINDS } from '../upgrade/engine-0.1/ast/wire-fields.ts'
import { migrateTree } from './index.ts'

type Node = Record<string, unknown>

const carriers = Object.entries(WIRE_NESTED_RECORDS).flatMap(([owner, fields]) =>
  Object.entries(fields).filter(([, record]) => record.record === 'attrs').map(([field]) => `${owner}.${field}`))

const variants: Node[] = [
  { keyValues: { foo: 'bar' }, order: ['foo'] },
  { keyValues: { foo: 'bar' } },
  { id: 'i', classes: ['c'], keyValues: { foo: 'bar' }, order: ['foo'] },
  { keyValues: { id: 'i', class: 'c', foo: 'bar' }, order: ['id', 'class', 'foo'] },
  { keyValues: { zed: 'z', foo: 'bar' }, order: ['foo', 'zed'] },
]

const overrides: Record<string, Node> = { smart_punctuation: { kind: 'ellipsis', value: '...' }, block_extension: { name: 'acme.x', version: '1' } }

function value(kind: string): unknown {
  if (kind.startsWith('const:')) return JSON.parse(kind.slice('const:'.length))
  if (kind.startsWith('enum:')) return kind.slice('enum:'.length).split('\u0000')[0]
  if (kind.startsWith('string')) return 'x'
  if (kind.startsWith('integer')) return 1
  if (kind === 'boolean') return false
  if (kind === 'array') return []
  if (kind === 'node') return { type: 'paragraph', children: [{ type: 'text', value: 'f' }] }
  return {}
}

function build(type: string, attrs: Node): Node {
  const node: Node = { type }
  for (const field of WIRE_REQUIRED[type] ?? []) if (field !== 'type') node[field] = value(WIRE_VALUE_KINDS[type]?.[field] ?? 'string')
  return { ...node, ...overrides[type], attrs }
}

const text = (value: string): Node => ({ type: 'text', value })
const cell = (attrs?: Node): Node => ({ type: 'table_cell', header: false, children: [text('a')], ...(attrs && { attrs }) })
const row = (attrs?: Node, cellAttrs?: Node): Node => ({ type: 'table_row', cells: [cell(cellAttrs)], ...(attrs && { attrs }) })

function groupedTable(field: string, attrs: Node): Node {
  const rowGroups: Node = { headRows: 1, bodies: [{ headRows: 0, bodyRows: 1 }], footRows: 1 }
  if (field === 'headAttrs' || field === 'footAttrs') rowGroups[field] = attrs
  else rowGroups['bodies'] = [{ headRows: 0, bodyRows: 1, attrs }]
  return { type: 'table', rowGroups, rows: [row(), row(), row()] }
}

/** The 0.1 trees that hold `carrier` with `attrs`, one per position its type can take. */
function hosts(carrier: string, attrs: Node): Node[][] {
  const [owner = '', ...rest] = carrier.split('.')
  const field = rest[rest.length - 1] ?? ''
  if (owner === 'table' && rest.length > 1) return [[groupedTable(field, attrs)]]
  switch (owner) {
    case 'list_item': return [[{ type: 'list', ordered: false, tight: true, items: [{ ...build(owner, attrs), children: [{ type: 'paragraph', children: [text('a')] }] }] }]]
    case 'definition_term':
    case 'definition_description': return [[{ type: 'definition_list', items: [
      owner === 'definition_term' ? build(owner, attrs) : { type: 'definition_term', children: [text('t')] },
      owner === 'definition_description' ? build(owner, attrs) : { type: 'definition_description', children: [] }] }]]
    case 'table_row': return [[{ type: 'table', rows: [row(attrs)] }]]
    case 'table_cell': return [[{ type: 'table', rows: [row(undefined, attrs)] }]]
    default: return [[build(owner, attrs)], [{ type: 'paragraph', children: [build(owner, attrs)] }]]
  }
}

function attributeRecords(value: unknown, found: Node[] = []): Node[] {
  if (Array.isArray(value)) for (const item of value) attributeRecords(item, found)
  else if (value !== null && typeof value === 'object') {
    const record = value as Node
    if (record['attrs'] !== null && typeof record['attrs'] === 'object') found.push(record['attrs'] as Node)
    for (const item of Object.values(record)) attributeRecords(item, found)
  }
  return found
}

function migrates(children: Node[]): { error?: string, records?: Node[], losses?: string[] } {
  try {
    const result = migrateTree({ type: 'document', astVersion: '1.2', children: structuredClone(children) })
    validateTree(result.document)
    const losses = result.diagnostics.filter((entry) => entry.code === 'migration-loss').map((entry) => entry.path ?? '')
    return { records: attributeRecords(result.document), losses }
  } catch (error) {
    return { error: (error as Error).message }
  }
}

test('T-007: the 0.1 schema names the table group attributes among its attribute carriers', () => {
  assert.ok(carriers.includes('table.rowGroups.headAttrs'))
  assert.ok(carriers.includes('table.rowGroups.footAttrs'))
  assert.ok(carriers.includes('table.rowGroups.bodies.attrs'))
  assert.ok(carriers.length >= 60, `${carriers.length} carriers`)
})

function problem(children: Node[]): string | undefined {
  const outcome = migrates(children)
  if (outcome.error !== undefined) return outcome.error
  const records = outcome.records ?? []
  if (records.some((record) => record['keyValues'] !== undefined && !Array.isArray(record['keyValues']))) return 'keyValues is not a list'
  const pairs = records.flatMap((record) => Array.isArray(record['keyValues']) ? record['keyValues'] : [])
  const reported = (outcome.losses ?? []).some((path) => path.endsWith('/attrs'))
  if (!reported && !pairs.some((pair) => Array.isArray(pair) && pair[0] === 'foo' && pair[1] === 'bar')) return 'the foo pair is gone unreported'
  return undefined
}

test('T-007: every 0.1 attribute carrier migrates to a list of pairs that validates', () => {
  const failures: string[] = []
  let count = 0
  for (const carrier of carriers) {
    for (const attrs of variants) {
      count++
      // A type stands either as a block or inline; the carrier passes in the position the 2.0 tree accepts.
      const problems = hosts(carrier, attrs).map(problem)
      if (problems.every((entry) => entry !== undefined)) failures.push(`${carrier} ${JSON.stringify(attrs)}: ${problems.join(' | ')}`)
    }
  }
  assert.deepEqual(failures, [])
  assert.equal(count, carriers.length * variants.length)
})

test('T-007: the body attributes of the carve-js#5080 reproduction become a list in order', () => {
  const result = migrateTree({ type: 'document', children: [{ type: 'table',
    rowGroups: { headRows: 0, bodies: [{ headRows: 0, bodyRows: 1, attrs: { keyValues: { foo: 'bar' } } }], footRows: 0 },
    rows: [row()] }] })
  validateTree(result.document)
  const body = (result.document.children[0] as unknown as { children: Node[] }).children[0]
  assert.deepEqual(body?.['attrs'], { keyValues: [['foo', 'bar']] })
})

test('T-001: the attributes of a split substitution are a reported loss', () => {
  const result = migrateTree({ type: 'document', astVersion: '1.2', children: [{ type: 'paragraph', children: [
    { type: 'substitution', old: 'a', new: 'b', attrs: { keyValues: { foo: 'bar' } } }] }] })
  validateTree(result.document)
  assert.deepEqual(result.diagnostics.map((entry) => `${entry.code} ${entry.path ?? ''}`), ['migration-loss /children/0/children/0/attrs'])
})
