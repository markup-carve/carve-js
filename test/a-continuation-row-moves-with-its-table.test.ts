import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

const table = (cell: string): string => `<table>
  <tbody>
    <tr><td>${cell}</td></tr>
  </tbody>
</table>`

describe('T6: an indented + row under a table row continues it (carve#4161)', () => {
  it.each([
    ['| a |\n + b |\n'],
    ['| a |\n    + b |\n'],
    ['  | a |\n  + b |\n'],
    ['  | a |\n + b |\n'],
    ['| a |\n\t+ b |\n'],
  ])('%j', (source) => {
    expect(carveToHtml(source)).toBe(table('a b'))
  })

  it('keeps taking rows below the continuation', () => {
    expect(carveToHtml('| a |\n + b |\n | c |\n')).toBe(`<table>
  <tbody>
    <tr><td>a b</td></tr>
    <tr><td>c</td></tr>
  </tbody>
</table>`)
  })

  it.each([
    ['| a |\n\n + b |\n', `${table('a')}\n<p>+ b |</p>`],
    ['x\n + b |\n', '<p>x\n+ b |</p>'],
    [' + b |\n', '<p>+ b |</p>'],
  ])('%j has no row to continue', (source, html) => {
    expect(carveToHtml(source)).toBe(html)
  })

  it('reads a row behind a lead tab as text, with the + line lazy', () => {
    expect(carveToHtml('- \t| a |\n + b |\n')).toBe(`<ul>
  <li>| a |
+ b |</li>
</ul>`)
  })
})

describe('the block walk reads attribute lines the way the block readers do', () => {
  it.each([
    ['{}\n.{} }\n  # h\n', '<p>{}\n.{} }</p>'],
    ['{}\n- a\n  # h\n', '<p>{}\n- a</p>'],
    ['{ }\n- a\n  # h\n', '<p>{ }\n- a</p>'],
  ])('%j: an empty block leaves a paragraph that a heading ends', (source, paragraph) => {
    expect(carveToHtml(source)).toBe(`${paragraph}\n<section id="h">\n  <h1>h</h1>\n</section>`)
  })

  it.each([
    ['{x} {y}'],
    ['{.a}{}'],
    ['{}{.a}'],
  ])('%j in an item is text a marker below its column folds into', (run) => {
    expect(carveToHtml(`1. a\n   ${run}\n  - s\n`)).toBe(`<ol>\n  <li>a\n${run}\n- s</li>\n</ol>`)
  })

  it('a real attribute run still ends the paragraph', () => {
    expect(carveToHtml('1. a\n   {.b}{.c}\n  - s\n')).toBe(carveToHtml('1. a\n   {.b}\n  - s\n'))
  })
})
