import { describe, expect, it } from 'vitest'
import { carveToAstJson, carveToHtml } from '../src/index.js'
import { layoutWork } from '../src/parse.js'

const rows = [
  ['bullet', '- ::: d\n+\ntail\n', '<ul>'],
  ['ordered', '1. ::: d\n+\ntail\n', '<ol>'],
  ['body before marker', '- ::: d\n  z\n+\ntail\n', '<ul>'],
  ['quoted item', '> - ::: d\n> +\n> tail\n', '<blockquote>'],
  ['blank before marker', '- ::: d\n\n+\ntail\n', '<ul>'],
] as const

function placedNodes(source: string) {
  const nodes: Array<{ type: string; pos?: { startOffset: number; endOffset: number } }> = []
  const walk = (value: unknown): void => {
    if (Array.isArray(value)) { value.forEach(walk); return }
    if (value === null || typeof value !== 'object') return
    const record = value as Record<string, unknown>
    if (typeof record['type'] === 'string' && record['type'] !== 'document') {
      nodes.push(value as typeof nodes[number])
    }
    for (const [key, child] of Object.entries(record)) if (key !== 'pos') walk(child)
  }
  walk(carveToAstJson(source))
  return nodes
}

describe('a carried marker closes a named container without unplacing authored nodes', () => {
  for (const [name, source, opener] of rows) {
    it(name, () => {
      const html = carveToHtml(source)
      expect(html).toContain(opener)
      expect(html).toContain('<div class="d">')
      expect(html).toContain('tail')
      const nodes = placedNodes(source)
      expect(nodes.some(node => node.type === 'admonition')).toBe(true)
      for (const node of nodes) {
        expect(node.pos, node.type).toBeDefined()
        expect(node.pos!.startOffset).toBeGreaterThanOrEqual(0)
        expect(node.pos!.endOffset).toBeLessThanOrEqual(source.length)
        expect(node.pos!.endOffset).toBeGreaterThanOrEqual(node.pos!.startOffset)
      }
      const tail = nodes.find(node => node.type === 'text' && source.slice(node.pos!.startOffset, node.pos!.endOffset) === 'tail')
      expect(tail).toBeDefined()
    })
  }

  it('keeps an authored closer on the ordinary mapping path', () => {
    const source = '- ::: d\n  :::\n+\ntail\n'
    const nodes = placedNodes(source)
    expect(nodes.every(node => node.pos !== undefined)).toBe(true)
    expect(nodes.find(node => node.type === 'text')?.pos?.startOffset).toBe(source.indexOf('tail'))
  })

  it('maps repeated virtual closers with linear layout work', () => {
    const previous = layoutWork.on
    try {
      const work = [32, 64, 128].map(count => {
        const source = Array.from({ length: count }, (_, i) => `- ::: d\n+\ntail${i}\n\n`).join('')
        layoutWork.reset()
        layoutWork.on = true
        const tree = carveToAstJson(source)
        expect(tree.children.length).toBeGreaterThan(0)
        const total = layoutWork.gate + layoutWork.strip + layoutWork.seam + layoutWork.offsets +
          layoutWork.closerLines + layoutWork.geometryEntries
        expect(total).toBeLessThanOrEqual(source.length * 64)
        return total
      })
      expect(work[1]!).toBeLessThanOrEqual(work[0]! * 2.5)
      expect(work[2]!).toBeLessThanOrEqual(work[1]! * 2.5)
    } finally {
      layoutWork.on = previous
      layoutWork.reset()
    }
  })
})
