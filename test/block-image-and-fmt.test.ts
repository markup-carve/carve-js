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
