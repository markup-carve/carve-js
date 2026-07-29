import { describe, it, expect } from 'vitest'
import { carveToMarkdown } from '../src/index.js'

/**
 * CommonMark does not honour an intraword underscore, so escaping one protects
 * nothing and only litters identifiers in output meant to be read and searched.
 * An asterisk is not symmetric here - `a*b*c` does emphasise - so `*` stays
 * escaped everywhere.
 */
describe('markdown underscore escaping', () => {
  it.each(['company_id', 'a_b_c', 'snake_case_name', 'read_write_delete'])(
    'leaves an intraword underscore bare in %j',
    (source) => {
      expect(carveToMarkdown(source).trim()).toBe(source)
    },
  )

  it.each([
    ['trailing_', 'trailing\\_'],
    ['_leading', '\\_leading'],
  ])('still escapes %j where it could open or close emphasis', (source, expected) => {
    expect(carveToMarkdown(source).trim()).toBe(expected)
  })

  it('still escapes an asterisk between word characters', () => {
    // `a*b*c` emphasises in CommonMark, so this one has to stay escaped.
    expect(carveToMarkdown('a*b*c').trim()).toBe('a\\*b\\*c')
  })

  it('leaves code spans alone', () => {
    expect(carveToMarkdown('`code_span`').trim()).toBe('`code_span`')
  })

  /**
   * A backslash the author typed is content, not an escape this renderer added.
   * The de-escaping used to run over the assembled document, where it could not
   * tell the two apart, and rewrote verbatim regions that carry a literal
   * backslash before an underscore (issue 400).
   */
  describe('does not touch a backslash it did not write', () => {
    it('keeps a code span verbatim', () => {
      expect(carveToMarkdown('`a\\_b`').trim()).toBe('`a\\_b`')
    })

    it('keeps a code block verbatim', () => {
      expect(carveToMarkdown('```\ncompany\\_id\n```').trim()).toBe('```\ncompany\\_id\n```')
    })

    it('keeps a link destination verbatim', () => {
      expect(carveToMarkdown('[x](a\\_b)').trim()).toBe('[x](a\\_b)')
    })

    it('keeps an image source verbatim', () => {
      expect(carveToMarkdown('![a](x\\_y)').trim()).toBe('![a](x\\_y)')
    })

    it('keeps a backslash in a link title', () => {
      // The parser resolves `\_` in a title, so a backslash only reaches the
      // renderer when the author doubled it - and then it is content.
      expect(carveToMarkdown('[x](/u "a\\\\_b")').trim()).toBe('[x](/u "a\\\\_b")')
    })

    it('keeps raw HTML verbatim', () => {
      expect(carveToMarkdown('```=html\n<i>a\\_b</i>\n```').trim()).toBe('&lt;i&gt;a\\_b&lt;/i&gt;')
    })
  })

  it('de-escapes an authored escape when it is intraword', () => {
    // `a\_b` and `a_b` are two spellings of the same document, so they have to
    // render the same - the escape the author wrote is still an escape.
    expect(carveToMarkdown('a\\_b').trim()).toBe('a_b')
  })

  it('keeps underline emphasis working', () => {
    expect(carveToMarkdown('_underline_').trim()).toBe('<u>underline</u>')
  })

  it('handles an identifier next to real emphasis', () => {
    expect(carveToMarkdown('company_id and *strong*').trim()).toBe('company_id and **strong**')
  })
})
