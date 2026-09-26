import { expect, it } from 'vitest'
import { fromAstJson, renderPlainText, renderAnsi, renderMarkdown, renderCarve, renderHtml, parse } from '../src/index.js'

const text = (value: string) => ({ type: 'text', value })
const paragraph = (value: string) => ({ type: 'paragraph', children: [text(value)] })
const table = (cell: object) => fromAstJson({
  type: 'document', srcByteLength: 0,
  children: [{ type: 'table', rows: [{ type: 'table_row', cells: [
    { type: 'table_cell', header: false, ...cell },
  ] }] }],
} as never)

for (const render of [renderPlainText, renderAnsi, renderMarkdown]) {
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

  it(`${render.name} preserves code spaces and empty lines`, () => {
    expect(render(table({ blocks: [{ type: 'code_block', content: 'a  b\n\nc' }] })))
      .toBe(render(table({ children: [text('a  b  c')] })))
  })

  it(`${render.name} keeps titles and figure content in document order`, () => {
    const blocks = [
      { type: 'admonition', kind: 'note', title: [text('Title')], children: [paragraph('body')] },
      { type: 'figure', target: paragraph('target'), caption: [text('caption')] },
    ]
    expect(render(table({ blocks })))
      .toBe(render(table({ children: [text('Title body target caption')] })))
  })

  it(`${render.name} omits a raw block payload`, () => {
    expect(render(table({ blocks: [{ type: 'raw_block', format: 'html', content: '<b>raw</b>\n' }] })))
      .toBe(render(table({ children: [] })))
  })
}

it('refuses a padded leading-newline span before following content or a link closer', () => {
  const code = { type: 'code', value: '\n`' }
  for (const children of [
    [text('before '), code, text(' after')],
    [{ type: 'link', href: 'u', children: [text('before '), code] }],
  ]) {
    const doc = fromAstJson({ type: 'document', srcByteLength: 0, children: [{ type: 'paragraph', children }] } as never)
    expect(() => renderCarve(doc)).toThrow(/cannot spell code/)
  }
})

it('preserves the open run inside a braced strike', () => {
  const source = '{~before ``\n`~}\n'
  const formatted = renderCarve(parse(source))
  expect(renderHtml(parse(formatted))).toBe(renderHtml(parse(source)))
  expect(renderCarve(parse(formatted))).toBe(formatted)
})
