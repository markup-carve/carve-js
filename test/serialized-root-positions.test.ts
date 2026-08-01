import { describe, it, expect } from 'vitest'
import { parse, toAstJson } from '../src/index.js'

/**
 * PART 12 §7 puts frontmatter and footnote definitions in the TREE, and §4
 * wants a position on every node but the root.
 *
 * `toAstJson` synthesizes both from data this engine keeps on the root, so
 * unless the parser records a span there is none to give - and they were the
 * only content in a serialized document that a consumer could not navigate to,
 * which is the exact thing §7's rationale rests on (carve-js#480).
 */
const source = '---\ntitle: x\n---\n\na[^r]\n\n[^r]: note body\n'

const slice = (pos: { startOffset: number; endOffset: number }): string =>
  [...source].slice(pos.startOffset, pos.endOffset).join('')

const serialized = (src = source): any => toAstJson(parse(src)) as any

describe('a serialized frontmatter node', () => {
  it('spans the fence and everything between', () => {
    const node = serialized().children[0]

    expect(node.type).toBe('frontmatter')
    expect(node.pos, 'frontmatter carries a position').toBeDefined()
    expect(slice(node.pos)).toBe('---\ntitle: x\n---')
  })

  it('keeps the info word on a typed fence', () => {
    const src = '---json\n{"a": 1}\n---\n\nbody\n'
    const node = toAstJson(parse(src)).children[0] as any

    expect(node.format).toBe('json')
    expect([...src].slice(node.pos.startOffset, node.pos.endOffset).join('')).toBe(
      '---json\n{"a": 1}\n---',
    )
  })
})

describe('a serialized footnote definition', () => {
  it('spans its marker and body, not just the body', () => {
    const node = serialized().children.find((c: any) => c.type === 'footnote')

    expect(node.pos, 'the definition carries a position').toBeDefined()
    // The body blocks cannot supply this: `[^r]:` is not part of any of them,
    // so a span taken from the body would start inside the definition.
    expect(slice(node.pos)).toBe('[^r]: note body')
  })

  it('places a definition that continues onto another line', () => {
    const src = 'a[^r]\n\n[^r]: first\n  second\n'
    const node = (toAstJson(parse(src)).children as any[]).find((c) => c.type === 'footnote')

    expect([...src].slice(node.pos.startOffset, node.pos.endOffset).join('')).toBe(
      '[^r]: first\n  second',
    )
  })
})

describe('what the root carries', () => {
  it('is exactly three fields', () => {
    expect(Object.keys(serialized()).sort()).toEqual(['children', 'srcByteLength', 'type'])
  })

  it('leaves the parse tree alone', () => {
    // §1 lets an engine keep its internals; the mapping happens on the way out.
    // Asserted so a later change does not turn a serialization rule into a
    // parser change without someone deciding to.
    const doc = parse(source) as any
    expect(doc.frontmatter).toBeDefined()
    expect(doc.footnoteDefs).toBeDefined()
  })
})
