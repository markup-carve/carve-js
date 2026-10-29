import { describe, expect, it } from 'vitest'
import { parse, renderHtml, resolve } from '../src/index.js'

const html = (source: string) => renderHtml(resolve(parse(source)))

describe('inline delimiter ownership', () => {
  it('leaves a combined opener literal before unclosed code', () => {
    expect(html('/*`*/')).toBe('<p>/*<code>*/</code></p>')
    expect(html('/*x*/')).toBe('<p><strong><em>x</em></strong></p>')
  })

  // `{X}` is characters (carve#3973 X6), so its X closes the outer pair.
  it.each([
    ['*', 'strong'],
    ['~', 's'],
    ['=', 'mark'],
    ['_', 'u'],
  ])('reads the %s of an empty brace group as a closer', (mark, tag) => {
    expect(html(`{${mark}{${mark}}`)).toBe(`<p><${tag}>{</${tag}></p>`)
  })

  it.each([
    ['{-{-}', '<p><del>{</del></p>'],
    ['{+{+}', '<p><ins>{</ins></p>'],
  ])('lets a brace begin editorial content in %s', (source, expected) => {
    expect(html(source)).toBe(expected)
  })
})
