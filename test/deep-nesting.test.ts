import { describe, it, expect } from 'vitest'
import { parse, carveToHtml } from '../src/index.js'

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
    while (node && node.type === 'blockquote') {
      depth++
      node = node.children?.[0]
    }
    expect(depth).toBe(3)
  })
})
