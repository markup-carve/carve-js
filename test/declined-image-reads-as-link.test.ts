import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

describe('a declined image uses the link bracket rule (carve#4803)', () => {
  it('forms a destination link after the alt close inside a braced comment', () => {
    expect(carveToHtml('![a{% ] %}b](/u)')).toBe('<p>!<a href="/u">ab</a></p>')
  })

  it('forms a reference link after the same close', () => {
    expect(carveToHtml('![a{% ] %}b][r]\n\n[r]: /u')).toBe('<p>!<a href="/u">ab</a></p>')
  })

  it('keeps formed images and balanced brackets', () => {
    expect(carveToHtml('![a{% c %}b](/u)')).toBe('<img src="/u" alt="a{% c %}b">')
    expect(carveToHtml('![a [b] c](/u)')).toBe('<img src="/u" alt="a [b] c">')
  })
})
