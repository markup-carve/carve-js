import { expect, it } from 'vitest'
import { parse, renderHtml, resolve } from '../src/index.js'
import { layoutWork } from '../src/parse.js'
import fixtures from './fixtures/continued-marker-note-code.json'

const normalized = (html: string) => html.replace(/>\s+</g, '><').trim()

for (const row of fixtures) {
  it(`keeps continued marker-note and list CODE ownership: ${row.id}`, () => {
    expect(normalized(renderHtml(resolve(parse(row.source))))).toBe(normalized(row.html))
    expect(normalized(renderHtml(resolve(parse(row.source, { positions: true }))))).toBe(normalized(row.html))
  })
}

it('keeps the continued note and CODE in their source spans', () => {
  const source = '- [^n]: text\n    - child\n    ```\n    code\n    ```\nafter [^n]\n'
  const ast = parse(source, { positions: true })
  const list = ast.children[0]!
  expect(list.type).toBe('list')
  if (list.type !== 'list') throw new Error('Expected list')
  expect(list.items[0]!.children).toMatchObject([{
    type: 'code_block', content: 'code\n',
    pos: { startLine: 3, endLine: 5, startOffset: 29, endOffset: 49 },
  }])
  expect(ast.children[1]).toMatchObject({ type: 'paragraph', pos: { startLine: 6 } })
  expect(ast.footnoteDefs?.n).toMatchObject([{
    type: 'paragraph', children: [{ type: 'text', value: 'text' }, { type: 'soft_break' }, { type: 'text', value: '- child' }],
  }])
  expect(ast.footnoteDefPos?.n).toMatchObject({ startOffset: 2, endOffset: 24, endLine: 2 })
})

it('bounds repeated continued marker-note collection', () => {
  const previous = layoutWork.on
  try {
    const work = [32, 64, 128].map(count => {
      const source = Array.from({ length: count }, (_, i) =>
        `- [^n${i}]: text\n    - child\n    ~~~~\n    code\n    ~~~~\nafter [^n${i}]\n\n`).join('')
      layoutWork.reset()
      layoutWork.on = true
      const ast = parse(source)
      expect(Object.keys(ast.footnoteDefs ?? {})).toHaveLength(count)
      expect(renderHtml(ast).match(/<pre>/g)?.length).toBe(count)
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
