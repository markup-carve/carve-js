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
