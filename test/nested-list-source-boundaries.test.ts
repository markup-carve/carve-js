import { describe, expect, it } from 'vitest'
import { parse, toAstJson } from '../src/index.js'

function ast(source: string): any {
  return toAstJson(parse(source, { positions: true }))
}

function start(node: any, offset: number, line: number, column: number): void {
  expect(node.pos).toMatchObject({ startOffset: offset, startLine: line, startColumn: column })
}

describe('nested source boundaries', () => {
  it('places an ordered marker after a tab consumed by its parent', () => {
    const outer = ast('- outer\n\t1. a\n').children[0]
    const nested = outer.children[0].children[1]
    start(nested, 9, 2, 2)
    start(nested.children[0], 9, 2, 2)
    expect(outer.pos.startOffset).toBeLessThanOrEqual(nested.pos.startOffset)
    expect(outer.pos.endOffset).toBeGreaterThanOrEqual(nested.pos.endOffset)
  })

  it('places markers after quote prefixes and consumed tabs at both depths', () => {
    const quote = ast('> - outer\n> \t1. a\n').children[0]
    const nested = quote.children[0].children[0].children[1]
    start(nested, 13, 2, 4)
    start(nested.children[0], 13, 2, 4)

    const deep = ast('> - outer\n>   > \t1. a\n').children[0].children[0].children[0].children[1]
    start(deep.children[0], 17, 2, 8)
    start(deep.children[0].children[0], 17, 2, 8)
  })

  it('ends closerless lists and items at their last placed children', () => {
    const outer = ast('* [X] a\n\n\t\t- c d\n\n\t\ttail\n').children[0]
    const nested = outer.children[0].children[1]
    expect(nested.pos).toMatchObject({ endOffset: 16, endLine: 3, endColumn: 8 })
    expect(nested.children[0].pos).toMatchObject({ endOffset: 16, endLine: 3, endColumn: 8 })
    expect(outer.pos).toMatchObject({ endOffset: 24, endLine: 5, endColumn: 7 })
    expect(outer.children[0].pos).toMatchObject({ endOffset: 24, endLine: 5, endColumn: 7 })
  })

  it('keeps space indentation and projects a non-list opener through a tab', () => {
    const nested = ast('- outer\n  1. a\n').children[0].children[0].children[1]
    start(nested, 10, 2, 3)
    start(nested.children[0], 10, 2, 3)

    const heading = ast('> - outer\n> \t# head\n').children[0].children[0].children[0].children[1]
    start(heading, 13, 2, 4)
    expect(heading.pos).toMatchObject({ endOffset: 19, endLine: 2, endColumn: 10 })
  })

  it('keeps authored tabs in a list container opening span', () => {
    const root = ast('\t- a').children[0]
    start(root, 0, 1, 1)
    start(root.children[0], 0, 1, 1)

    const nested = ast('- a\n  \t- b').children[0].children[0].children[1]
    start(nested, 6, 2, 3)
    start(nested.children[0], 6, 2, 3)
  })
})
