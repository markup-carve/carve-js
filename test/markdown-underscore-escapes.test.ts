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

  it('keeps underline emphasis working', () => {
    expect(carveToMarkdown('_underline_').trim()).toBe('<u>underline</u>')
  })

  it('handles an identifier next to real emphasis', () => {
    expect(carveToMarkdown('company_id and *strong*').trim()).toBe('company_id and **strong**')
  })
})
