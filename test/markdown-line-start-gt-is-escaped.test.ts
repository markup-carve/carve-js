import { describe, expect, it } from 'vitest'
import { htmlToAst, parse, renderMarkdown } from '../src/index.js'

const fromHtml = (html: string) => renderMarkdown(htmlToAst(html).value)

// A text `>` at a paragraph line's content position opens a block quote in any
// CommonMark reader, so it is escaped there and only there (carve-js#2113).
describe('a line-start > in paragraph text stays text', () => {
  it('escapes it at a paragraph start', () => {
    expect(fromHtml('<p>&gt; quote</p>')).toBe('\\> quote\n')
  })

  it('escapes it after a hard break', () => {
    expect(fromHtml('<p>word<br>&gt; quote</p>')).toBe('word\\\n\\> quote\n')
  })

  it('escapes it inside a list item', () => {
    expect(fromHtml('<ul><li>&gt; x</li></ul>')).toBe('- \\> x\n')
  })

  it('escapes it inside a block quote', () => {
    expect(fromHtml('<blockquote><p>&gt; x</p></blockquote>')).toBe('> \\> x\n')
  })

  it('escapes it with no space after it', () => {
    expect(fromHtml('<p>&gt;&gt;x</p>')).toBe('\\>>x\n')
  })

  it('leaves a mid-line > bare', () => {
    expect(fromHtml('<p>a &gt; b</p>')).toBe('a > b\n')
  })

  it('escapes it after a soft break in a Carve tree', () => {
    expect(renderMarkdown(parse('word\n>b\n'))).toBe('word\n\\>b\n')
  })

  it('keeps the bytes of an authored Carve escape', () => {
    expect(renderMarkdown(parse('\\> quote\n'))).toBe('\\> quote\n')
    expect(renderMarkdown(parse('a \\> b\n'))).toBe('a \\> b\n')
    expect(renderMarkdown(parse('word\\\n\\> q\n'))).toBe('word\\\n\\> q\n')
  })
})
