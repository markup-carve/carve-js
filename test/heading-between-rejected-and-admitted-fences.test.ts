import { expect, it } from 'vitest'
import { parse, renderHtml, resolve } from '../src/index.js'
import { layoutWork } from '../src/parse.js'
import fixtures from './fixtures/heading-between-rejected-and-admitted-fences.json'

const normalized = (html: string) => html.replace(/>\s+</g, '><').trim()

for (const row of fixtures) {
  it(`reads paragraph ownership and keeps source positions in range: ${row.id}`, () => {
    const ast = parse(row.source, { positions: true })
    expect(normalized(renderHtml(resolve(ast)))).toBe(normalized(row.html))
    expect(normalized(renderHtml(resolve(parse(row.source))))).toBe(normalized(row.html))
    const length = [...row.source].length
    const visit = (value: unknown): void => {
      if (!value || typeof value !== 'object') return
      const node = value as { pos?: { startOffset: number, endOffset: number } }
      if (node.pos) {
        expect(node.pos.startOffset).toBeGreaterThanOrEqual(0)
        expect(node.pos.endOffset).toBeGreaterThanOrEqual(node.pos.startOffset)
        expect(node.pos.endOffset).toBeLessThanOrEqual(length)
      }
      for (const child of Object.values(value)) {
        if (Array.isArray(child)) child.forEach(visit)
      }
    }
    visit(ast)
  })
}

it('bounds repeated items that end on a heading and a closed code block', () => {
  const previous = layoutWork.on
  try {
    const rows = [64, 128, 256].map(count => {
      const source = '- a\n    ```\n\n  # h\n\n  ~~~~\n  code\n  ~~~~\nafter\n\n'.repeat(count)
      layoutWork.reset()
      layoutWork.on = true
      const html = renderHtml(parse(source))
      expect(html.match(/<pre>/g)?.length).toBe(count)
      // No paragraph is open after the closed block, so every `after` leaves its list.
      expect(html.match(/<\/ul>\n<p>after<\/p>/g)?.length).toBe(count)
      const work = layoutWork.gate + layoutWork.strip + layoutWork.seam + layoutWork.offsets + layoutWork.closerLines
      expect(work).toBeLessThanOrEqual(source.length * 64)
      return work
    })
    expect(rows[1]!).toBeLessThanOrEqual(rows[0]! * 2.5)
    expect(rows[2]!).toBeLessThanOrEqual(rows[1]! * 2.5)
  } finally {
    layoutWork.on = previous
    layoutWork.reset()
  }
})
