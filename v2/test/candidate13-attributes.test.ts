import { expect, it } from 'vitest'
import { decodeTree, parse, render } from '../src/index.ts'

it('C2-A-035: a span keeps lowercase semantic and uppercase ordinary keys distinct', () => {
  const source = '[x]{KBD} and [y]{abbr="a" ABBR="b"}'
  const tree = parse(source)
  expect(tree.children[0]).toMatchObject({ type: 'paragraph', children: [
    { type: 'span', attrs: { keyValues: [['KBD', '']] } },
    { type: 'text', value: ' and ' },
    { type: 'span', attrs: { keyValues: [['abbr', 'a'], ['ABBR', 'b']] } },
  ] })
  expect(() => decodeTree(JSON.stringify(tree), source)).not.toThrow()
  expect(render(source)).toBe('<p><span KBD="">x</span> and <abbr title="a" ABBR="b">y</abbr></p>')
})
