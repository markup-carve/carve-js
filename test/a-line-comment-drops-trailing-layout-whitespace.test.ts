import { describe, expect, it } from 'vitest'
import { carveToAstJson, carveToCarve } from '../src/index.js'

function commentContents(source: string): string[] {
  const contents: string[] = []
  function visit(value: unknown): void {
    if (Array.isArray(value)) {
      value.forEach(visit)
    } else if (value !== null && typeof value === 'object') {
      const node = value as Record<string, unknown>
      if (node.type === 'comment') contents.push(node.content as string)
      Object.values(node).forEach(visit)
    }
  }
  visit(carveToAstJson(source))
  return contents
}

describe('line comment content', () => {
  it('drops trailing space and tab in block, inline, and line block positions', () => {
    for (const source of [
      '%%. \n',
      ':::\n%%. \n:::\n',
      'x %% . \t\n',
      'x %% . \r\n',
      '::: |\na\n%% . \t\nb\n:::\n',
    ]) {
      expect(commentContents(source)).toEqual(['.'])
      const written = carveToCarve(source)
      expect(carveToCarve(written)).toBe(written)
      expect(commentContents(written)).toEqual(['.'])
    }
  })

  it('keeps a no-break space as comment content', () => {
    expect(commentContents('%%.\u00a0\n')).toEqual(['.\u00a0'])
  })
})
