import { describe, it, expect } from 'vitest'
import {
  escapeAttributeBlockOpener,
  escapeLiteralBackslashes,
  escapePlainCarveInlineSyntax,
  escapeVerbatimDelimiter,
} from '../src/carve-escape.js'
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

describe('a delimiter the caller declared handled keeps its brace bare', () => {
  const render = (src: string) => carveToHtml(src).replace(/\s+/g, ' ').trim()

  // The Djot converters pass `braced: '=+-*_^~'`, which says "my language owns
  // these, do not freeze them as text". `{=x=}` is a highlight in Djot AND in
  // Carve, so the run must survive the conversion untouched. Escaping its inner
  // `=` destroyed it: the mark came back as literal braces and equals signs.
  it('leaves a braced highlight alone when the caller handles it', () => {
    const handled = { braced: '=+-*_^~', bare: '~*_' }
    expect(escapePlainCarveInlineSyntax('a {=x=} b', handled)).toBe('a {=x=} b')
    expect(render('a {=x=} b')).toBe('<p>a <mark>x</mark> b</p>')
  })

  // The inner escape is right when the brace WAS escaped, because a literal
  // brace does not suppress the bare run: an escaped brace around `=x=` still
  // renders a mark.
  it('still escapes the inner delimiter behind an escaped brace', () => {
    expect(escapePlainCarveInlineSyntax('a {=x=} b')).toBe('a \\{\\=x=} b')
    expect(render('a \\{\\=x=} b')).toBe('<p>a {=x=} b</p>')
    expect(escapePlainCarveInlineSyntax('a {~x~} b')).toBe('a \\{\\~x~} b')
    expect(render('a \\{\\~x~} b')).toBe('<p>a {~x~} b</p>')
  })
})

describe('a braced opener with no closer on the line is escaped anyway', () => {
  const render = (src: string) => carveToHtml(src).replace(/\s+/g, ' ').trim()

  // A braced run spans a soft break, and this escaper is line-oriented, so an
  // opener left bare lets the NEXT line close it and two lines of literal text
  // become a superscript.
  it('escapes the opener, which the next line would otherwise close', () => {
    expect(escapePlainCarveInlineSyntax('a {^x b')).toBe('a \\{^x b')
    expect(render('a {^x\ny^} b')).toBe('<p>a <sup>x y</sup> b</p>')
    expect(render('a \\{^x\ny^} b')).toBe('<p>a {^x y^} b</p>')
  })

  it('costs nothing when nothing closes the run', () => {
    expect(render('a \\{^x b')).toBe('<p>a {^x b</p>')
    expect(render('a {^x b')).toBe('<p>a {^x b</p>')
  })

  it('leaves the opener bare when the caller handles that delimiter', () => {
    expect(escapePlainCarveInlineSyntax('a {^x b', { braced: '=+-*_^~', bare: '~*_' })).toBe(
      'a {^x b',
    )
  })

  // An attribute block is not a pair opener. Escaping its brace here would
  // destroy an id a Djot source pinned deliberately, so a language that means
  // literal text by it says so by calling `escapeAttributeBlockOpener`.
  it('leaves an attribute block opener alone', () => {
    expect(escapePlainCarveInlineSyntax('a {#id} b')).toBe('a {#id} b')
    expect(escapePlainCarveInlineSyntax(escapeAttributeBlockOpener('a {#id} b'))).toBe(
      'a \\{\\#id} b',
    )
  })
})

describe('the stages a source language without escapes of its own needs', () => {
  const render = (src: string) => carveToHtml(src).replace(/\s+/g, ' ').trim()
  const tick = '`'

  it('doubles a backslash the author typed', () => {
    expect(escapeLiteralBackslashes('a \\ b')).toBe('a \\\\ b')
    expect(render('a \\ b')).toBe('<p>a &nbsp;b</p>')
    expect(render('a \\\\ b')).toBe('<p>a \\ b</p>')
  })

  it('escapes a literal attribute block opener', () => {
    expect(escapeAttributeBlockOpener('a {#id} c')).toBe('a \\{#id} c')
  })

  it('escapes a literal verbatim delimiter, paired or not', () => {
    expect(escapeVerbatimDelimiter(`a ${tick}code${tick} b`)).toBe(`a \\${tick}code\\${tick} b`)
    expect(escapeVerbatimDelimiter(`x ${tick} y`)).toBe(`x \\${tick} y`)
    expect(render(`x \\${tick} y`)).toBe(`<p>x ${tick} y</p>`)
  })

  // The doubling stage runs first, so every backslash run reaching the two
  // stages after it is EVEN and the delimiter behind one is still escaped. A
  // single-character guard read a doubled backslash before a brace as an
  // escaped brace and let the construct through.
  it('counts the backslash run rather than testing one character', () => {
    expect(escapeAttributeBlockOpener(escapeLiteralBackslashes('a \\{#id} c'))).toBe(
      'a \\\\\\{#id} c',
    )
    expect(escapeVerbatimDelimiter(escapeLiteralBackslashes(`a \\${tick} b`))).toBe(
      `a \\\\\\${tick} b`,
    )
  })

  // Escaping an already-escaped delimiter a second time is worse than leaving
  // it: the doubled backslash renders as a literal backslash and frees the
  // delimiter the first escape was suppressing.
  it('leaves an already-escaped delimiter alone', () => {
    expect(escapeVerbatimDelimiter(`a \\${tick} b`)).toBe(`a \\${tick} b`)
    expect(escapeAttributeBlockOpener('a \\{#id} c')).toBe('a \\{#id} c')
  })
})
