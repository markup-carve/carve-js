import { describe, it, expect } from 'vitest'
import { carveToMarkdown, carveToPlainText, carveToAnsi, carveToCarve, carveToHtml } from '../src/index.js'

const strip = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '')

describe('block-level image emits a trailing block separator (non-HTML)', () => {
  it('markdown: a following block is not glued to the image', () => {
    expect(carveToMarkdown('![a](/u)\n\ntext')).toBe('![a](/u)\n\ntext\n')
    expect(carveToMarkdown('![a](/u)\n\n![b](/u)')).toBe('![a](/u)\n\n![b](/u)\n')
  })

  it('plain: a following block is separated', () => {
    expect(carveToPlainText('![a](/u)\n\ntext')).toBe('a\n\ntext\n')
  })

  it('ansi: two block images are separated', () => {
    expect(strip(carveToAnsi('![a](/u)\n\n![b](/u)'))).toBe('[img: a]\n\n[img: b]\n')
  })
})

describe('fmt of an unresolved reference image round-trips verbatim', () => {
  const inv = (src: string) => expect(carveToHtml(carveToCarve(src))).toBe(carveToHtml(src))

  it('emits the verbatim source, not ![alt]()', () => {
    expect(carveToCarve('![a][nope]').trim()).toBe('![a][nope]')
    inv('![a][nope]')
  })

  it('preserves the invariant with surrounding text', () => {
    expect(carveToCarve('x ![a][nope] y').trim()).toBe('x ![a][nope] y')
    inv('x ![a][nope] y')
  })

  it('a resolved reference image normalizes to the inline form', () => {
    expect(carveToCarve('![alt][ref]\n\n[ref]: /u "t"').trim()).toBe('![alt](/u "t")')
    inv('![alt][ref]\n\n[ref]: /u "t"')
  })
})

// A figure caption must serialize as an UNESCAPED `^ …` line: escaping the
// caret to `\^` only round-trips in carve-js's lenient parser; carve-rs and
// carve-php read `\^` as literal text and lose the figure. carveToCarve runs
// promoteBlockImages so every image+caption (direct, resolved-ref, or one with
// a tricky title) becomes a <figure> whose caption is emitted verbatim.
describe('fmt emits an unescaped figure caption (portable round-trip)', () => {
  const inv = (src: string) => expect(carveToHtml(carveToCarve(src))).toBe(carveToHtml(src))

  it('resolved reference image + caption', () => {
    expect(carveToCarve('![a][r]\n^ cap\n\n[r]: /u').trim()).toBe('![a](/u)\n^ cap')
    inv('![a][r]\n^ cap\n\n[r]: /u')
  })

  it('reference image with attributes + caption', () => {
    expect(carveToCarve('![a][r]{.c}\n^ cap\n\n[r]: /u').trim()).toBe('![a](/u){.c}\n^ cap')
    inv('![a][r]{.c}\n^ cap\n\n[r]: /u')
  })

  it('direct image with an escaped-quote title + caption', () => {
    expect(carveToCarve('![a](/u "t\\"i")\n^ cap').trim()).toBe('![a](/u "t\\"i")\n^ cap')
    inv('![a](/u "t\\"i")\n^ cap')
  })

  it('an UNresolved reference image is not a figure: its caret stays escaped', () => {
    expect(carveToCarve('![a][nope]\n^ cap').trim()).toBe('![a][nope]\n\\^ cap')
    inv('![a][nope]\n^ cap')
  })

  it('a leading block-attribute line is kept on a promoted reference figure', () => {
    expect(carveToCarve('{#f}\n![a][r]\n^ cap\n\n[r]: /u').trim()).toBe('{#f}\n![a](/u)\n^ cap')
    inv('{#f}\n![a][r]\n^ cap\n\n[r]: /u')
  })

  it('a leading block-attribute line survives a captionless reference image', () => {
    // The sole-image -> block-image promotion is skipped when formatting, so the
    // paragraph keeps the `{#f}` line a bare block image could not carry. Byte
    // output matches carve-rs / carve-php. (No `inv()` here: an attributed
    // reference sole-image has a PRE-EXISTING carve-js/-rs HTML divergence -- the
    // `{#f}` is dropped on the reference form but kept on the resolved direct
    // form -- so the round-trip changes the id independently of this change.)
    expect(carveToCarve('{#f}\n![a][r]\n\n[r]: /u').trim()).toBe('{#f}\n![a](/u)')
  })
})
