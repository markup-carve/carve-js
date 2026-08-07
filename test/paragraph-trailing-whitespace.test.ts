import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'

const h = (s: string) => carveToHtml(s)

/**
 * A paragraph's FINAL trailing whitespace is stripped before inline parsing
 * (CommonMark / djot / carve-php all do this), so `abc ` is `<p>abc</p>` and a
 * bare `# ` (hash + space, not a heading) is `<p>#</p>`.
 *
 * Only the whitespace at the very END of the paragraph is dropped. Interior
 * line trailing whitespace before a soft break is KEPT verbatim, because in
 * Carve two trailing spaces are NOT a hard break (only a backslash at end of
 * line is). A backslash hard break is never affected. Verified against
 * carve-php.
 */
describe('paragraph trailing whitespace', () => {
  it('strips a single trailing space', () => {
    expect(h('abc ')).toBe('<p>abc</p>')
  })

  it('strips a trailing tab', () => {
    expect(h('abc\t')).toBe('<p>abc</p>')
  })

  it('treats a bare hash + space as a paragraph and strips the trailing space', () => {
    expect(h('# ')).toBe('<p>#</p>')
  })

  it('requires an ASCII space after a heading marker, not a tab', () => {
    expect(h('#\tH')).toBe('<p>#\tH</p>')
  })

  it('leaves a paragraph with no trailing whitespace unchanged', () => {
    expect(h('abc')).toBe('<p>abc</p>')
  })

  it('drops interior trailing spaces before a soft break too', () => {
    // Two trailing spaces mid-paragraph are still NOT a hard break - a hard
    // break in Carve is a backslash - and they are no longer preserved either.
    // NO TRAILING WHITESPACE (PART 2; carve#926) holds on EVERY content line.
    //
    // This asserted the opposite, from PART 12 section 7, which said twice and
    // at length that the run before a soft break survives, gave `<p>a \nb</p>`
    // as the rendering, and argued from that claim that a formatter stripping it
    // corrupts the document. The executable spec never rendered it that way, and
    // the clause has been corrected.
    expect(h('a  \nb')).toBe('<p>a\nb</p>')
  })

  it('makes a document with the run and one without it the same document', () => {
    // The property behind the rule, which the two literals above only sample.
    expect(h('abc \ndef')).toBe(h('abc\ndef'))
    expect(h('abc\t\ndef\t')).toBe(h('abc\ndef'))
    expect(h('a  \nb  ')).toBe('<p>a\nb</p>')
  })

  it('preserves a backslash hard break', () => {
    expect(h('a\\\nb')).toBe('<p>a<br>\nb</p>')
  })

  it('leaves leading whitespace handling unchanged', () => {
    expect(h('  abc  ')).toBe('<p>abc</p>')
  })
})
