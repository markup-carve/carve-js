import { describe, it, expect } from 'vitest'
import { parse, carveToHtml, carveToCarve, renderCarve } from '../src/index.js'
import type { BlockNode, Document } from '../src/ast.js'

// Regression guard: deeply nested block containers must not overflow the call
// stack. Each `>` level recurses parseBlocks -> parseBlock -> parseBlockQuote,
// so thousands of levels used to throw "Maximum call stack size exceeded".
// MAX_NESTING_DEPTH caps the recursion and degrades to literal text past it.

describe('deep nesting does not overflow the stack', () => {
  it('parses thousands of nested blockquotes without throwing', () => {
    for (const depth of [2000, 5000, 20000]) {
      const src = '> '.repeat(depth) + 'x'
      expect(() => parse(src)).not.toThrow()
    }
  })

  it('parses deeply nested divs without throwing', () => {
    const src = ':::\n'.repeat(5000) + 'x\n' + ':::\n'.repeat(5000)
    expect(() => parse(src)).not.toThrow()
  })

  it('still nests modest blockquote depth correctly', () => {
    expect(carveToHtml('> > a')).toBe(
      '<blockquote>\n  <blockquote><p>a</p></blockquote>\n</blockquote>',
    )

    let node = parse('> > > x').children[0]
    let depth = 0
    while (node && node.type === 'block_quote') {
      depth++
      node = node.children?.[0]
    }
    expect(depth).toBe(3)
  })
})

describe('the canonical writer survives deep container nesting', () => {
  it('keeps 40 nested containers nested across a fmt pass', () => {
    // Equal-length fences do not nest, so real depth needs a widening fence per
    // level: the writer has to reproduce that ladder, not a fixed `::::`.
    const depth = 40
    const width = (level: number) => ':'.repeat(depth + 2 - level)
    let src = ''
    for (let level = 0; level < depth; level++) src += width(level) + '\n'
    src += 'x\n'
    for (let level = depth - 1; level >= 0; level--) src += width(level) + '\n'

    const containerDepth = (source: string) => {
      let node = parse(source).children[0]
      let seen = 0
      while (node && (node.type === 'div' || node.type === 'admonition')) {
        seen++
        node = node.children?.[0]
      }
      return seen
    }
    expect(containerDepth(src)).toBe(depth)

    const formatted = carveToCarve(src)
    expect(containerDepth(formatted)).toBe(depth)
    expect(carveToHtml(formatted)).toBe(carveToHtml(src))
    expect(carveToCarve(formatted)).toBe(formatted)
  })
})

describe('the canonical writer respects the render depth cap', () => {
  it('does not size a fence from containers past MAX_RENDER_DEPTH', () => {
    // A hand-built AST can nest far past the depth the parser allows.
    // renderBlock emits nothing past the cap, so counting those levels would
    // emit a fence sized for output that never appears.
    //
    // Built directly rather than through `fromAstJson`: the subject here is the
    // WRITER, and ingest now refuses a payload this deep on purpose, since
    // nothing that nests past the parser's cap can round trip (carve-js#498).
    // Laundering the fixture through the decoder would test the decoder's cap
    // instead of the writer's.
    let node: BlockNode = {
      type: 'div',
      children: [{ type: 'paragraph', children: [{ type: 'text', text: 'x' }] }],
    } as BlockNode
    for (let i = 0; i < 1000; i++) node = { type: 'div', children: [node] } as BlockNode
    const doc: Document = { type: 'document', children: [node] }

    const started = Date.now()
    const formatted = renderCarve(doc)
    expect(Date.now() - started).toBeLessThan(5000)
    const widest = Math.max(...formatted.split('\n').map((line) => (/^:+$/.test(line) ? line.length : 0)))
    expect(widest).toBeLessThanOrEqual(202)
  })
})
