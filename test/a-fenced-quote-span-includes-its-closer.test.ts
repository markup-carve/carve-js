import { describe, expect, it } from 'vitest'
import { carveToAstJson } from '../src/index.js'

type Node = { type?: string; pos?: { startOffset?: number; endOffset?: number; endLine?: number; endColumn?: number }; [key: string]: unknown }

function nodes(source: string, type: string): Node[] {
  const found: Node[] = []
  function walk(value: unknown): void {
    if (!value || typeof value !== 'object') return
    if (Array.isArray(value)) return value.forEach(walk)
    const node = value as Node
    if (node.type === type) found.push(node)
    for (const [key, child] of Object.entries(node)) if (key !== 'pos') walk(child)
  }
  walk(carveToAstJson(source))
  return found
}

function span(source: string, type = 'block_quote'): string {
  const found = nodes(source, type)
  expect(found).toHaveLength(1)
  return source.slice(found[0]!.pos!.startOffset, found[0]!.pos!.endOffset)
}

describe('CARVE-P12-014: a fenced quote owns its explicit closer', () => {
  for (const body of ['hello', '%% comment', '', '[r]: /url']) {
    it(`includes the closer with body ${JSON.stringify(body)}`, () => {
      const source = `::: >\n${body}\n:::\n\nnext\n`
      expect(span(source)).toBe(`::: >\n${body}\n:::`)
      expect(nodes(source, 'block_quote')[0]!.pos).toMatchObject({ endLine: 3, endColumn: 4 })
    })
  }

  it('includes a wider closer', () => {
    expect(span(':::: >\nhello\n::::\n')).toBe(':::: >\nhello\n::::')
  })

  it('keeps the caption outside the quote target span', () => {
    const source = '::: >\nhello\n:::\n^ caption\n'
    expect(span(source)).toBe('::: >\nhello\n:::')
    expect(span(source, 'figure')).toBe(source.trimEnd())
  })

  it('carries the closer into an enclosing footnote span', () => {
    const source = '[^n]: intro\n\n   ::: >\n   > quote\n   :::\n\nsee[^n]\n'
    const end = source.indexOf('\n\nsee')
    expect(nodes(source, 'block_quote')[0]!.pos!.endOffset).toBe(end)
    expect(nodes(source, 'footnote')[0]!.pos!.endOffset).toBe(end)
  })

  it('keeps nested closers with their own quotes', () => {
    const source = '::: >\n::: >\nhello\n:::\n:::\n'
    const quotes = nodes(source, 'block_quote')
    expect(quotes).toHaveLength(2)
    expect(quotes.map(q => source.slice(q.pos!.startOffset, q.pos!.endOffset))).toEqual([
      source.trimEnd(), '::: >\nhello\n:::',
    ])
  })

  it('keeps marker quotes at their last child', () => {
    expect(span('> hello\n> [r]: /url\n')).toBe('> hello')
  })

  it('keeps an unterminated quote at its last child', () => {
    expect(span('::: >\nhello\n\n{.unused}\n')).toBe('::: >\nhello')
  })
})
