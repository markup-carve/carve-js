import { expect, it } from 'vitest'
import { parse, renderHtml, resolve } from '../src/index.js'
import { layoutWork } from '../src/parse.js'
import fixtures from './fixtures/note-body-leaves-no-paragraph-open.json'

const normalized = (html: string) => html.replace(/>\s+</g, '><').trim()

// A marker-line note and a note nested in its body are invisible definitions,
// so a below-column line after their text or code finds no open paragraph
// (CARVE-P0-009) and closes the list.
for (const row of fixtures) {
  it(`closes the list below a note body: ${row.id}`, () => {
    expect(normalized(renderHtml(resolve(parse(row.source))))).toBe(normalized(row.html))
    expect(normalized(renderHtml(resolve(parse(row.source, { positions: true }))))).toBe(normalized(row.html))
  })
}

it('bounds repeated items that end in a nested note body', () => {
  const previous = layoutWork.on
  try {
    const work = [32, 64, 128].map(count => {
      const source = Array.from({ length: count }, (_, i) =>
        `- [^a${i}]: text\n    - child\n    [^b${i}]: inner\n      ~~~\n      code\n      ~~~\n      more\nbelow [^a${i}] [^b${i}]\n\n`).join('')
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
