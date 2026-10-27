import { expect, it } from 'vitest'
import { parse, resolve, toAstJson } from '../src/index.js'

it.each([
  ['![x](x)', false],
  ['![x][r]\n\n[r]: x', false],
  ['- [ ] ![x](x)', true],
])('publishes promoted images in block-image paragraphs: %s', (source, inList) => {
  const first = toAstJson(resolve(parse(source))).children[0]!
  const node = inList && first.type === 'list' ? first.items[0]!.children[0] : first
  expect(node).toMatchObject({
    type: 'paragraph', blockImage: true,
    children: [{ type: 'image', src: 'x', alt: 'x' }],
  })
})
