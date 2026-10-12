import { describe, expect, it } from 'vitest'
import { parse, renderHtml } from '../src/index.js'

const normalize = (html: string) => html.replace(/>\s+</g, '><').replace(/\s+</g, '<').replace(/\s+/g, ' ').trim()

describe('ruling Q2 on markup-carve/carve#2978', () => {
  it.each([
    ['named container', `- ::: box
  text
   ::: note
   x
   :::
  :::
tail
`, '<ul><li><div class="box"><p>text</p><aside class="admonition note" aria-label="Note"><p>x</p></aside></div></li></ul><p>tail</p>'],
    ['line block', `- ::: box
  text
    ::: |
    x
    :::
  :::
tail
`, '<ul><li><div class="box"><p>text</p><div class="line-block"><p>x</p></div></div></li></ul><p>tail</p>'],
  ])('%s', (_name, source, expected) => {
    for (const positions of [false, true]) {
      expect(normalize(renderHtml(parse(source, { positions })))).toBe(expected)
    }
  })
})
