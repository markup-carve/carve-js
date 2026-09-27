import { describe, expect, it } from 'vitest'
import { parse } from '../src/parse.js'
import { renderCarve } from '../src/render-carve.js'

describe('source render sessions', () => {
  it('keeps nested rendering from changing an outer document', () => {
    const document = parse('```\n x \n```\n\ntrigger\n')
    const nested = parse('```\n\ue001 \n```\n')
    const expected = renderCarve(document)
    const paragraph = document.children[1]
    if (paragraph?.type !== 'paragraph') throw new Error('Expected paragraph')
    const text = paragraph.children[0]
    if (text?.type !== 'text') throw new Error('Expected text')
    let calls = 0
    Object.defineProperty(text, 'value', {
      enumerable: true,
      get() {
        calls++
        renderCarve(nested)
        return 'trigger'
      },
    })
    expect(renderCarve(document)).toBe(expected)
    expect(calls).toBeGreaterThan(0)
  })

  it.each([1, 5, 10])('starts fresh after a tree throws on read %i', (throwAt) => {
    const document = parse('```\n x \n```\n\ntrigger\n')
    const paragraph = document.children[1]
    if (paragraph?.type !== 'paragraph') throw new Error('Expected paragraph')
    const text = paragraph.children[0]
    if (text?.type !== 'text') throw new Error('Expected text')
    let reads = 0
    Object.defineProperty(text, 'value', {
      enumerable: true,
      get() {
        if (++reads === throwAt) throw new Error('interrupted render')
        return 'trigger'
      },
    })
    expect(() => renderCarve(document)).toThrow('interrupted render')
    expect(reads).toBe(throwAt)
    const source = '```\n x \n```\n\ntext\n'
    expect(renderCarve(parse(source))).toBe(source)
  })
})
