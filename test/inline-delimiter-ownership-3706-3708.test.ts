import { describe, expect, it } from 'vitest'
import { parse, renderHtml, resolve } from '../src/index.js'

const html = (source: string) => renderHtml(resolve(parse(source)))

describe('inline delimiter ownership', () => {
  it('leaves a combined opener literal before unclosed code', () => {
    expect(html('/*`*/')).toBe('<p>/*<code>*/</code></p>')
    expect(html('/*x*/')).toBe('<p><strong><em>x</em></strong></p>')
  })

  it.each(['*', '~', '=', '_'])('does not reuse a %s opener mark as a closer', (mark) => {
    const source = `{${mark}{${mark}}`
    expect(html(source)).toBe(`<p>${source}</p>`)
  })

  it.each([
    ['{-{-}', '<p><del>{</del></p>'],
    ['{+{+}', '<p><ins>{</ins></p>'],
  ])('lets a brace begin editorial content in %s', (source, expected) => {
    expect(html(source)).toBe(expected)
  })
})
