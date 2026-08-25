import { describe, expect, it } from 'vitest'
import { carveToCarve, carveToHtml } from '../src/index.js'

describe('reference label lookup keys', () => {
  it('normalize ASCII whitespace for links and images', () => {
    expect(carveToHtml('[t][ a  b ]\n\n[a b]: /u\n')).toContain('href="/u"')
    expect(carveToHtml('![x][ a\tb ]\n\n[a b]: /i\n')).toContain('src="/i"')
  })

  it('remain case-sensitive and preserve non-ASCII whitespace', () => {
    expect(carveToHtml('[t][A B]\n\n[a b]: /u\n')).not.toContain('href="/u"')
    expect(carveToHtml('[t][a\u00a0b]\n\n[a b]: /u\n')).not.toContain('href="/u"')
  })

  it('does not make a multiline bracket label syntactically valid', () => {
    expect(carveToHtml('[t][a\nb]\n\n[a b]: /u\n')).not.toContain('href="/u"')
  })

  it('uses the last colliding link definition and preserves its spelling', () => {
    const source = '[t][a b]\n\n[a b]: /first\n\n[a  b]: /last\n'
    const rendered = carveToHtml(source)
    expect(rendered, rendered).toContain('href="/last"')
    expect(carveToCarve(source)).toContain('[a  b]: /last')
  })
})
