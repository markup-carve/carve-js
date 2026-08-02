import { describe, it, expect } from 'vitest'
import {
  AstJsonDepthError,
  carveToCarve,
  carveToHtml,
  fromAstJson,
  parse,
  renderCarve,
  type AstJsonBlock,
} from '../src/index.js'

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

describe('the reader refuses a payload deeper than the parser can produce', () => {
  it('throws a typed error rather than exhausting the stack', () => {
    // The guard's contract, from the direction the writer test used to cover by
    // accident: a payload this deep cannot round trip anyway, because the
    // renderers stop at MAX_RENDER_DEPTH and drop everything below it.
    let node: AstJsonBlock = { type: 'div', children: [{ type: 'paragraph', children: [{ type: 'text', text: 'x' }] }] }
    for (let i = 0; i < 1000; i++) node = { type: 'div', children: [node] }

    expect(() => fromAstJson({ type: 'doc', children: [node] })).toThrow(AstJsonDepthError)
  })

  it('accepts a payload at the cap', () => {
    // The boundary matters: a cap that rejected its own maximum would make the
    // parser's deepest output unreadable, which is the defect carve-rs#389 was.
    let node: AstJsonBlock = { type: 'div', children: [{ type: 'paragraph', children: [{ type: 'text', text: 'x' }] }] }
    for (let i = 0; i < 300; i++) node = { type: 'div', children: [node] }

    expect(() => fromAstJson({ type: 'doc', children: [node] })).not.toThrow()
  })
})

describe('the canonical writer respects the render depth cap', () => {
  it('does not size a fence from containers past MAX_RENDER_DEPTH', () => {
    // A hand-built AST (an --from-json document) can nest past the depth the
    // parser allows. renderBlock emits nothing past MAX_RENDER_DEPTH, so
    // counting those levels would emit a fence sized for output that never
    // appears.
    //
    // 300 sits deliberately between the two caps: above MAX_RENDER_DEPTH, so
    // the writer's cap is exercised, and below MAX_AST_JSON_DEPTH, so the
    // reader accepts the payload. It used to be 1000, which the reader now
    // rejects outright - see the case below, which pins that rejection.
    let node: AstJsonBlock = { type: 'div', children: [{ type: 'paragraph', children: [{ type: 'text', text: 'x' }] }] }
    for (let i = 0; i < 300; i++) node = { type: 'div', children: [node] }
    const doc = fromAstJson({ type: 'doc', children: [node] })

    const started = Date.now()
    const formatted = renderCarve(doc)
    expect(Date.now() - started).toBeLessThan(5000)
    const widest = Math.max(...formatted.split('\n').map((line) => (/^:+$/.test(line) ? line.length : 0)))
    expect(widest).toBeLessThanOrEqual(202)
  })
})
