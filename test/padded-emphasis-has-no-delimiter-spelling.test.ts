import { describe, expect, it } from 'vitest'
import { carveToMarkdown } from '../src/index.js'

/**
 * A delimiter run only opens emphasis while it is left-flanking and only closes
 * while it is right-flanking, and a run adjacent to whitespace is neither
 * (CommonMark 6.2). So content padded with whitespace has no delimiter spelling
 * at all, and writing one loses the node: `** a **` re-parses to literal text,
 * `* a *` to a BULLET LIST, and `** **` to a thematic break.
 *
 * Every site that wraps content in `*`, `**` or `~~` therefore falls back to
 * the inline HTML this renderer already uses for the types Markdown cannot
 * spell. The padding is authored content - NBSP arrives as a `\ ` escape - so
 * it is neither trimmed nor moved outside the run; a moved space would open an
 * indented code block at column 0 or a hard break at the end of a line.
 *
 * Found through the HTML importer, on `<p><b> Hello World!</b></p>`
 * (carve-js#1683).
 */
describe('padded content is written as inline HTML, not as a delimiter run', () => {
  const rows: Array<[string, string, string]> = [
    ['the reported importer shape', '{* Hello World!*}\n', '<strong> Hello World!</strong>\n'],
    ['trailing padding', '{*Hello World! *}\n', '<strong>Hello World! </strong>\n'],
    ['padding mid-sentence', 'a{* b*}c\n', 'a<strong> b</strong>c\n'],
    ['emphasis, whose `* a *` is read as a list', '{/ a /}\n', '<em> a </em>\n'],
    ['strike', '{~ a ~}\n', '<s> a </s>\n'],
    ['content that is only padding, whose `** **` is a break', '{* *}\n', '<strong> </strong>\n'],
    ['a tab', '{*\ta\t*}\n', '<strong>\ta\t</strong>\n'],
    ['a soft break', '{/\na/}\n', '<em>\na</em>\n'],
    ['an NBSP, which is Zs and blocks flanking too', '{*\u00a0a*}\n', '<strong>\u00a0a</strong>\n'],
  ]

  for (const [name, source, expected] of rows) {
    it(`writes ${name} as inline HTML`, () => {
      expect(carveToMarkdown(source)).toBe(expected)
    })
  }

  /**
   * The same run is written by six more sites, each of which wraps a title, a
   * label, a term or a caption. They are one writer, so they are pinned here
   * rather than left to drift.
   */
  const wrappers: Array<[string, string, string]> = [
    ['an admonition title', '::: note " Title "\nbody\n:::\n', '<strong> Title </strong>\n\nbody\n'],
    ['an admonition title that is only padding', '::: note " "\nbody\n:::\n', '<strong> </strong>\n\nbody\n'],
    ['an admonition title behind an NBSP', '::: note "\\ Title"\nbody\n:::\n', '<strong>\u00a0Title</strong>\n\nbody\n'],
    ['a container label', '::: [ L ]\nbody\n:::\n', '<strong> L </strong>\n\nbody\n'],
    ['a definition term behind an NBSP', ':: \\ t\n:  d\n', '<strong>\u00a0t</strong>\n: d\n'],
    [
      'a figure-group caption behind an NBSP',
      '::: figure\n![a](x.png)\n^ p\n:::\n^ \\ g\n',
      '![a](x.png)\n\n*p*\n\n<strong>\u00a0g</strong>\n',
    ],
    [
      'a panel caption behind an NBSP',
      '::: figure\n![a](x.png)\n^ \\ p\n:::\n^ g\n',
      '![a](x.png)\n\n<em>\u00a0p</em>\n\n**g**\n',
    ],
  ]

  for (const [name, source, expected] of wrappers) {
    it(`writes ${name} as inline HTML`, () => {
      expect(carveToMarkdown(source)).toBe(expected)
    })
  }

  /**
   * The property the rows above are instances of, stated once: no run this
   * renderer writes may sit against whitespace on its inside.
   */
  it('never writes a delimiter run against whitespace on the inside', () => {
    const sources = [
      '{* a *}\n',
      '{/ a /}\n',
      '{~ a ~}\n',
      '{*\u00a0a*}\n',
      '::: note " T "\nbody\n:::\n',
      ':: \\ t\n:  d\n',
    ]
    for (const source of sources) {
      const written = carveToMarkdown(source)
      expect([source, written.match(/(?:\*{1,2}|~~)[ \t\n\u00a0]|[ \t\n\u00a0](?:\*{1,2}|~~)/)]).toEqual([
        source,
        null,
      ])
    }
  })
})

/**
 * The fallback is for padded content ONLY. Unpadded content keeps the portable
 * delimiter spelling, which is the whole point of a Markdown target - these
 * rows stay green whether the fix is present or not, so they are the regression
 * surface, not evidence for it.
 */
describe('unpadded content keeps its delimiter run', () => {
  const rows: Array<[string, string]> = [
    ['{*a*}\n', '**a**\n'],
    ['{/a/}\n', '*a*\n'],
    ['{~a~}\n', '~~a~~\n'],
    ['a{*b*}c\n', 'a**b**c\n'],
    ['::: note "Title"\nbody\n:::\n', '**Title**\n\nbody\n'],
    [':: t\n:  d\n', '**t**\n: d\n'],
  ]

  for (const [source, expected] of rows) {
    it(`writes ${JSON.stringify(source)} with delimiters`, () => {
      expect(carveToMarkdown(source)).toBe(expected)
    })
  }
})
