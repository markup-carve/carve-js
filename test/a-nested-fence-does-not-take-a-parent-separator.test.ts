import { expect, it } from 'vitest'
import { carveToCarve, carveToHtml, parse, renderHtml } from '../src/index.js'

const empty = '<ul>\n  <li>\n    <ul>\n      <li>\n        <pre><code></code></pre>\n      </li>\n    </ul>\n  </li>\n</ul>'

it.each([
  '- - ```\n\n',
  '- - ```\n\ntail\n',
  '- - ```\n+\n\ntail\n',
])('keeps the parent separator outside an unclosed nested fence: %s', source => {
  const expected = empty + (source.includes('tail') ? '\n<p>tail</p>' : '')
  expect(carveToHtml(source)).toBe(expected)
  expect(renderHtml(parse(source))).toBe(expected)
  const formatted = carveToCarve(source)
  expect(carveToHtml(formatted)).toBe(expected)
  expect(carveToCarve(formatted)).toBe(formatted)
})

it('keeps a blank payload line before a nested closing fence', () => {
  const source = '- - ```\n\n    ```\n\ntail\n'
  const expected = empty.replace('<code></code>', '<code>\n</code>') + '\n<p>tail</p>'
  expect(carveToHtml(source)).toBe(expected)
  expect(renderHtml(parse(source))).toBe(expected)
  expect(carveToHtml(carveToCarve(source))).toBe(expected)
})

it('keeps an unclosed fence owned directly by the parent item', () => {
  const source = '- ```\n\ntail\n'
  const expected = '<ul>\n  <li>\n    <pre><code>\n</code></pre>\n  </li>\n</ul>\n<p>tail</p>'
  expect(carveToHtml(source)).toBe(expected)
  expect(renderHtml(parse(source))).toBe(expected)
  expect(carveToHtml(carveToCarve(source))).toBe(expected)
})

it('keeps trailing payload blanks after a child heading opens a body-line fence', () => {
  const source = '- - # h\n    ```\n    x\n\ntail\n'
  const expected = '<ul>\n  <li>\n    <ul>\n      <li>\n        <h1 id="h">h</h1>\n        <pre><code>x\n\n</code></pre>\n      </li>\n    </ul>\n  </li>\n</ul>\n<p>tail</p>'
  expect(carveToHtml(source)).toBe(expected)
  expect(renderHtml(parse(source))).toBe(expected.replace(' id="h"', ''))
  expect(carveToHtml(carveToCarve(source))).toBe(expected)
})

it('keeps fence-shaped payload and its trailing blank inside a child fence', () => {
  const source = '- - ```\n\n    ~~~\n\ntail\n'
  const expected = empty.replace('<code></code>', '<code>\n~~~\n\n</code>') + '\n<p>tail</p>'
  expect(carveToHtml(source)).toBe(expected)
  expect(renderHtml(parse(source))).toBe(expected)
  expect(carveToHtml(carveToCarve(source))).toBe(expected)
})
