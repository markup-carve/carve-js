import { describe, expect, it } from 'vitest'
import { parse } from '../src/index.js'

describe('source spans', () => {
  it('adds absolute offsets and columns to block nodes', () => {
    const doc = parse('Intro\n\n# Title\n')

    expect(doc.children[0]!.pos).toMatchObject({
      startLine: 1,
      endLine: 1,
      startColumn: 1,
      endColumn: 6,
      startOffset: 0,
      endOffset: 5,
    })
    expect(doc.children[1]!.pos).toMatchObject({
      startLine: 3,
      endLine: 3,
      startColumn: 1,
      endColumn: 8,
      startOffset: 7,
      endOffset: 14,
    })
  })

  it('adds exact spans to inline nodes', () => {
    const doc = parse('Hi /there/ @mark\nnext')
    const para = doc.children[0]
    expect(para?.type).toBe('paragraph')
    if (para?.type !== 'paragraph') return

    expect(para.children.map((node) => [node.type, node.pos])).toMatchObject([
      [
        'text',
        {
          startLine: 1,
          endLine: 1,
          startColumn: 1,
          endColumn: 4,
          startOffset: 0,
          endOffset: 3,
        },
      ],
      [
        'emphasis',
        {
          startLine: 1,
          endLine: 1,
          startColumn: 4,
          endColumn: 11,
          startOffset: 3,
          endOffset: 10,
        },
      ],
      [
        'text',
        {
          startLine: 1,
          endLine: 1,
          startColumn: 11,
          endColumn: 12,
          startOffset: 10,
          endOffset: 11,
        },
      ],
      [
        'mention',
        {
          startLine: 1,
          endLine: 1,
          startColumn: 12,
          endColumn: 17,
          startOffset: 11,
          endOffset: 16,
        },
      ],
      [
        'soft_break',
        {
          startLine: 1,
          endLine: 2,
          startColumn: 17,
          endColumn: 1,
          startOffset: 16,
          endOffset: 17,
        },
      ],
      [
        'text',
        {
          startLine: 2,
          endLine: 2,
          startColumn: 1,
          endColumn: 5,
          startOffset: 17,
          endOffset: 21,
        },
      ],
    ])
  })

  it('adds spans to nested inline children', () => {
    const doc = parse('See [a /b/](https://example.com)')
    const para = doc.children[0]
    expect(para?.type).toBe('paragraph')
    if (para?.type !== 'paragraph') return
    const link = para.children[1]
    expect(link?.type).toBe('link')
    if (link?.type !== 'link') return

    expect(link.pos).toMatchObject({
      startOffset: 4,
      endOffset: 32,
      startColumn: 5,
      endColumn: 33,
    })
    expect(link.children[1]?.pos).toMatchObject({
      startOffset: 7,
      endOffset: 10,
      startColumn: 8,
      endColumn: 11,
    })
  })
})
