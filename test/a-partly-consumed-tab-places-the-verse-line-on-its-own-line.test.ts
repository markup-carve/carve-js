import { describe, expect, it } from 'vitest'
import { carveToAstJson } from '../src/index.js'

function verseStarts(source: string): unknown[] {
  const starts: unknown[] = []
  function visit(value: unknown, inVerse = false): void {
    if (Array.isArray(value)) {
      value.forEach((child) => visit(child, inVerse))
    } else if (value !== null && typeof value === 'object') {
      const node = value as Record<string, unknown>
      if (inVerse && ['paragraph', 'non_breaking_space', 'text'].includes(node.type as string)) {
        const pos = node.pos as Record<string, number> | undefined
        starts.push([node.type, pos && [pos.startLine, pos.startColumn, pos.startOffset]])
      }
      if (node.children) visit(node.children, inVerse || node.type === 'line_block')
      if (node.items) visit(node.items, inVerse)
    }
  }
  visit(carveToAstJson(source))
  return starts
}

describe('a partly consumed tab places the verse line on its own line', () => {
  const source = '- a\n\n  ::: |\n\t  x\n  :::\n'

  it('leaves the generated gap unplaced and anchors the paragraph to the tab', () => {
    const starts = verseStarts(source)
    expect(starts).toEqual([
      ['paragraph', [4, 1, 13]],
      ['non_breaking_space', undefined],
      ['non_breaking_space', [4, 1, 13]],
      ['non_breaking_space', [4, 2, 14]],
      ['non_breaking_space', [4, 3, 15]],
      ['text', [4, 4, 16]],
    ])
    expect(starts.filter((entry) => {
      const [type, pos] = entry as [string, unknown]
      return type === 'non_breaking_space' && pos === undefined
    })).toHaveLength(1)
  })

  it('keeps every published start consistent with its line and codepoint column', () => {
    const lines = source.split('\n')
    let textCount = 0
    function visit(value: unknown): void {
      if (Array.isArray(value)) {
        value.forEach(visit)
      } else if (value !== null && typeof value === 'object') {
        const node = value as Record<string, unknown>
        const pos = node.pos as Record<string, number> | undefined
        if (pos) {
          expect(pos.startColumn).toBeGreaterThanOrEqual(1)
          const lineOffset = lines.slice(0, pos.startLine - 1).reduce((offset, line) => offset + line.length + 1, 0)
          const columnOffset = Array.from(lines[pos.startLine - 1]).slice(0, pos.startColumn - 1).join('').length
          expect(pos.startOffset).toBe(lineOffset + columnOffset)
          if (node.type === 'text' && node.value === 'x') {
            textCount++
            expect(pos.startOffset).toBe(16)
            expect(pos.endOffset).toBe(17)
            expect(source.slice(pos.startOffset, pos.endOffset)).toBe('x')
          }
        }
        Object.entries(node).forEach(([key, child]) => {
          if (key !== 'pos') visit(child)
        })
      }
    }
    visit(carveToAstJson(source))
    expect(textCount).toBe(1)
  })

  it('preserves positions for a top-level tab', () => {
    expect(verseStarts('::: |\n\tx\n:::\n')).toEqual([
      ['paragraph', [2, 1, 6]],
      ['non_breaking_space', undefined],
      ['non_breaking_space', undefined],
      ['non_breaking_space', undefined],
      ['non_breaking_space', undefined],
      ['text', [2, 2, 7]],
    ])
  })

  it('preserves positions for spaces inside a list', () => {
    expect(verseStarts('- a\n\n  ::: |\n    x\n  :::\n')).toEqual([
      ['paragraph', [4, 3, 15]],
      ['non_breaking_space', [4, 3, 15]],
      ['non_breaking_space', [4, 4, 16]],
      ['text', [4, 5, 17]],
    ])
  })

  it('preserves positions for an unindented line', () => {
    expect(verseStarts('::: |\nx\n:::\n')).toEqual([
      ['paragraph', [2, 1, 6]],
      ['text', [2, 1, 6]],
    ])
  })
})
