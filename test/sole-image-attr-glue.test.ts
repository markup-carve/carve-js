import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'

describe('sole-image block promotion: attribute block must be glued', () => {
  it('attaches a GLUED trailing attribute block to the bare image', () => {
    expect(carveToHtml('![a](/u){k=v}')).toBe('<img src="/u" alt="a" k="v">')
  })

  it('keeps a SPACE-separated attribute block literal (image inlines in a paragraph)', () => {
    expect(carveToHtml('![a](/u) {k=v}')).toBe('<p><img src="/u" alt="a"> {k=v}</p>')
  })

  it('attaches a glued attribute block after a title', () => {
    expect(carveToHtml('![a](/u "t"){#id}')).toBe('<img src="/u" alt="a" title="t" id="id">')
  })

  it('keeps a space-separated block literal after a title', () => {
    expect(carveToHtml('![a](/u "t") {k=v}')).toBe('<p><img src="/u" alt="a" title="t"> {k=v}</p>')
  })

  it('still attaches a leading block-attribute line to the following bare image', () => {
    expect(carveToHtml('{#id}\n![a](/u)')).toBe('<img src="/u" alt="a" id="id">')
  })

  it('leaves a plain bare image unchanged', () => {
    expect(carveToHtml('![a](/u)')).toBe('<img src="/u" alt="a">')
  })
})
