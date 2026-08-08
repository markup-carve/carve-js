import { describe, it, expect } from 'vitest'
import { carveToMarkdown } from '../src/index.js'

/**
 * PART 11 section 8a, M1b, for the underscore.
 *
 * An escape is kept IF AND ONLY IF the character is adjacent on the emitted
 * line to an unescaped delimiter of the same character. `company_id` and
 * `_leading` are not, so they are written as the author typed them; `a__b` is,
 * because unescaping would merge the two into one run. The asterisk is exempt
 * under M1a and stays escaped everywhere.
 */
describe('markdown underscore escaping', () => {
  it.each(['company_id', 'a_b_c', 'snake_case_name', 'read_write_delete'])(
    'leaves an intraword underscore bare in %j',
    (source) => {
      expect(carveToMarkdown(source).trim()).toBe(source)
    },
  )

  it.each(['trailing_', '_leading', 'a _ b'])(
    'leaves a lone underscore bare in %j under M1b',
    (source) => {
      // The old rule kept these ("it could open or close emphasis"). M1b is an
      // if-and-only-if, not a floor: none of these underscores is ADJACENT to
      // another, so none of them is holding a run boundary apart, and section
      // 8a drops exactly those.
      expect(carveToMarkdown(source).trim()).toBe(source)
    },
  )

  it.each([
    ['a__b', 'a\\_\\_b'],
    ['x___y', 'x\\_\\_\\_y'],
  ])('keeps both escapes in %j, where unescaping would merge the runs', (source, expected) => {
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

  it('emits an AUTHORED escape as an escape, wherever it stands', () => {
    // M2, and section 8a says why it is untouched by M1b: M1b governs a
    // character that reached this writer inside a TEXT node, one the author did
    // not mark. `a\_b` is an `escaped_text` node - the author said which
    // reading they meant - so it comes back as an escape whatever the line
    // around it says. It used to take the same sentinel as a bare underscore
    // and lose its backslash to the intraword rule, which is M1b deciding a
    // node M1 never governed.
    expect(carveToMarkdown('a\\_b').trim()).toBe('a\\_b')
    expect(carveToMarkdown('\\_lead').trim()).toBe('\\_lead')
  })

  it('keeps underline emphasis working', () => {
    expect(carveToMarkdown('_underline_').trim()).toBe('<u>underline</u>')
  })

  it('handles an identifier next to real emphasis', () => {
    expect(carveToMarkdown('company_id and *strong*').trim()).toBe('company_id and **strong**')
  })
})
