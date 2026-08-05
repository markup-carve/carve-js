import { describe, it, expect } from 'vitest'
import { carveToCarve, carveToHtml } from '../src/index.js'

/*
 * A lone span marker in a table cell keeps its padding.
 *
 * Glued to the opening pipe, `<` is also the LEFT-ALIGNMENT sigil, and the two
 * readings differ: the executable spec reads `|<|` as an alignment marker on an
 * empty cell where all three engines read a colspan (markup-carve/carve#710).
 * The grammar puts `alignment_marker` glued to the pipe and lets
 * `colspan_marker` carry surrounding whitespace, so the padded form is the one
 * that means the same thing to every reader - and the writer was turning the
 * unambiguous source into the ambiguous one.
 *
 * `^` is not an alignment sigil and needs no disambiguation; it takes the same
 * shape so a row of span cells stays readable.
 */
describe('fmt keeps a lone span marker padded', () => {
  it('a colspan marker is not glued to the pipe', () => {
    const src = '| < | b |\n|---|---|\n| c | d |\n'
    expect(carveToCarve(src)).toBe('| < | b |\n|---|---|\n| c | d |\n')
  })

  it('a rowspan marker is not glued either', () => {
    const src = '| a | b |\n|---|---|\n| ^ | d |\n'
    // A header row's canonical form is `|=a|=b|`, which needs no delimiter row.
    expect(carveToCarve(src)).toBe('|=a|=b|\n| ^ | d |\n')
  })

  it('a glued marker in the SOURCE is written back padded', () => {
    // This engine reads the glued form as a span, so the document is a span
    // table either way - fmt canonicalizes it to the portable spelling.
    const src = '| a | b |\n|---|---|\n|<| d |\n'
    expect(carveToCarve(src)).toBe('|=a|=b|\n| < | d |\n')
  })

  it('the table still says the same thing after formatting', () => {
    for (const src of [
      '| < | b |\n|---|---|\n| c | d |\n',
      '| a | b |\n|---|---|\n| ^ | d |\n',
      '| a | b | c |\n|---|---|---|\n| d | < | < |\n',
    ]) {
      expect(carveToHtml(carveToCarve(src)).trim()).toBe(carveToHtml(src).trim())
    }
  })
})
