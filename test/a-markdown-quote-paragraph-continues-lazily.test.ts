import { describe, expect, it } from 'vitest'
import { carveToHtml, markdownToCarve } from '../src/index.js'

// A Markdown line with no quote marker lazily continues the quote's open
// paragraph, and a definition cannot interrupt a Markdown paragraph. Carve lets
// a definition interrupt one, so such a continuation line is escaped
// (carve-js#1812).

const imported = (markdown: string) => markdownToCarve(markdown).replace(/\n+$/, '')

describe('a lazy line after a quoted paragraph', () => {
  it.each([
    ['plain text', '> a\nb', '> a\n> b', '<blockquote><p>a\nb</p></blockquote>'],
    ['a nested quote', '> > a\nb', '> > a\n> > b', '<blockquote>\n  <blockquote><p>a\nb</p></blockquote>\n</blockquote>'],
    ['a definition-shaped line', '> a\n[p]: /x', '> a\n> \\[p]: /x', '<blockquote><p>a\n[p]: /x</p></blockquote>'],
  ])('stays in the quote for %s', (_, markdown, carve, html) => {
    expect(imported(markdown)).toBe(carve)
    expect(carveToHtml(imported(markdown)).trim()).toBe(html)
  })

  it.each([
    ['a heading', '> a\n# h', '> a\n\n# h'],
    ['a list item', '> a\n- l', '> a\n\n- l'],
    ['a thematic break', '> a\n---', '> a\n\n---'],
    ['a fence', '> a\n```\nx\n```', '> a\n\n```\nx\n```'],
    ['a line after a quoted fence', '> ```\n> code\nb', '> ```\n> code\n> ```\n\nb'],
    ['a line after a quoted heading', '> # h\nb', '> # h\n\nb'],
  ])('ends the quote before %s', (_, markdown, carve) => {
    expect(imported(markdown)).toBe(carve)
  })
})

describe('a definition-shaped line continuing a paragraph', () => {
  it.each([
    ['at the top level', 'a\n[p]: /x', 'a\n\\[p]: /x'],
    ['inside a quote', '> a\n> [p]: /x', '> a\n> \\[p]: /x'],
    ['in a list item', '- a\n  [p]: /x', '- a\n  \\[p]: /x'],
  ])('is escaped %s', (_, markdown, carve) => {
    expect(imported(markdown)).toBe(carve)
    expect(carveToHtml(imported(markdown))).toContain('[p]: /x')
  })

  it.each([
    ['a definition that opens its own block', '[p]: /x\n\na', '[p]: /x\n\na'],
    ['a line already escaped', 'a\n\\[p]: /x', 'a\n\\[p]: /x'],
    ['a bracket that opens no definition', 'a\n[p] x', 'a\n[p] x'],
  ])('leaves %s alone', (_, markdown, carve) => {
    expect(imported(markdown)).toBe(carve)
  })
})
