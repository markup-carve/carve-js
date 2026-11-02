import { describe, expect, it } from 'vitest'
import { carveToHtml, parse } from '../src/index.js'

const commentsOf = (src: string): Array<{ block: boolean; content: string; start: string; end: string }> => {
  const found: Array<{ block: boolean; content: string; start: string; end: string }> = []
  const walk = (value: unknown): void => {
    if (Array.isArray(value)) value.forEach(walk)
    else if (typeof value === 'object' && value !== null) {
      const node = value as Record<string, unknown>
      if (node.type === 'comment') {
        const pos = node.pos as { startLine: number; startColumn: number; endLine: number; endColumn: number }
        found.push({ block: node.block as boolean, content: node.content as string, start: `${pos.startLine}:${pos.startColumn}`, end: `${pos.endLine}:${pos.endColumn}` })
      }
      for (const [key, child] of Object.entries(node)) if (key !== 'pos') walk(child)
    }
  }
  walk(parse(src))
  return found
}

describe('a comment fence a + skips (carve-js#4173)', () => {
  it('is one block comment over its own lines in an item', () => {
    expect(commentsOf('- +\n%%%\nc\n%%%\ntext\n')).toEqual([{ block: true, content: 'c', start: '2:1', end: '4:4' }])
    expect(carveToHtml('- +\n%%%\nc\n%%%\ntext\n')).toBe('<ul>\n  <li>text</li>\n</ul>')
  })

  it('keeps a quote prefix out of the body and the span', () => {
    expect(commentsOf('> - +\n> %%%\n> c\n> %%%\n> text\n')).toEqual([{ block: true, content: 'c', start: '2:3', end: '4:6' }])
  })

  it('keeps the opener tail, blank lines and a longer closer', () => {
    expect(commentsOf('- +\n%%%% t\na\n\nb\n%%%%\ntext\n')).toEqual([{ block: true, content: 't\na\n\nb', start: '2:1', end: '6:5' }])
  })

  it('keeps an opener tail of content whitespace', () => {
    expect(commentsOf('- +\n%%% \u00a0\nx\n%%%\ntext\n')[0]!.content).toBe('\u00a0\nx')
  })

  it('leaves a skipped line comment a line comment', () => {
    expect(commentsOf('- +\n%% c\ntext\n')).toEqual([{ block: false, content: 'c', start: '2:1', end: '2:5' }])
  })
})
