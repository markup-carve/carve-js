import { describe, expect, it } from 'vitest'
import { parse } from '../src/index.js'
import { layoutWork } from '../src/parse.js'
import { dropPositions } from '../src/source-positions.js'

describe('nested source offset bookkeeping', () => {
  it.each(['\n', '\r\n', '\r'])('preserves document offsets through containers with %j endings', (ending) => {
    const source = '\ufeff' + ['# Head', '', '> - α *bold*', '>   continued', '', '::: note', 'tail', ':::', ''].join(ending)
    const doc = parse(source)
    const textOffsets: [string, number, number][] = []
    const visit = (value: unknown): void => {
      if (!value || typeof value !== 'object') return
      if (Array.isArray(value)) {
        for (const child of value) visit(child)
        return
      }
      const node = value as Record<string, unknown>
      if (node.type === 'text' && typeof node.value === 'string' && node.pos) {
        const pos = node.pos as { startOffset: number; endOffset: number }
        textOffsets.push([node.value, pos.startOffset, pos.endOffset])
      }
      for (const [key, child] of Object.entries(node)) if (key !== 'pos') visit(child)
    }
    visit(doc)
    expect(textOffsets.length).toBeGreaterThan(4)
    const points = Array.from(source)
    for (const [text, start, end] of textOffsets) expect(points.slice(start, end).join('')).toBe(text)
    const expected = structuredClone(doc)
    dropPositions(expected)
    expect(parse(source, { positions: false })).toEqual(expected)
  })

  it('builds local offsets only for views that need them', () => {
    for (const positions of [false, true]) {
      const source = '::: box\n'.repeat(150) + 'payload\n'.repeat(2000) + ':::\n'.repeat(150)
      const wasOn = layoutWork.on
      layoutWork.reset()
      layoutWork.on = true
      try {
        const doc = parse(source, { positions })
        expect(doc.children.length).toBe(1)
        expect(layoutWork.offsets).toBeLessThanOrEqual(source.split('\n').length * 2)
      } finally {
        layoutWork.on = wasOn
        layoutWork.reset()
      }
    }
  })

  it('keeps diagnostic offsets when published positions are disabled', () => {
    const source = '\ufeff> ::: note\r\n> body\r\n'
    const withPositions: unknown[] = []
    const withoutPositions: unknown[] = []
    parse(source, { onUnclosedContainer: (value) => withPositions.push(value) })
    parse(source, { positions: false, onUnclosedContainer: (value) => withoutPositions.push(value) })
    expect(withPositions.length).toBeGreaterThan(0)
    expect(withoutPositions).toEqual(withPositions)
  })
})
