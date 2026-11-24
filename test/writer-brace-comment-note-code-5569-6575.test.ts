import { expect, it } from 'vitest'
import { format, parse, treesEqual, write } from '../src/index.ts'
import type { DocumentNode } from '../src/ast-nodes.ts'

// [ticket, source, canonical form]: the Expected sections of carve-js#5569 and markup-carve/carve#6575.
const cases: readonly [string, string, string][] = [
  ['carve-js#5569', '\\{#\n#}\n{\n', '\\{#\n#}\n{\n'],
  ['carve-js#5569', '\\{#\n#}\n{a\n', '\\{#\n#}\n{a\n'],
  ['carve-js#5569', '\\{%\n%}\n{a\n', '\\{%\n%}\n{a\n'],
  ['carve#6575', '^[\\` ];`\n', '^[\\` ];\\`\n'],
  ['carve#6575', '^[\\`^]`\n', '^[\\`^]\\`\n'],
  ['carve#6575', '``a[\\`a]()a`\n', '\\`\\`a[\\`a]()a\\`\n'],
]

it.each(cases)('%s: %j is written %j and reads back', (_ticket, source, expected) => {
  const written = format(source)
  expect(written).toBe(expected)
  expect(treesEqual(parse(written), parse(source))).toBe(true)
  expect(format(written)).toBe(written)
})

it('carve#6559: a bare {#id} that reads as an attribute block still reports the kind {', () => {
  const tree: DocumentNode = {
    type: 'document', astVersion: '2.0', children: [{
      type: 'paragraph',
      children: [{ type: 'emphasis', children: [{ type: 'text', value: 'a' }] }, { type: 'text', value: '{#i} {x' }],
    }],
  }
  const written = write(tree)
  expect(written).toBe('/a/\\{\\#i} \\{x\n')
  expect(treesEqual(parse(written), tree)).toBe(true)
})
