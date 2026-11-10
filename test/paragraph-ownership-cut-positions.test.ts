import { describe, expect, it } from 'vitest'
import { parse } from '../src/parse.js'

describe('paragraph positions after ownership cuts', () => {
  it.each([
    '[^a]: x\n[^a]: +\n flush\n\nsee[^a]\n',
    '[^a]: x\n[^a]: +\n  flush\n\nsee[^a]\n',
    '[^a]: x\n[^a]: +\n flush again\n\nsee[^a]\n',
  ])('anchors the handed-back paragraph to its authored text', (source) => {
    const paragraph = parse(source).children.find((node) => node.type === 'paragraph')
    expect(paragraph?.type).toBe('paragraph')
    if (paragraph?.type !== 'paragraph') return
    const text = paragraph.children[0]
    expect(text?.type).toBe('text')
    if (text?.type !== 'text') return
    const expectedStart = source.indexOf('flush')
    expect(paragraph.pos?.startOffset).toBe(expectedStart)
    expect(text.pos?.startOffset).toBe(expectedStart)
    expect(paragraph.pos?.startColumn).toBe(source.slice(source.lastIndexOf('\n', expectedStart - 1) + 1, expectedStart).length + 1)
    expect(source.slice(text.pos!.startOffset, text.pos!.endOffset)).toBe(text.value)
  })
})
