import { expect, it } from 'vitest'
import { parse, renderHtml } from '../src/index.js'
import { layoutWork } from '../src/parse.js'
import fixtures from './fixtures/inline-fence-paragraph-resume.json'

const normalized = (html: string) => html.replace(/>\s+</g, '><').trim()

for (const row of fixtures) {
  it(`preserves paragraph ownership and source positions: ${row.id}`, () => {
    const ast = parse(row.source, { positions: true })
    expect(normalized(renderHtml(ast))).toBe(normalized(row.html))
    expect(normalized(renderHtml(parse(row.source)))).toBe(normalized(row.html))
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

it('bounds repeated rejected-fence paragraph resumes', () => {
  const previous = layoutWork.on
  try {
    const rows = [64, 128, 256].map(count => {
      const source = '- a\n    ```\n\n' + '  ~~~~\n  code\n  ~~~~\nafter\n'.repeat(count)
      layoutWork.reset()
      layoutWork.on = true
      const html = renderHtml(parse(source))
      expect(html.match(/<pre>/g)?.length).toBe(count)
      expect(html.match(/after/g)?.length).toBe(count)
      expect(html.lastIndexOf('after')).toBeLessThan(html.lastIndexOf('</li>'))
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
