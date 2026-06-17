import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'
import { autolink } from '../src/autolink.js'

/**
 * Links never nest (CommonMark: a link may not contain another link). A link
 * found inside another link's text is unwrapped to its text; only the
 * outermost destination applies. Enforced as a post-resolution pass, so it
 * also covers links produced by reference and crossref resolution.
 */
describe('links never nest', () => {
  const h = (src: string, ext = false) =>
    carveToHtml(src, ext ? { extensions: [autolink()] } : {}).replace(/\n\s*/g, ' ').trim()

  it('explicit nested inline link unwraps to text, outer destination wins', () => {
    expect(h('[[x](y)](z)')).toBe('<p><a href="z">x</a></p>')
  })

  it('autolink extension inside a link label becomes the label text', () => {
    expect(h('[https://x.com](https://y.com)', true)).toBe(
      '<p><a href="https://y.com">https://x.com</a></p>',
    )
  })

  it('core angle autolink inside a link label becomes plain text', () => {
    expect(h('[pre <http://h> post](/u)')).toBe('<p><a href="/u">pre http://h post</a></p>')
  })

  it('mailto autolink in a label drops the scheme in its display text', () => {
    expect(h('[mail <a@b.com> here](/u)')).toBe('<p><a href="/u">mail a@b.com here</a></p>')
  })

  it('a link buried in emphasis inside a label is still unwrapped', () => {
    expect(h('[*em https://x.com*](/u)', true)).toBe(
      '<p><a href="/u"><strong>em https://x.com</strong></a></p>',
    )
  })

  it('an unresolved nested reference link keeps its literal source', () => {
    expect(h('[[x][missing]](/z)')).toBe('<p><a href="/z">[x][missing]</a></p>')
  })

  it('a resolved nested reference link unwraps to its display text', () => {
    expect(h('[good]: /g\n\n[[x][good]](/z)')).toBe('<p><a href="/z">x</a></p>')
  })

  it('a crossref inside a link label resolves then unwraps to text', () => {
    expect(h('# H\n\n[see </#H>](/outer)')).toContain('<a href="/outer">see H</a>')
    expect(h('# H\n\n[see </#H>](/outer)')).not.toContain('<a href="/outer">see <a')
  })

  it('a top-level autolink (not in a label) still links', () => {
    expect(h('plain https://x.com here', true)).toBe(
      '<p>plain <a href="https://x.com">https://x.com</a> here</p>',
    )
  })

  it('literal brackets in a label are preserved (no link formed)', () => {
    expect(h('[a [b] c](/u)')).toBe('<p><a href="/u">a [b] c</a></p>')
  })

  it('a link inside a footnote body in a label survives in the endnotes', () => {
    const html = h('[x ^[see [y](/inner)]](/outer)')
    expect(html).toContain('see <a href="/inner">y</a>')
  })
})
