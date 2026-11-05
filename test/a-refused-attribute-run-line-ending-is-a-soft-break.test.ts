/*
 * carve-js#4430: a refused wrapped attribute run is paragraph text, so its line
 * ending is a `soft_break` (`soft_break = newline`, 07-inline-rich-text), as in
 * carve-php and carve-rs. Plain and ANSI write the space a soft break becomes.
 */
import { describe, it, expect } from 'vitest'
import { parse, renderAnsi, renderCarve, renderHtml, renderPlainText } from '../src/index.js'

const source = '{.a\n.b}\n\nparagraph\n'

describe('a refused attribute run spanning lines', () => {
  it('reads its line ending as a soft break', () => {
    const paragraph = parse(source).children[0] as { children: Array<{ type: string; value?: string }> }
    expect(paragraph.children.map((n) => [n.type, n.value])).toEqual([
      ['text', '{.a'], ['soft_break', undefined], ['text', '.b}'],
    ])
  })

  it('writes the soft break as a space in plain and ANSI', () => {
    expect(renderPlainText(parse(source))).toBe('{.a .b}\n\nparagraph\n')
    expect(renderAnsi(parse(source))).toBe('{.a .b}\n\nparagraph\n')
  })

  it('keeps every line ending of a three-line run and of one after a paragraph line', () => {
    const types = (s: string) => (parse(s).children[0] as { children: Array<{ type: string }> }).children.map((n) => n.type)
    expect(types('{.a\n.b\n.c}\n')).toEqual(['text', 'soft_break', 'text', 'soft_break', 'text'])
    expect(types('pre\n{.a\n.b}\n')).toEqual(['text', 'soft_break', 'text', 'soft_break', 'text'])
  })

  it('changes neither the HTML nor the written form', () => {
    expect(renderHtml(parse(source))).toBe('<p>{.a\n.b}</p>\n<p>paragraph</p>')
    expect(renderCarve(parse(source))).toBe(source)
  })

  it.each([
    ['{k=""}{c\n}\n', '{k=""}{c\n}\n'],
    ['x\n{k=""}{c\n}\n', 'x\n{k=""}{c\n}\n'],
    ['- pre\n {.a\n .b}\n', '- pre\n  {.a\n  .b}\n'],
  ])('writes the split run without inventing an escape: %j', (input, written) => {
    expect(renderCarve(parse(input))).toBe(written)
  })
})
