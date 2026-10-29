import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

// Glued brackets pair up left to right: the second bracket of `[b][a]` is a
// reference label, so a `(...)` after it is text and a closer inside it closes.
const html = (src: string) => carveToHtml(src).trimEnd()

describe('a reference label takes no destination in the closer walk', () => {
  it('closes inside the parentheses after a reference pair', () => {
    expect(html('*[b][a](u*) c*')).toBe('<p><strong>[b][a](u</strong>) c*</p>')
    expect(html('*![i][a](u*) c*')).toBe('<p><strong>![i][a](u</strong>) c*</p>')
    expect(html('*[b][](u*) c*')).toBe('<p><strong>[b][](u</strong>) c*</p>')
  })

  it('closes inside a title and for the combined and braced tokens', () => {
    expect(html('*[b][a](u "t*") c*')).toBe('<p><strong>[b][a](u “t</strong>”) c*</p>')
    expect(html('/*[b][a](u*/) c*/')).toBe('<p><strong><em>[b][a](u</em></strong>) c*/</p>')
    expect(html('{*[b][a](u*}) c*}')).toBe('<p><strong>[b][a](u</strong>) c*}</p>')
  })

  it('reads the third glued bracket as link text again', () => {
    expect(html('*[b][a][c](u*) c*')).toBe('<p><strong>[b][a]<a href="u*">c</a> c</strong></p>')
  })

  it('keeps the destination in the editorial scans, which read the core nested rule', () => {
    expect(html('{+[b][a](u+}) c+}')).toBe('<p><ins>[b][a](u+}) c</ins></p>')
    expect(html('{-[b][a](u-}) c-}')).toBe('<p><del>[b][a](u-}) c</del></p>')
    expect(html('{~x~>[b][a](u~}) c~}')).toBe('<p><del>x</del><ins>[b][a](u~}) c</ins></p>')
    expect(html('{~[b][a](u~}) c~}')).toBe('<p><s>[b][a](u</s>) c~}</p>')
    expect(html('{~[b][a](u~})~>x~}')).toBe('<p><del>[b][a](u~})</del><ins>x</ins></p>')
  })

  it('does not start a pair at a footnote or note bracket', () => {
    expect(html('*[^n][a](u*) c*')).toBe('<p><strong>[^n]<a href="u*">a</a> c</strong></p>')
  })
})
