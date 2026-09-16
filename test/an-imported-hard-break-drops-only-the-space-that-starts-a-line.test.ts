import { describe, expect, it } from 'vitest'
import { carveToCarve, carveToHtml, htmlToAst, htmlToCarve, renderHtml } from '../src/index.js'

// The parser drops the whitespace that starts the line a hard break opens, so
// the importer drops it too. A space after an element that ENDS in a break
// follows the element's closer on the new line and is content
// (markup-carve/carve-rs#1706).

const rows: Array<[string, string, string]> = [
  ['a space after a strong ending in a break', '<p>a <strong>x<br></strong> b</p>', 'a {*x\\\n*} b\n'],
  ['a space after a strike ending in a break', '<p><s>x<br></s> y</p>', '{~x\\\n~} y\n'],
  ['a space after a link ending in a break', '<p><a href="u">x<br></a> y</p>', '[x\\\n](u) y\n'],
  ['text after the break', '<p>x<br> y</p>', 'x\\\ny\n'],
  ['a newline and indent after the break', '<p>x<br>\n  y</p>', 'x\\\ny\n'],
  ['a space before a strike closer', '<p><s>x<br> </s></p>', '{~x\\\n~}\n'],
  ['a space inside an emphasis', '<p><em>a<br> b</em></p>', '/a\\\nb/\n'],
  ['a space before a strong', '<p>x<br> <strong>y</strong></p>', 'x\\\n*y*\n'],
]

describe('the whitespace after an imported hard break', () => {
  it.each(rows)('imports %s', (_, html, carve) => {
    expect(htmlToCarve(html).value).toBe(carve)
  })

  it.each(rows)('reads %s back as the imported tree', (_, html) => {
    expect(carveToHtml(htmlToCarve(html).value)).toBe(renderHtml(htmlToAst(html).value))
  })

  it.each(rows.slice(0, 3))('keeps %s in the tree', (_, html) => {
    const paragraph = htmlToAst(html).value.children[0] as { children: Array<{ type: string; value?: string }> }
    expect(paragraph.children.at(-1)).toEqual({ type: 'text', value: html.includes(' b<') ? ' b' : ' y' })
  })

  it.each(rows)('writes %s as a fmt fixed point', (_, html) => {
    const carve = htmlToCarve(html).value
    expect(carveToCarve(carve)).toBe(carve)
  })
})
