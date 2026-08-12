import { describe, it, expect } from 'vitest'
import { escapePlainCarveInlineSyntax } from '../src/carve-escape.js'
import { carveToHtml } from '../src/index.js'

describe('a hash in source text is not a Carve tag', () => {
  const roundTrip = (src: string) => carveToHtml(escapePlainCarveInlineSyntax(src)).replace(/\s+/g, ' ').trim()

  it('escapes a bare hashtag, which no source language shares', () => {
    expect(escapePlainCarveInlineSyntax('a #y b')).toBe('a \\#y b')
    expect(roundTrip('a #y b')).toBe('<p>a #y b</p>')
  })

  it('covers the braced form through the same rule', () => {
    expect(roundTrip('{#y#} x')).toBe('<p>{#y#} x</p>')
  })

  it('leaves a heading alone: `#` followed by a space is shared', () => {
    expect(escapePlainCarveInlineSyntax('# Heading')).toBe('# Heading')
  })

  it('leaves an intraword hash alone, which is not a tag either', () => {
    expect(escapePlainCarveInlineSyntax('a#y b')).toBe('a#y b')
  })

  it('leaves a numeric character reference decodable', () => {
    expect(escapePlainCarveInlineSyntax('a &#8212; b')).toBe('a &#8212; b')
    expect(escapePlainCarveInlineSyntax('a &#x2014; b')).toBe('a &#x2014; b')
  })

  it('opts out for a language that owns the hash', () => {
    expect(escapePlainCarveInlineSyntax('a #y b', { bare: '#' })).toBe('a #y b')
  })
})

describe('an escaped brace does not suppress the delimiter after it', () => {
  const roundTrip = (src: string) => carveToHtml(escapePlainCarveInlineSyntax(src)).replace(/\s+/g, ' ').trim()

  // Ported from carve-php#1196, which this engine never received: `*` and `_`
  // kept the pre-fix spelling, so a braced pair rendered as markup.
  it('escapes the inner delimiter of a braced strong and underline', () => {
    expect(roundTrip('{*y*} x')).toBe('<p>{*y*} x</p>')
    expect(roundTrip('{_y_} x')).toBe('<p>{_y_} x</p>')
  })

  it('still leaves the word-bounded negatives bare', () => {
    expect(escapePlainCarveInlineSyntax('a*b*c')).toBe('a*b*c')
    expect(escapePlainCarveInlineSyntax('feature_flag_company')).toBe('feature_flag_company')
  })
})
