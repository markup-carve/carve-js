import { expect, it } from 'vitest'
import { parse, resolve, toAstJson } from '../src/index.js'

it.each([
  '|={colspan=3} a | < | b |\n',
  '|={title="a"} a |\n',
  '|={k="a a"} a |\n',
])('anchors cell text after its marker attributes: %j', (source) => {
  const doc = toAstJson(resolve(parse(source)))
  const table = doc.children[0]
  expect(table?.type).toBe('table')
  if (table?.type !== 'table') return
  const first = table.rows[0]?.cells[0]
  const text = first?.children?.[0]
  expect(text?.type).toBe('text')
  expect(text?.pos?.startOffset).toBe(source.lastIndexOf(' a |') + 1)
  expect(text?.pos?.endOffset).toBe(source.lastIndexOf(' a |') + 2)
})
