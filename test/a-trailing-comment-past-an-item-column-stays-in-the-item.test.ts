import { describe, expect, it } from 'vitest'
import { carveToCarve, parse } from '../src/index.js'
import type { BlockNode } from '../src/index.js'

// A final `%%` line is placed by the trailing-owner fast path. Any column at or
// past the open item's content column is that item's, not only the exact one.

const ownerPath = (source: string): string[] => {
  const paths: string[] = []
  const walk = (node: { type?: string; children?: unknown; items?: unknown }, path: string): void => {
    if (node.type === 'comment') paths.push(path)
    for (const key of ['children', 'items'] as const) {
      const value = node[key]
      if (Array.isArray(value)) for (const child of value as BlockNode[]) walk(child, `${path}/${child.type}`)
    }
  }
  walk(parse(source) as never, 'doc')
  return paths
}

const ITEM = 'doc/list/list_item/comment'
const NESTED = 'doc/list/list_item/list/list_item/comment'

describe('a trailing comment past an item column', () => {
  it.each([
    ['- l0\n   %%\n', [ITEM]],
    ['- l0\n    %% x\n', [ITEM]],
    ['1. l0\n    %%\n', [ITEM]],
    ['- l0\n\n   %%\n', [ITEM]],
    ['- l0\n  - l1\n   %%\n', [ITEM]],
    ['- l0\n  - l1\n     %%\n', [NESTED]],
  ])('stays in the deepest item it reaches: %j', (source, expected) => {
    expect(ownerPath(source)).toEqual(expected)
  })

  it.each([
    ['- l0\n %%\n'],
    ['- l0\n\nText\n  %%\n'],
  ])('belongs to the document when no open item reaches it: %j', (source) => {
    expect(ownerPath(source)).toEqual(['doc/comment'])
  })

  it('is written at its owner column', () => {
    expect(carveToCarve('- l0\n   %%\n')).toBe('- l0\n  %%\n')
    expect(carveToCarve('- l0\n  - l1\n     %%\n')).toBe('- l0\n  - l1\n    %%\n')
  })
})
