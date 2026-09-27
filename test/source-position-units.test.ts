import { describe, expect, it } from 'vitest'
import { parse } from '../src/parse.js'

describe('source position units', () => {
  it.each(['a\ud800', 'a\ud800b', 'a\ud800\ud800b', 'a😀b', 'a\udc00b'])('counts the codepoints of %j', (source) => {
    const document = parse(source)
    const paragraph = document.children[0]
    expect(paragraph?.type).toBe('paragraph')
    if (paragraph?.type !== 'paragraph') throw new Error('Expected paragraph')
    const text = paragraph.children[0]
    expect(text?.type).toBe('text')
    expect(text?.pos?.startOffset).toBe(0)
    expect(text?.pos?.endOffset).toBe([...source].length)
    expect(text?.pos?.endColumn).toBe([...source].length + 1)
    expect(paragraph.pos?.endOffset).toBe([...source].length)
  })

  it.each(['\n', '\r\n', '\r'])('converts multiline columns with %j endings', (newline) => {
    const source = ['a', 'b😀c', '', 'd😀e'].join(newline)
    const paragraphs = parse(source).children
    expect(paragraphs).toHaveLength(2)
    for (const paragraph of paragraphs) {
      if (paragraph.type !== 'paragraph') throw new Error('Expected paragraph')
      const text = paragraph.children.at(-1)
      if (text?.type !== 'text') throw new Error('Expected text')
      expect(text.pos?.endColumn).toBe(4)
      expect(paragraph.pos?.endColumn).toBe(4)
      expect([...source].slice(text.pos?.startOffset, text.pos?.endOffset).join('')).toBe(text.value)
    }
  })

  it('maps emoji spans against the original source including its BOM', () => {
    const source = '\ufeff# 😀X\n'
    const heading = parse(source).children[0]
    if (heading?.type !== 'heading') throw new Error('Expected heading')
    const text = heading.children[0]
    expect(text?.pos).toMatchObject({ startOffset: 3, endOffset: 5, startColumn: 4, endColumn: 6 })
    expect([...source].slice(text?.pos?.startOffset, text?.pos?.endOffset).join('')).toBe('😀X')
  })
})
