import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

describe('a block attribute line uses only spaces between slots', () => {
  it('keeps tabs in every interior gap as paragraph content', () => {
    for (const attributes of ['{\t.a .b}', '{.a\t.b}', '{.a .b\t}', '{\t.a\t.b\t}']) {
      const source = [attributes, '', 'paragraph'].join('\n')
      expect(carveToHtml(source)).toBe(`<p>${attributes}</p>\n<p>paragraph</p>`)
    }
  })

  it('uses the same rule in headings, lists, tables, and definitions', () => {
    const sources = [
      ['{.a\t.b}', '# Heading'],
      ['- {.a\t.b}', '  paragraph'],
      ['{.a\t.b}', '| a |', '|---|', '| b |'],
      ['{.a\t.b}', '[r]: /u', '', '[x][r]'],
    ]
    for (const lines of sources) {
      expect(carveToHtml(lines.join('\n'))).not.toContain('class="a b"')
      expect(carveToHtml(lines.map((line) => line.replace('\t', ' ')).join('\n'))).toContain('class="a b"')
    }
  })

  it('keeps continuation indentation and line-final tabs', () => {
    const source = ['{.a \t', '\t.b} \t', '', 'paragraph'].join('\n')
    expect(carveToHtml(source)).toBe('<p class="a b">paragraph</p>')
  })

  it('keeps quoted tabs as attribute value content', () => {
    const source = ['{title="a\tb" .c}', '', 'paragraph'].join('\n')
    expect(carveToHtml(source)).toBe('<p title="a\tb" class="c">paragraph</p>')
  })
})
