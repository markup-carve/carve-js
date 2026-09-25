import { describe, it, expect } from 'vitest'
import { carveToMarkdown } from '../src/index.js'

/**
 * PART 11 section 8a, M1b, for the underscore.
 *
 * An escape is kept where the character is adjacent on the emitted line to an
 * unescaped delimiter of the same character, and - for `_` - where another live
 * `_` on that line could close the emphasis it could open. `company_id` and
 * `_leading` are neither, so they are written as the author typed them; `a__b`
 * is adjacent, and `*x*_y_` is a pair. The asterisk is exempt under M1a and
 * stays escaped everywhere.
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

  it.each([
    ['/x/_y_', '*x*\\_y\\_'],
    ['/x/_y_ and company_id', '*x*\\_y\\_ and company_id'],
  ])('escapes a pair of text underscores in %j, which the line would read as emphasis', (source, expected) => {
    expect(carveToMarkdown(source).trim()).toBe(expected)
  })

  // M1b reads the inline content the underscore is emitted in, so a soft break
  // keeps the pair and a blank line ends it (markup-carve/carve#2046).
  it('keeps the pair across a soft break, which a reader pairs across', () => {
    expect(carveToMarkdown('/x/_y\nz_ w\n')).toBe('*x*\\_y\nz\\_ w\n')
  })

  it.each([
    'a _y\n\nz_ w\n',
    '# a _y\n\nz_ w\n',
    'a _y\n\n# z_ w\n',
    '> a _y\n>\n> z_ w\n',
  ])('leaves a pair split across a blank line bare in %j', (source) => {
    expect(carveToMarkdown(source)).toBe(source)
  })

  // M1b's unit is the paragraph, heading or table cell, so a boundary with no
  // blank line at it still ends the scan (markup-carve/carve-js#1755).
  it.each([
    ['two cells of one row', '| a _y | z_ w |\n| --- | --- |\n| p | q |\n', '| a _y | z_ w |\n| --- | --- |\n| p | q |\n'],
    ['two rows of one column', '| a _y | c |\n| --- | --- |\n| z_ w | q |\n', '| a _y | c |\n| --- | --- |\n| z_ w | q |\n'],
    ['two items of a tight list', '- a _y\n- z_ w\n', '- a _y\n- z_ w\n'],
    ['two items of an ordered list', '1. a _y\n2. z_ w\n', '1. a _y\n2. z_ w\n'],
    ['two items of a task list', '- [ ] a _y\n- [x] z_ w\n', '- [ ] a _y\n- [x] z_ w\n'],
    ['two items inside a quote', '> - a _y\n> - z_ w\n', '> - a _y\n> - z_ w\n'],
    ['a heading and the line under it', '# a _y\nz_ w\n', '# a _y\n\nz_ w\n'],
    ['two footnote definitions', '[^n]: a _y\n[^m]: z_ w\n', '[^n]: a _y\n[^m]: z_ w\n'],
  ])('leaves a pair split across %s bare', (_name, source, expected) => {
    expect(carveToMarkdown(source)).toBe(expected)
  })

  it.each([
    ['inside one cell', '| /x/_y_ | c |\n| --- | --- |\n| p | q |\n', '| *x*\\_y\\_ | c |\n| --- | --- |\n| p | q |\n'],
    ['inside one item, across a soft break', '- /x/_y\n  z_ w\n', '- *x*\\_y\n  z\\_ w\n'],
    [
      'across an escaped pipe, which does not end a cell',
      '| /x/_y \\| z_ w | c |\n| --- | --- |\n| p | q |\n',
      '| *x*\\_y \\| z\\_ w | c |\n| --- | --- |\n| p | q |\n',
    ],
  ])('still escapes a pair %s', (_name, source, expected) => {
    expect(carveToMarkdown(source)).toBe(expected)
  })

  it('ends the scan at the item boundary of a loose list', () => {
    // The pair does not close, because neither half is in the other's item.
    expect(carveToMarkdown('- a _y\n\n- z_ w\n')).toBe('- a _y\n\n- z_ w\n')
  })

  it('does not let an AUTHORED escape supply the other half of a pair', () => {
    // `\\_` is an `escaped_text` node, so it is not a live underscore and
    // cannot pair with the bare one after it.
    expect(carveToMarkdown('a \\_b c_').trim()).toBe('a \\_b c_')
  })

  it.each(['x_ _y', 'foo_bar_ baz'])(
    'leaves an underscore no second one can pair with bare in %j',
    (source) => {
      // The closer stands before the opener in the first, and the only run that
      // could open in the second is intraword, which can neither open nor close.
      expect(carveToMarkdown(source).trim()).toBe(source)
    },
  )

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
