import { describe, it, expect } from 'vitest'
import { parse, MAX_NESTING_DEPTH } from '../src/parse.js'
import { toAstJson, fromAstJson, AstJsonError } from '../src/ast-json.js'

/**
 * Shapes at the PARSER's own nesting cap. The point of each is how many WIRE
 * levels one nesting level costs, which is not the same for every container:
 * a blockquote costs two, a list costs four (`list`, `items`, `list_item`,
 * `children`). Assuming one ratio for all of them is how carve-rs came to
 * reject its own output (markup-carve/carve-rs#389), so the decoder is checked
 * against every shape rather than the convenient one.
 */
const SHAPES: Record<string, string> = {
  blockquotes: '> '.repeat(MAX_NESTING_DEPTH) + 'x\n',
  'list ladder':
    Array.from({ length: MAX_NESTING_DEPTH }, (_, i) => '  '.repeat(i) + '- x').join('\n') + '\n',
  'table under blockquotes': '> '.repeat(MAX_NESTING_DEPTH) + '| a |\n',
  'div ladder':
    Array.from({ length: MAX_NESTING_DEPTH }, (_, i) => ':'.repeat(3 + i)).join('\n') +
    '\nx\n' +
    Array.from({ length: MAX_NESTING_DEPTH }, (_, i) => ':'.repeat(3 + MAX_NESTING_DEPTH - 1 - i)).join(
      '\n',
    ) +
    '\n',
}

describe('fromAstJson ingest depth (carve-js#498)', () => {
  for (const [shape, source] of Object.entries(SHAPES)) {
    it(`accepts what toAstJson produced at the parser's cap: ${shape}`, () => {
      const json = toAstJson(parse(source))
      const decoded = fromAstJson(json)
      // Byte-identical, not merely "did not throw": a cap that truncated the
      // tree instead of refusing it would pass the weaker check.
      expect(JSON.stringify(toAstJson(decoded))).toBe(JSON.stringify(json))
    })
  }

  it('refuses deeper input with a typed error instead of a RangeError', () => {
    let node: unknown = { type: 'paragraph', children: [] }
    for (let i = 0; i < 5000; i++) node = { type: 'div', children: [node] }

    let thrown: unknown
    try {
      fromAstJson({ type: 'document', children: [node] } as never)
    } catch (error) {
      thrown = error
    }
    expect(thrown).toBeInstanceOf(AstJsonError)
    // The old behavior. A RangeError says nothing about the payload and cannot
    // be told apart from a bug in the caller.
    expect(thrown).not.toBeInstanceOf(RangeError)
  })

  it('refuses a payload of nothing but nested arrays', () => {
    // No node in it at all, so a guard counting NODE depth would walk the whole
    // thing and hit the same stack it was added to protect.
    let arrays: unknown = []
    for (let i = 0; i < 5000; i++) arrays = [arrays]

    expect(() => fromAstJson({ type: 'document', children: arrays } as never)).toThrow(AstJsonError)
  })

  it('leaves an ordinary document alone', () => {
    const json = toAstJson(parse('# H\n\n> quoted\n\n- a\n- b\n'))
    expect(JSON.stringify(toAstJson(fromAstJson(json)))).toBe(JSON.stringify(json))
  })
})
