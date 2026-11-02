import { describe, expect, it } from 'vitest'
import { carveToCarve, carveToHtml, renderCarve, SourceUnspellableError, type Document } from '../src/index.js'

const tag = (name: string) => `<span class="tag"><strong>#${name}</strong></span>`
const html = (src: string) => carveToHtml(`${src}\n`).trim()

describe('a mention or tag name holds an ASCII letter (carve#4809)', () => {
  it('keeps digit-only names as text', () => {
    expect(html('See issue #123, #1 priority and #fff.')).toBe(`<p>See issue #123, #1 priority and ${tag('fff')}.</p>`)
  })

  it.each([
    ['#1.2', '#1.2'], ['#1-2', '#1-2'], ['#-1', '#-1'], ['#_1', '#_1'], ['#1.', '#1.'], ['#1#a', '#1#a'],
    ['#123{.k}', '#123{.k}'], ['#v2', tag('v2')], ['#1a', tag('1a')], ['#1.a.', `${tag('1.a')}.`], ['#-a', tag('-a')],
    ['@5', '@5'], ['@_', '@_'], ['@1@a', '@1@a'], ['@1.a', '<span class="mention"><strong>@1.a</strong></span>'],
  ])('renders %s', (src, out) => {
    expect(html(src)).toBe(`<p>${out}</p>`)
  })

  it('takes no caption placeholder from a # before a name character (carve#4642)', () => {
    expect(html('| a |\n^ Figure #1 q\n\nPaid @5 today and see #123')).toBe(
      '<table>\n  <caption>Figure #1 q</caption>\n  <tbody>\n    <tr><td>a</td></tr>\n  </tbody>\n</table>\n<p>Paid @5 today and see #123</p>',
    )
    expect(html('![p](p.png)\n^ Fig #1 #')).toContain('<figcaption>Fig #1 1</figcaption>')
    expect(html('![p](p.png)\n^ Fig #_')).toContain('<figcaption>Fig #_</figcaption>')
  })

  it('reads a name cut back to digits by a closing underline as text', () => {
    expect(html('_x #1_ y')).toBe('<p><u>x #1</u> y</p>')
    expect(html('_x @1_-a y')).toBe('<p><u>x @1</u>-a y</p>')
  })

  it('writes a digit-only name so it stays text', () => {
    expect(carveToHtml(carveToCarve('#123 and @5\n'))).toBe(carveToHtml('#123 and @5\n'))
  })

  it('refuses to write a letterless name the parser would read as text', () => {
    const doc = { type: 'document', children: [{ type: 'paragraph', children: [{ type: 'tag', name: '123' }] }] } as unknown as Document
    expect(() => renderCarve(doc)).toThrow(SourceUnspellableError)
  })
})
