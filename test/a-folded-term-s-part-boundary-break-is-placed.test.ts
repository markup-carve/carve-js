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
  ['', []],
  ['-2', []],
  ['-3', []],
  ['-4', []],
  ['-5', []],
  ['-6', []],
  ['-7', []],
  ['-8', []],
  ['-9', []],
  ['-10', []],
  ['-11', []],
  ['-12', []],
  ['-13', []],
  ['-14', []],
  ['-15', []],
  ['-16', []],
  ['-17', []],
  ['-18', []],
  ['-19', []],
  ['-20', []],
  ['-21', []],
  ['-22', []],
  ['-23', []],
  ['-24', []],
  ['-25', []],
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
    expect(breaks).toHaveLength(0)
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
