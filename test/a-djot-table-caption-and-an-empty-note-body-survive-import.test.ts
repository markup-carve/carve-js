import { describe, expect, it } from 'vitest'
import { carveToHtml, djotToCarve } from '../src/index.js'

// markup-carve/carve-js#2702: the importer escaped two markers it must not.
// A Djot table caption `^ text` is the same marker Carve spells a caption with,
// so `\^` dropped the caption and left a paragraph; and the `%%%%` this importer
// GENERATES for an empty footnote body was escaped into literal text, so the
// render carried a `%%%%` paragraph no source ever held.
//
// Carve has no empty footnote body - `[^b]:` alone re-parses as a paragraph -
// so the comment placeholder is what makes the definition exist at all. It
// therefore travels as a NUL token the text escaper cannot see, rather than as
// the literal `%%%%` the escaper used to reach.
//
// djot.js 0.3.2 folds an UNINDENTED caption continuation into the caption
// (measured; its own `test/tables.test` snapshot pins it), although
// `doc/syntax.md` says a continuation must be indented. Carve's parser folds it
// too, so the importer carries the lines through either way.
describe('a Djot table caption and an empty footnote body survive import', () => {
  it.each([
    [
      'a caption after a blank line',
      '| a | b |\n\n^ With a _caption_\nand another line.\n',
      '| a | b |\n\n^ With a /caption/\nand another line.\n',
    ],
    [
      'a caption directly under the table',
      '| a | b |\n^ cap\n',
      '| a | b |\n^ cap\n',
    ],
    [
      'an indented continuation',
      '| a | b |\n\n^ With a _caption_\n  and another line.\n',
      '| a | b |\n\n^ With a /caption/\n  and another line.\n',
    ],
    [
      'a tab after the marker takes the space Carve requires',
      '| a | b |\n\n^\tcap\n',
      '| a | b |\n\n^ cap\n',
    ],
    [
      'a caption inside a quote',
      '> | a | b |\n>\n> ^ cap\n',
      '> | a | b |\n>\n> ^ cap\n',
    ],
    [
      'an empty footnote body',
      '[^a]\n[^b]\n\n[^b]:\n',
      '[^carve-djot-note-0]: %%%%\n\n[^carve-djot-note-0]\n[^b]\n\n[^b]: %%%%\n',
    ],
    // CONTROLS. Each needs its escape, and a fix that stopped escaping would
    // satisfy the rows above while breaking one of these.
    [
      'a caret paragraph with no table above it still escapes',
      'para\n\n^ cap\n',
      'para\n\n\\^ cap\n',
    ],
    [
      'only the FIRST block after a table may be its caption',
      '| a | b |\n\n^ cap\n\n^ not a caption\n',
      '| a | b |\n\n^ cap\n\n\\^ not a caption\n',
    ],
    [
      'a paragraph after a table that does not open with a caret is untouched',
      '| a | b |\n\nplain paragraph\n',
      '| a | b |\n\nplain paragraph\n',
    ],
    [
      'a caret with no space after it is not a caption marker',
      '| a | b |\n\n^cap\n',
      '| a | b |\n\n\\^cap\n',
    ],
    [
      'an AUTHORED percent run in a footnote body still escapes',
      '[^a]: %%%%\n\ntext[^a]\n',
      '[^a]: \\%%%%\n\ntext[^a]\n',
    ],
    [
      'a non-empty footnote body is untouched',
      't[^a]\n\n[^a]: body\n',
      't[^a]\n\n[^a]: body\n',
    ],
    [
      'a caret in running text still escapes',
      'a ^ b and ^x^ c\n',
      'a \\^ b and {^x^} c\n',
    ],
  ])('%s', (_name, djot, carve) => {
    expect(djotToCarve(djot)).toBe(carve)
  })

  it('keeps the caption in the rendered table', () => {
    const html = carveToHtml(djotToCarve('| a | b |\n\n^ With a _caption_\nand another line.\n'))
    expect(html).toContain('<caption>With a <em>caption</em>\nand another line.</caption>')
  })

  it('renders an empty footnote body as nothing but its backlink', () => {
    const html = carveToHtml(djotToCarve('[^a]\n[^b]\n\n[^b]:\n'))
    expect(html).not.toContain('%%%%')
    expect(html).toContain('<li id="fn1">\n      <p><a href="#fnref1" role="doc-backlink" aria-label="Back to reference">↩</a></p>')
  })

  it('still renders an AUTHORED percent run in a footnote body as text', () => {
    expect(carveToHtml(djotToCarve('[^a]: %%%%\n\ntext[^a]\n'))).toContain('%%%%')
  })

  // The Carve parser side of both markers, which this fix must not move.
  it.each([
    ['an authored caption still opens one', '| a | b |\n\n^ cap\n', '<caption>cap</caption>'],
  ])('%s', (_name, carve, expected) => {
    expect(carveToHtml(carve)).toContain(expected)
  })

  it('still reads an authored percent run as a comment', () => {
    expect(carveToHtml('a %%note here\nb\n')).toBe('<p>a\nb</p>')
  })
})
