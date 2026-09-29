import { describe, expect, it } from 'vitest'
import { parse, renderCarve, toAstJson, carveToHtml } from '../src/index.js'
import cases from './fixtures/comment-payload-columns.json'

function payloads(source: string): string[] {
  const found: string[] = []
  const walk = (node: any): void => {
    if (!node || typeof node !== 'object') return
    if (node.type === 'comment') found.push(node.content)
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) value.forEach(walk)
      else if (value && typeof value === 'object') walk(value)
    }
  }
  walk(toAstJson(parse(source)))
  return found
}

describe('comment payload columns (carve#2535)', () => {
  it.each(cases)('$name', ({ source, expected }) => {
    expect(payloads(source)).toEqual(expected)
    const formatted = renderCarve(parse(source))
    expect(payloads(formatted)).toEqual(expected)
    expect(renderCarve(parse(formatted))).toBe(formatted)
  })
})

it.each([
  ['- a\n %%% n\n # h\n\n%%%\n', '<ul>\n  <li>a\n    # h\n  </li>\n</ul>'],
  ['- a\n %%% n\n # h\n- b\n  %%%\n', '<ul>\n  <li>a\n    # h\n  </li>\n  <li>b</li>\n</ul>'],
])('a closer outside the item leaves its lazy text unchanged: %s', (source, html) => {
  expect(carveToHtml(source)).toBe(html)
})
