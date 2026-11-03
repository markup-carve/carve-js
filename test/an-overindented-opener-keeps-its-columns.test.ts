import { describe, expect, it } from 'vitest'
import { carveToAstJson } from '../src/index.js'

// The ownership walk strips an overindented opener's lead from the line; its
// offsets kept it, and its columns must too (PART 12 §4: columns and offsets
// name the same codepoint).
const lineStarts = (source: string): number[] => {
  const starts = [0]
  for (let i = 0; i < source.length; i++) if (source[i] === '\n') starts.push(i + 1)
  return starts
}

const disagreements = (source: string): string[] => {
  const starts = lineStarts(source)
  const out: string[] = []
  const visit = (node: unknown): void => {
    if (!node || typeof node !== 'object') return
    if (Array.isArray(node)) return node.forEach(visit)
    const record = node as Record<string, any>
    const p = record.pos
    if (p) {
      if (starts[p.startLine - 1]! + p.startColumn - 1 !== p.startOffset) out.push(`${record.type} start`)
      if (starts[p.endLine - 1]! + p.endColumn - 1 !== p.endOffset) out.push(`${record.type} end`)
    }
    for (const key of Object.keys(record)) if (key !== 'pos') visit(record[key])
  }
  visit(carveToAstJson(source))
  return out
}

describe('an overindented opener keeps its columns', () => {
  it('places an indented heading text at its own column', () => {
    const heading = (carveToAstJson('   # H\n') as any).children[0]
    expect(heading.pos).toMatchObject({ startColumn: 4, endColumn: 7, startOffset: 3, endOffset: 6 })
    expect(heading.children[0].pos).toMatchObject({ startColumn: 6, endColumn: 7, startOffset: 5, endOffset: 6 })
  })

  it.each([
    ['a heading', '  # h *x*\n'],
    ['a description list below an item', '- one\n :: term\n :  def\n'],
    ['a table below an item', '- one\n |= H |\n | x |\n'],
    ['a colon fence below an item', '- one\n ::: note\n b\n :::\n'],
    ['a table below an indented ordered item', '    1. y\n  | x |\n'],
    ['a folded definition', '- one\n  :: term\n :  def\n'],
  ])('agrees with its offsets in %s', (_name, source) => {
    expect(disagreements(source)).toEqual([])
  })
})
