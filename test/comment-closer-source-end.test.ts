import { describe, expect, it } from 'vitest'
import { parse } from '../src/parse.js'
import { toAstJson } from '../src/ast-json.js'

const positioned = (source: string): Record<string, number[]> => {
  const found: Record<string, number[]> = {}
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) { value.forEach(visit); return }
    if (value === null || typeof value !== 'object') return
    const node = value as Record<string, unknown>
    if (typeof node.type === 'string' && node.pos && typeof node.pos === 'object') {
      const pos = node.pos as { endOffset?: number }
      if (pos.endOffset !== undefined) (found[node.type] ??= []).push(pos.endOffset)
    }
    Object.values(node).forEach(visit)
  }
  visit(toAstJson(parse(source)))
  return found
}

describe('closed comment source boundaries', () => {
  it('ends a description and its list on the authored closer', () => {
    const ends = positioned(':: t\n:  head\n\n     %%%\n     a\n%%%\n')
    expect(ends.comment).toContain(33)
    expect(ends.definition_description).toContain(33)
    expect(ends.definition_list).toContain(33)
  })

  it('leaves the following document paragraph outside the list', () => {
    const ends = positioned('- %%%\n%%%\n:  x\n   %%%\n')
    expect(ends.comment).toContain(9)
    expect(ends.list_item).toContain(9)
    expect(ends.list).toContain(9)
  })
})
