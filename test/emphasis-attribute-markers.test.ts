import { describe, expect, it } from 'vitest'
import { htmlToCarve, parse, renderCarve, renderHtml } from '../src/index.js'

describe('attribute markers inside emphasis', () => {
  it('preserves the shared HTML import target', () => {
    const html = '<p>a <strong><span id="id" key="*">b</span></strong></p>'
    const result = htmlToCarve(html)
    expect(result.value).toBe('a {*[b]{#id key="*"}*}\n')
    expect(renderHtml(parse(result.value)).trim()).toBe(html)
  })

  it.each(['*', '/', '_', '~', '=', '^', ',', '+', '-'])('keeps %s inside a child attribute', marker => {
    const source = `{${marker}[b]{key="${marker}"}${marker}}`
    const before = renderHtml(parse(source))
    const written = renderCarve(parse(source))
    expect(renderHtml(parse(written))).toBe(before)
    expect(renderCarve(parse(written))).toBe(written)
  })

  it.each(['/*[b]{key="/"}*/', '/*[b]{key="*"}*/', '{_[b]{id="a_"}_}', '{_[b]{class="a_"}_}', '{*[b]{key="*}"}*}', '{*[/b/]{key="*"}*}'])('retains attributes in %s', source => {
    const written = renderCarve(parse(source))
    expect(renderHtml(parse(written))).toBe(renderHtml(parse(source)))
    expect(renderCarve(parse(written))).toBe(written)
  })

  it('keeps unrelated attribute spelling', () => {
    expect(renderCarve(parse('*[b]{#id key=x}*'))).toBe('*[b]{#id key=x}*\n')
  })
})
