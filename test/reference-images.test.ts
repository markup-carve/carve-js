import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'

const h = (s: string) => carveToHtml(s)

describe('reference images ![alt][ref]', () => {
  it('full reference resolves to an image with title', () => {
    expect(h('![alt][ref]\n\n[ref]: /img.png "cap"')).toBe(
      '<img src="/img.png" alt="alt" title="cap">',
    )
  })

  it('collapsed ![alt][] uses the alt as the label', () => {
    expect(h('![alt][]\n\n[alt]: /i.png "t"')).toBe('<img src="/i.png" alt="alt" title="t">')
  })

  it('full form allows an empty alt (label is the ref)', () => {
    expect(h('![][ref]\n\n[ref]: /u')).toBe('<img src="/u" alt="">')
  })

  it('trailing attributes apply to the image', () => {
    expect(h('![alt][ref]{.c #i}\n\n[ref]: /i.png')).toBe(
      '<img src="/i.png" alt="alt" class="c" id="i">',
    )
  })

  it('alt is raw text (markup not parsed), like an inline image', () => {
    expect(h('![a *b* c][ref]\n\n[ref]: /i.png')).toBe('<img src="/i.png" alt="a *b* c">')
  })

  it('nested brackets in the alt are balanced', () => {
    expect(h('![a [b] c][ref]\n\n[ref]: /u')).toBe('<img src="/u" alt="a [b] c">')
  })

  it('an unresolved reference is literal', () => {
    expect(h('![alt][nope]')).toBe('<p>![alt][nope]</p>')
  })

  it('labels are case-sensitive (like reference links)', () => {
    expect(h('![a][REF]\n\n[ref]: /u')).toBe('<p>![a][REF]</p>')
  })

  it('the shortcut form ![alt] is NOT a reference image', () => {
    expect(h('![alt]\n\n[alt]: /i.png')).toBe('<p>![alt]</p>')
  })

  it('an inline image wins over a same-named reference', () => {
    expect(h('![alt](/inline.png)\n\n[alt]: /ref.png')).toBe('<img src="/inline.png" alt="alt">')
  })

  it('stays inline (in <p>) when other content shares the line', () => {
    expect(h('x ![a][ref]\n\n[ref]: /u')).toBe('<p>x <img src="/u" alt="a"></p>')
  })

  it('a reference link and a reference image coexist', () => {
    expect(h('[alt][ref] and ![alt][ref]\n\n[ref]: /u')).toBe(
      '<p><a href="/u">alt</a> and <img src="/u" alt="alt"></p>',
    )
  })

  it('a resolved reference image + caption becomes a <figure>', () => {
    expect(h('![a][r]\n^ cap\n\n[r]: /u')).toBe(
      '<figure>\n  <img src="/u" alt="a">\n  <figcaption>cap</figcaption>\n</figure>',
    )
  })

  it('the caption keeps its inline markup', () => {
    expect(h('![a][r]\n^ *b* c\n\n[r]: /u')).toBe(
      '<figure>\n  <img src="/u" alt="a">\n  <figcaption><strong>b</strong> c</figcaption>\n</figure>',
    )
  })

  it('a collapsed reference image + caption becomes a <figure>', () => {
    expect(h('![a][]\n^ cap\n\n[a]: /u')).toBe(
      '<figure>\n  <img src="/u" alt="a">\n  <figcaption>cap</figcaption>\n</figure>',
    )
  })

  it('an unresolved reference image + caption stays literal (no figure)', () => {
    expect(h('![a][nope]\n^ cap')).toBe('<p>![a][nope]\n^ cap</p>')
  })

  it('leading text before the image is not a figure', () => {
    expect(h('x ![a][r]\n^ cap\n\n[r]: /u')).toBe('<p>x <img src="/u" alt="a">\n^ cap</p>')
  })
})
