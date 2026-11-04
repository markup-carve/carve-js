import { describe, expect, it } from 'vitest'
import { parse, toAstJson } from '../src/index.js'

describe('authored-base list source spans', () => {
  it('starts list containers at the footnote body column', () => {
    const source = 'See[^1].\n\n[^1]: a\n\n\n    - b\n'
    const ast = toAstJson(parse(source, { positions: true })) as any
    const list = ast.children[1].children[1]

    expect(list.type).toBe('list')
    expect(list.pos).toMatchObject({ startLine: 6, startColumn: 3, startOffset: 22 })
    expect(list.items[0].pos).toMatchObject({ startLine: 6, startColumn: 3, startOffset: 22 })
    expect(list.items[0].children[0].pos).toMatchObject({
      startLine: 6,
      startColumn: 7,
      startOffset: 26,
    })
  })

  it('counts a residual tab as one source codepoint', () => {
    const source = 'See[^1].\n\n[^1]: a\n\n\n  \t- b\n'
    const ast = toAstJson(parse(source, { positions: true })) as any
    const list = ast.children[1].children[1]

    expect(list.pos).toMatchObject({ startLine: 6, startColumn: 3, startOffset: 22 })
    expect(list.items[0].pos).toMatchObject({ startLine: 6, startColumn: 3, startOffset: 22 })
  })
})
