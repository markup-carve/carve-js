import { describe, expect, it } from 'vitest'
import type { CarveExtension } from '../src/extension.js'
import { MAX_NESTING_DEPTH, parse } from '../src/parse.js'
import { renderHtml } from '../src/render-html.js'

const quotes: CarveExtension = { name: 'quotes', quoteCharacters: ['«', '»', '‹', '›'] }

describe('parse sessions', () => {
  it('keeps explicit fragment context while a separate parse uses its own options', () => {
    const expectedNested = renderHtml(parse('"independent"'))
    let nested = ''
    const extension: CarveExtension = {
      name: 'nested',
      matchInline(text, pos, context) {
        if (text[pos] !== '§') return null
        nested = renderHtml(parse('"independent"'))
        return { node: { type: 'span', children: context.parseInlines('"child"') }, end: pos + 1 }
      },
    }
    const result = renderHtml(parse('"outer" §', { extensions: [quotes, extension] }))
    expect(nested).toBe(expectedNested)
    expect(result).toContain('«outer»')
    expect(result).toContain('«child»')
  })

  it('does not retain quote settings if reading an option throws before scanning', () => {
    const expected = renderHtml(parse('"plain"'))
    expect(() => parse('"broken"', {
      extensions: [quotes],
      get defaultFrontmatterFormat(): string { throw new Error('option unavailable') },
    })).toThrow('option unavailable')
    expect(renderHtml(parse('"plain"'))).toBe(expected)
  })

  it('bounds an extension that recursively calls the public parser', () => {
    let calls = 0
    const extension: CarveExtension = {
      name: 'recursive',
      matchInline(text, pos) {
        if (text[pos] !== '§') return null
        calls++
        parse('§', { extensions: [extension] })
        return { node: { type: 'text', value: 'done' }, end: pos + 1 }
      },
    }
    expect(renderHtml(parse('§', { extensions: [extension] }))).toBe('<p>done</p>')
    expect(calls).toBeGreaterThan(1)
    expect(calls).toBeLessThanOrEqual(MAX_NESTING_DEPTH)
    expect(renderHtml(parse('/next/'))).toBe('<p><em>next</em></p>')
  })
})
