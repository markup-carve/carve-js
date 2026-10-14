import { expect, it } from 'vitest'
import { carveToCarve, carveToHtml, parse, renderCarve } from '../src/index.js'

it.each([
  ['| ^ | b |\n+ t | u |\n', 'rowspan'],
  ['| < | b |\n+ t | u |\n', 'colspan'],
])('keeps a blocked %s marker and its joined text', (source, span) => {
  const table = parse(source).children[0]
  expect(table?.type).toBe('table')
  if (table?.type !== 'table') return
  expect(table.rows[0]?.cells[0]).toMatchObject({
    span,
    children: [{ type: 'text', value: 't' }],
  })
  expect(carveToHtml(source)).toContain('<td>t</td>')
  expect(carveToCarve(source)).toBe(source)
})

it('records the second join column in a widened cell', () => {
  const source = '| a | < |\n+ x | y |\n'
  const table = parse(source).children[0]
  expect(table?.type).toBe('table')
  if (table?.type !== 'table') return
  expect(table.rows[0]?.cells[0]?.children).toMatchObject([
    { type: 'text', value: 'a' },
    { type: 'cell_wrap', line: 1 },
    { type: 'text', value: 'x' },
    { type: 'cell_wrap', line: 1, col: 1 },
    { type: 'text', value: 'y' },
  ])
  expect(carveToCarve(source)).toBe(source)
})

it('keeps both parts when a blocked marker is widened', () => {
  const source = '| ^ | < |\n+ x | y |\n'
  expect(carveToHtml(source)).toContain('<td colspan="2">x y</td>')
  expect(carveToCarve(source)).toBe(source)
})

it('names the later continuation line that supplies blocked marker text', () => {
  const source = '| ^ | b |\n+   | u |\n+ t | v |\n'
  const table = parse(source).children[0]
  expect(table?.type).toBe('table')
  if (table?.type !== 'table') return
  expect(table.rows[0]?.cells[0]?.children).toMatchObject([
    { type: 'cell_wrap', line: 2 },
    { type: 'text', value: 't' },
  ])
  expect(carveToHtml(source)).toContain('<td>t</td>')
  expect(carveToCarve(source)).toBe('| ^ | b |\n+ | u |\n+ t | v |\n')
})

it('writes a blocked span cell attribute only on its marker', () => {
  const document = parse('| ^ | b |\n+ t | u |\n')
  const table = document.children[0]
  expect(table?.type).toBe('table')
  if (table?.type !== 'table') return
  table.rows[0]!.cells[0]!.attrs = { classes: ['marked'] }
  const output = renderCarve(document)
  expect(output).toBe('|{.marked} ^ | b |\n+ t | u |\n')
  expect(output.match(/\{\.marked\}/g)).toHaveLength(1)
})

it('locates a joined marker after a separator row', () => {
  const source = '| A |\n|---|\n| ^ |\n+ x |\n'
  expect(carveToCarve(source)).toBe(source)
  expect(carveToHtml(source)).toContain('<th scope="col" rowspan="2">A x</th>')
})
