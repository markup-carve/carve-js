import { readFileSync } from 'node:fs'
import { describe, it, expect } from 'vitest'
import { parse, toAstJson } from '../src/index.js'

type Node = {
  type: string
  pos?: {
    startOffset: number
    endOffset: number
    startLine: number
    endLine: number
    startColumn: number
    endColumn: number
  }
  children?: Node[]
  items?: Node[]
}

const termBreaks = (root: unknown) => {
  const breaks: Array<{ node: Node; prev?: Node; next?: Node }> = []
  const walk = (node: Node, inTerm = false, siblings: Node[] = [], index = 0): void => {
    inTerm ||= node.type === 'definition_term'
    if (inTerm && node.type === 'soft_break') {
      breaks.push({ node, prev: siblings[index - 1], next: siblings[index + 1] })
    }
    for (const key of ['children', 'items'] as const) {
      node[key]?.forEach((child, i, children) => walk(child, inTerm, children, i))
    }
  }
  walk(root as Node)
  return breaks
}

const expectBoundarySlice = (source: string, node: Node) => {
  expect(node.pos).toBeDefined()
  const span = source.slice(node.pos!.startOffset, node.pos!.endOffset)
  expect(span).toMatch(/^[\s>]*$/)
  expect(span.match(/\n/g)).toHaveLength(1)
}

const cases: Array<[string, string[]]> = [
  ['', ['4-7, 1:5-2:3', '14-15, 2:10-3:1']],
  ['-2', ['6-11, 1:7-2:5', '18-21, 2:12-3:3']],
  ['-3', ['14-19, 3:7-4:5', '26-29, 4:12-5:3']],
  ['-4', ['15-20, 3:7-4:5', '27-30, 4:12-5:3']],
  ['-5', ['4-7, 1:5-2:3', '25-26, 4:6-5:1']],
  ['-6', ['6-11, 1:7-2:5', '33-36, 4:8-5:3']],
  ['-7', ['14-19, 3:7-4:5', '41-44, 6:8-7:3']],
  ['-8', ['15-20, 3:7-4:5', '42-45, 6:8-7:3']],
  ['-9', ['12-13, 3:5-4:1']],
  ['-10', ['14-17, 3:7-4:3']],
  ['-11', ['22-25, 5:7-6:3']],
  ['-12', ['23-26, 5:7-6:3']],
  ['-13', ['11-12, 3:5-4:1']],
  ['-14', ['13-16, 3:7-4:3']],
  ['-15', ['21-24, 5:7-6:3']],
  ['-16', ['22-25, 5:7-6:3']],
  ['-17', []],
  ['-18', []],
  ['-19', []],
  ['-20', []],
  ['-21', []],
  ['-22', ['23-28, 5:7-6:5', '51-54, 9:8-10:3']],
  ['-23', ['6-9, 1:7-2:3']],
  ['-24', ['13-18, 3:7-4:5', '25-28, 4:12-5:3']],
  ['-25', ['23-26, 5:7-6:3', '34-37, 6:11-7:3']],
]

describe('a folded term\'s part-boundary break is placed', () => {
  it.each(cases)('places corpus 504%s breaks without moving existing spans', (suffix, expected) => {
    const source = readFileSync(new URL(
      `../spec/tests/corpus/504-a-comment-or-a-definition-under-a-definition-term-folds-at-every-depth${suffix}.crv`,
      import.meta.url,
    ), 'utf8')
    const breaks = termBreaks(toAstJson(parse(source)))
    expect(breaks.map(({ node }) => {
      expectBoundarySlice(source, node)
      const p = node.pos!
      return `${p.startOffset}-${p.endOffset}, ${p.startLine}:${p.startColumn}-${p.endLine}:${p.endColumn}`
    })).toEqual(expected)
  })

  it('derives consecutive comment boundaries from their neighbours', () => {
    const source = ':: c\n  %% a\n  %% b\n  more\n'
    const breaks = termBreaks(toAstJson(parse(source)))
    expect(breaks).toHaveLength(3)
    for (const { node, prev, next } of breaks) {
      expect(prev?.pos).toBeDefined()
      expect(next?.pos).toBeDefined()
      expect(node.pos).toEqual({
        startOffset: prev!.pos!.endOffset,
        endOffset: next!.pos!.startOffset,
        startLine: prev!.pos!.endLine,
        endLine: next!.pos!.startLine,
        startColumn: prev!.pos!.endColumn,
        endColumn: next!.pos!.startColumn,
      })
      expectBoundarySlice(source, node)
    }
  })
})
