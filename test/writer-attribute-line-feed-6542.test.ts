import { expect, it } from 'vitest'
import { parse, writeWithDiagnostics } from '../public/index.ts'
import { details } from '../public/extensions.ts'

// carve#6542: a value with a line feed is written with a space and reported; the node is kept (C2-W-050).
it('keeps a block extension whose attribute value holds a line feed', () => {
  const { extensions } = details()
  const tree = parse('{data-x=y}\n::: details "T"\nx\n:::\n', { extensions, positions: false })
  tree.children[0]!.attrs!.keyValues = [['data-x', 'a\nb']]
  const result = writeWithDiagnostics(tree, { extensions })
  expect(result.source).toBe('{data-x="a b"}\n::: details "T"\nx\n:::\n')
  expect(result.diagnostics.map((entry) => [entry.code, entry.path])).toEqual([['field-unspellable', '/children/0/attrs/keyValues/0/1']])
})

it('locates the value loss of a positioned node with its range (C2-W-103)', () => {
  const tree = parse('{title=t}\nx\n')
  tree.children[0]!.attrs!.keyValues = [['title', 'a\nb']]
  const result = writeWithDiagnostics(tree)
  expect(result.source).toBe('{title="a b"}\nx\n')
  expect(result.diagnostics).toHaveLength(1)
  expect(result.diagnostics[0]).toMatchObject({ code: 'field-unspellable', path: '/children/0/attrs/keyValues/0/1' })
  expect(result.diagnostics[0]!.range).toBeDefined()
})

it('reports no value of the attributes or slots that an extension written as its fallback does not write', () => {
  const paragraph = (text: string, title: string): unknown =>
    ({ type: 'paragraph', attrs: { keyValues: [['title', title]] }, children: [{ type: 'text', value: text }] })
  const tree = {
    type: 'document', astVersion: '2.0', extensions: [{ name: 'org.example.n', version: '1', required: false, slots: ['s'] }],
    children: [{ type: 'block_extension', name: 'org.example.n', version: '1', children: [], attrs: { keyValues: [['k', 'e\nf']] },
      slots: { s: [paragraph('in slot', 'a\nb')] }, fallback: [paragraph('a', 'c\nd')] }],
  } as unknown as Parameters<typeof writeWithDiagnostics>[0]
  const result = writeWithDiagnostics(tree)
  expect(result.source).toBe('{title="c d"}\na\n')
  expect(result.diagnostics.map((entry) => [entry.code, entry.path])).toEqual([
    ['structure-unspellable', '/children/0'], ['field-unspellable', '/children/0/fallback/0/attrs/keyValues/0/1'],
  ])
})

it('gives a node it leaves out only its node loss', () => {
  const tree = { type: 'document', astVersion: '2.0',
    children: [{ type: 'paragraph', attrs: { keyValues: [['title', 'a\nb']] }, children: [] }] } as unknown as Parameters<typeof writeWithDiagnostics>[0]
  expect(writeWithDiagnostics(tree).diagnostics.map((entry) => [entry.code, entry.path])).toEqual([['structure-unspellable', '/children/0']])
})
