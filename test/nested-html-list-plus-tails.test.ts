import { describe, expect, it } from 'vitest'
import { carveToCarve, carveToHtml, htmlToAst, htmlToCarve, renderHtml } from '../src/index.js'

const nestedList = (depth: number, tag: 'ul' | 'ol' = 'ul'): string => {
  let inner = `<${tag}><li></li></${tag}>`
  for (let level = 1; level < depth; level++) inner = `<${tag}><li>item${inner}+</li></${tag}>`
  return `<${tag}><li>item${inner}+</li></${tag}>`
}

describe('HTML list imports with literal plus tails', () => {
  it.each([
    ['three levels', nestedList(3)],
    ['four levels', nestedList(4)],
    ['ordered items', nestedList(3, 'ol')],
    ['quoted list', `<blockquote>${nestedList(3)}</blockquote>`],
  ])('keeps %s tight and at a writer fixed point', (_name, html) => {
    const imported = htmlToCarve(html)
    expect(imported.report.diagnostics).toEqual([])
    expect(carveToHtml(imported.value)).toBe(renderHtml(htmlToAst(html).value))
    expect(carveToCarve(imported.value)).toBe(imported.value)
  })
})
