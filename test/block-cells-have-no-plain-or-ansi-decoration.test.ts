import { expect, it } from 'vitest'
import { fromAstJson, renderPlainText, renderAnsi } from '../src/index.js'

const text = (value: string) => ({ type: 'text', value })
const paragraph = (value: string) => ({ type: 'paragraph', children: [text(value)] })
const table = (cell: object) => fromAstJson({
  type: 'document', srcByteLength: 0,
  children: [{ type: 'table', rows: [{ type: 'table_row', cells: [
    { type: 'table_cell', header: false, ...cell },
  ] }] }],
} as never)

for (const render of [renderPlainText, renderAnsi]) {
  it(`${render.name} omits block markers and joins only contributing content`, () => {
    const actual = table({ blocks: [paragraph('one'), { type: 'thematic_break' }, paragraph('two')] })
    expect(render(actual)).toBe(render(table({ children: [text('one two')] })))
  })

  it(`${render.name} flattens nested headings, quotes and code as content`, () => {
    const actual = table({ blocks: [{ type: 'block_quote', children: [
      { type: 'heading', level: 2, children: [text('Heading')] },
      { type: 'code_block', content: 'first\nsecond\n', lang: 'js' },
    ] }] })
    expect(render(actual)).toBe(render(table({ children: [text('Heading first second')] })))
  })

  it(`${render.name} keeps inline styling while removing block decoration`, () => {
    const children = [{ type: 'strong', children: [text('bold')] }]
    expect(render(table({ blocks: [{ type: 'paragraph', children }] })))
      .toBe(render(table({ children })))
  })

  it(`${render.name} omits a raw block payload`, () => {
    expect(render(table({ blocks: [{ type: 'raw_block', format: 'html', content: '<b>raw</b>\n' }] })))
      .toBe(render(table({ children: [] })))
  })
}
