import { expect, it } from 'vitest'
import { carveToAstJson } from '../src/index.js'

it.each([
  ['- \t> a\n', '> a'],
  ['- \t# h\n', '# h'],
  ['- \t:: t\n', ':: t'],
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
            pos: { startLine: 1, endLine: 1, startColumn: 4, endColumn: 4 + value.length,
              startOffset: 3, endOffset: 3 + value.length },
          }],
        }],
      }],
    }],
  })
})
