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
