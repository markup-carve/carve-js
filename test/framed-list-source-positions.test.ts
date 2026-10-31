import { expect, it } from 'vitest'
import { carveToAstJson } from '../src/index.js'

it.each([
  ['- \t> a\n', '\t> a'],
  ['- \t# h\n', '\t# h'],
  ['- \t:: t\n', '\t:: t'],
])('places framed list text at its source offset: %s', (source, value) => {
  expect(carveToAstJson(source)).toMatchObject({
    children: [{
      type: 'list',
      items: [{
        type: 'list_item',
        children: [{
          type: 'paragraph',
          children: [{
            type: 'text',
            value,
            pos: { startLine: 1, endLine: 1, startColumn: 3, endColumn: 3 + value.length,
              startOffset: 2, endOffset: 2 + value.length },
          }],
        }],
      }],
    }],
  })
})
