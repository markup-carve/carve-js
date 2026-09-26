import { describe, expect, it } from 'vitest'
import { fromAstJson, renderCarve } from '../src/index.js'

// PART 11 §2: adjacent text nodes are written as one run, so where a tree
// splits text cannot decide which character carries an escape. The same shapes
// are pinned in carve-rs and carve-php.
const written = (inlines: string): string =>
  renderCarve(
    fromAstJson(JSON.parse(`{"type":"document","children":[{"type":"paragraph","children":[${inlines}]}],"srcByteLength":0}`)),
  )

describe('adjacent text is written as one run', () => {
  it.each([
    ['{"type":"text","value":"x (r"},{"type":"text","value":") y"}', 'x \\(r) y\n'],
    [
      '{"type":"text","value":"x "},{"type":"text","value":"("},{"type":"text","value":"r"},{"type":"text","value":")"},{"type":"text","value":" y"}',
      'x \\(r) y\n',
    ],
    ['{"type":"text","value":"x -"},{"type":"text","value":"- y"}', 'x \\-\\- y\n'],
  ])('%s', (inlines, expected) => {
    expect(written(inlines)).toBe(expected)
    expect(written(inlines.replaceAll('"},{"type":"text","value":"', ''))).toBe(expected)
  })

  it('writes a flattened ruby as the text it flattens to', () => {
    const ruby = '{"type":"ruby","pairs":[{"base":[{"type":"text","value":"["}],"annotation":[{"type":"text","value":"r"}]}]}'
    expect(written(`{"type":"span","attrs":{"classes":["c"]},"children":[${ruby}]}`)).toBe('[\\[\\(r)]{.c}\n')
    expect(written(`{"type":"span","attrs":{"classes":["c"]},"children":[{"type":"emphasis","children":[${ruby}]}]}`)).toBe(
      '[/\\[\\(r)/]{.c}\n',
    )
  })
})
