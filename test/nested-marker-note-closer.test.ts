import { expect, it } from 'vitest'
import { parse, renderHtml, resolve } from '../src/index.js'
import { layoutWork } from '../src/parse.js'
import fixtures from './fixtures/nested-marker-note-closer.json'

const normalized = (html: string) => html.replace(/>\s+</g, '><').trim()

for (const row of fixtures) {
  it(`preserves paragraph ownership after nested note CODE: ${row.id}`, () => {
    expect(normalized(renderHtml(resolve(parse(row.source))))).toBe(normalized(row.html))
    expect(normalized(renderHtml(resolve(parse(row.source, { positions: true }))))).toBe(normalized(row.html))
  })
}

it('bounds repeated nested-note closer tracking', () => {
  const previous = layoutWork.on
  try {
    const work = [32, 64, 128].map(count => {
      const source = Array.from({ length: count }, (_, i) =>
        `- [^a${i}]: text\n    - child\n    [^b${i}]: inner\n      - c2\n      ~~~\n      code\n      ~~~\nafter [^a${i}] [^b${i}]\n\n`).join('')
      layoutWork.reset()
      layoutWork.on = true
      const ast = parse(source)
      expect(Object.keys(ast.footnoteDefs ?? {})).toHaveLength(count * 2)
      expect(ast.children.filter(node => node.type === 'paragraph')).toHaveLength(count)
      const total = layoutWork.gate + layoutWork.strip + layoutWork.seam + layoutWork.offsets + layoutWork.closerLines
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
