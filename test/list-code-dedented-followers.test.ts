import { expect, it } from 'vitest'
import { parse, renderHtml, resolve } from '../src/index.js'
import { layoutWork } from '../src/parse.js'
import fixtures from './fixtures/list-code-dedented-followers.json'

const normalized = (html: string) => html.replace(/>\s+</g, '><').trim()

for (const row of fixtures) {
  it(`admits the authored fence before its dedented follower: ${row.id}`, () => {
    expect(normalized(renderHtml(resolve(parse(row.source))))).toBe(normalized(row.html))
    expect(normalized(renderHtml(resolve(parse(row.source, { positions: true }))))).toBe(normalized(row.html))
  })
}

it('bounds repeated authored fences before dedented followers', () => {
  const previous = layoutWork.on
  try {
    const work = [32, 64, 128].map(count => {
      const source = '- para\n    ```\n    code\ntext\n    ```\n\n'.repeat(count)
      layoutWork.reset()
      layoutWork.on = true
      const html = renderHtml(parse(source))
      expect(html.match(/<pre>/g)?.length).toBe(count - 1)
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
