import { describe, expect, it } from 'vitest'
import { bbcodeToCarve, carveToHtml, djotToCarve, markdownToCarve } from '../src/index.js'
import { escapePlainCarveInlineSyntax, HANDLED_PLAIN } from '../src/carve-escape.js'

const html = (carve: string) => carveToHtml(carve).trim()
const importers = { markdown: markdownToCarve, djot: djotToCarve, bbcode: bbcodeToCarve }

describe('an imported equals pair stays literal', () => {
  // None of the three source languages has a bare highlight.
  for (const [name, convert] of Object.entries(importers)) {
    it.each([
      ['=a==', '\\=a=='],
      ['=a=b=', '\\=a=b='],
      ['x =a== y', 'x \\=a== y'],
      ['(=a=b=)', '(\\=a=b=)'],
      ['=a= b=', '\\=a= b='],
      ['=a =b= c=', '\\=a \\=b= c='],
    ])(`${name} writes %j as %j`, (source, carve) => {
      expect(convert(source + '\n')).toBe(carve + '\n')
      expect(html(carve)).toBe(`<p>${source}</p>`)
    })

    it.each(['a=b=c', 'x = 5 = y', '==a==', 'key=value=', '=a =', '= a='])(`${name} leaves %j bare`, (source) => {
      expect(convert(source + '\n')).toBe(source + '\n')
      expect(html(source)).toBe(`<p>${source}</p>`)
    })

    it(`${name} escapes a pair across a line break and none across a blank line`, () => {
      expect(convert('=a\nb==\n')).toBe('\\=a\nb==\n')
      expect(html('\\=a\nb==')).toBe('<p>=a\nb==</p>')
      expect(convert('=a\n\nb=\n')).toBe('=a\n\nb=\n')
      expect(html('=a\n\nb=')).toBe('<p>=a</p>\n<p>b=</p>')
    })

    // The parser reads only a space, a tab and a line end as blank.
    it.each(['=', '/'])(`${name} escapes a %j opener before a no-break space`, (delimiter) => {
      const source = `${delimiter}\u00a0a${delimiter}`
      expect(convert(source + '\n')).toBe(`\\${source}\n`)
      expect(html(`\\${source}`)).toBe(`<p>${delimiter}&nbsp;a${delimiter}</p>`)
    })
  }

  it('renders no highlight for any short Markdown or Djot line made of equals signs, letters, spaces and parentheses', () => {
    const alphabet = ['=', 'a', ' ', '(']
    const marked: string[] = []
    const visit = (line: string): void => {
      if (line.includes('=') && !/^\s|\s$/.test(line)) {
        for (const convert of [markdownToCarve, djotToCarve]) if (html(convert(line + '\n')).includes('<mark>')) marked.push(line)
      }
      if (line.length < 6) for (const char of alphabet) visit(line + char)
    }
    visit('')
    expect(marked).toEqual([])
  })
})

describe('the same pairing holds for every bare delimiter in plain text', () => {
  it.each([
    ['x ~a~~ y', 'x \\~a~~ y'],
    ['x ~a~b~ y', 'x \\~a~b~ y'],
    ['x *a** y', 'x \\*a** y'],
    ['x *a*b* y', 'x \\*a*b* y'],
    ['x _a__ y', 'x \\_a__ y'],
    ['x _a_b_ y', 'x \\_a_b_ y'],
    ['x *a\nb* y', 'x \\*a\nb* y'],
  ])('escapes %j as %j', (source, carve) => {
    expect(escapePlainCarveInlineSyntax(source, HANDLED_PLAIN)).toBe(carve)
    expect(bbcodeToCarve(source + '\n')).toBe(carve + '\n')
    expect(html(carve)).toBe(`<p>${source}</p>`)
  })

  it.each(['5 * 4 * 3', 'a*b*c', '**x**', 'feature_flag_company', 'a ~ b ~ c', '~~x~~'])('leaves %j bare', (source) => {
    expect(escapePlainCarveInlineSyntax(source, HANDLED_PLAIN)).toBe(source)
    expect(html(source)).toBe(`<p>${source}</p>`)
  })
})
