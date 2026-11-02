import { describe, it, expect } from 'vitest'
import { carveToAstJson } from '../src/index.js'

// CARVE-P12-011: a comment after a description is that description's child, so the term ends on its own line.
describe('a comment between descriptions stays out of the term', () => {
  it('ends the term on its line and the first description at the comment', () => {
    const source = ':: t\n: d\n%%\n: e\n'
    const [list] = carveToAstJson(source).children as Array<{ items: Array<{ type: string; pos: { startOffset: number; endOffset: number }; children: Array<{ type: string }> }> }>
    expect(list!.items.map((item) => [item.type, item.pos.startOffset, item.pos.endOffset])).toEqual([
      ['definition_term', 0, 4],
      ['definition_description', 5, 11],
      ['definition_description', 12, 15],
    ])
    expect(list!.items[1]!.children.map((child) => child.type)).toEqual(['paragraph', 'comment'])
  })

  for (const source of [
    ':: t\n: d\n%% c\n: e\n',
    ':: t\n: d\n\n%% c\n: e\n',
    '- :: term\n  : payload\n%% c\n   : d2\n',
    '> :: t\n> : d\n> %% c\n> : e\n',
    ':: t\n: d\n%%%\nz\n%%%\n: e\n',
  ]) {
    it(JSON.stringify(source), () => {
      const spans: Array<[number, number]> = []
      const walk = (node: unknown): void => {
        if (!node || typeof node !== 'object') return
        const record = node as { type?: string; items?: unknown[]; children?: unknown[]; pos?: { startOffset: number; endOffset: number } }
        if (record.type === 'definition_list') {
          for (const item of record.items as Array<{ pos: { startOffset: number; endOffset: number } }>) spans.push([item.pos.startOffset, item.pos.endOffset])
        }
        for (const child of [...(record.children ?? []), ...(record.items ?? [])]) walk(child)
      }
      walk(carveToAstJson(source))
      expect(spans.length).toBeGreaterThan(2)
      for (let i = 1; i < spans.length; i++) expect(spans[i]![0]).toBeGreaterThanOrEqual(spans[i - 1]![1])
    })
  }
})
