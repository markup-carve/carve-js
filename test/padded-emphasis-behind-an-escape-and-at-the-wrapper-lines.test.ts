import { describe, expect, it } from 'vitest'
import { carveToMarkdown } from '../src/index.js'

/**
 * Completes carve-js#1684, which moved a padded run's whitespace outside the
 * delimiters. Two roots survived it (carve-js#1688).
 *
 * The padding an author actually WRITES is `\ `, which reaches the writer as
 * the internal U+E000 placeholder and only becomes a real nbsp in `normalize`,
 * at the very end of the render - so the flanking test, written against `\s`,
 * saw no padding there at all. And six block wrappers built the delimiter run
 * themselves instead of going through the repair, one of which turned a
 * whitespace-only admonition title into a THEMATIC BREAK.
 *
 * ` ` below is the resolved nbsp the escape becomes on the way out.
 * Verified against markdown-it 3.0.2: every row reads back as the node kind
 * Carve held.
 */
describe('root 1: padding written as a `\\ ` escape', () => {
  it('moves leading escaped padding outside a strong run', () => {
    expect(carveToMarkdown('a{*\\ b*}c\n')).toBe('a **b**c\n')
  })

  it('moves trailing escaped padding outside a strong run', () => {
    expect(carveToMarkdown('a{*b\\ *}c\n')).toBe('a**b** c\n')
  })

  it('moves leading escaped padding outside an emphasis run', () => {
    expect(carveToMarkdown('a{/\\ b/}c\n')).toBe('a *b*c\n')
  })

  it('moves leading escaped padding outside a strike run', () => {
    expect(carveToMarkdown('a{~\\ b~}c\n')).toBe('a ~~b~~c\n')
  })

  it('never leaves a dead run behind the escape', () => {
    expect(carveToMarkdown('a{*\\ b*}c\n')).not.toContain('** b')
  })

  it('falls back to inline HTML for a strong run that is only the escape', () => {
    expect(carveToMarkdown('{*\\ *}\n')).toBe('<strong> </strong>\n')
  })

  it('falls back to inline HTML for an emphasis run that is only the escape', () => {
    expect(carveToMarkdown('{/\\ /}\n')).toBe('<em> </em>\n')
  })

  it('falls back to inline HTML for a strike run that is only the escape', () => {
    expect(carveToMarkdown('{~\\ ~}\n')).toBe('<del> </del>\n')
  })
})

/**
 * The class is the Unicode `White_Space` property, because the READER decides
 * whether a run flanks: pulldown-cmark counts U+000B, U+2028 and U+2029 as
 * whitespace, so a run left beside one never opens (markup-carve/carve#2023). A
 * zero-width no-break space is not whitespace and stays inside.
 */
describe('the whitespace class is Unicode White_Space', () => {
  it('moves a Zs that is not a plain space', () => {
    expect(carveToMarkdown('a{* b*}c\n')).toBe('a **b**c\n')
  })

  it('moves a form feed', () => {
    expect(carveToMarkdown('a{*b*}c\n')).toBe('a**b**c\n')
  })

  it('leaves a zero-width no-break space inside, which is not whitespace', () => {
    expect(carveToMarkdown('a{*﻿b*}c\n')).toBe('a**﻿b**c\n')
  })

  it('moves a line separator, which the reader counts as whitespace', () => {
    expect(carveToMarkdown('a{* b*}c\n')).toBe('a **b**c\n')
  })

  it('moves a paragraph separator, which the reader counts as whitespace', () => {
    expect(carveToMarkdown('a{* b*}c\n')).toBe('a **b**c\n')
  })

  it('moves a vertical tab, which the reader counts as whitespace', () => {
    expect(carveToMarkdown('a{*b*}c\n')).toBe('a**b**c\n')
  })
})

/**
 * Root 2: the six block wrappers. Each one used to concatenate the delimiters
 * itself, so none of them got the repair.
 */
describe('root 2: the wrapper lines go through the same repair', () => {
  it('does not write `** **` for a whitespace-only admonition title, which is a thematic break', () => {
    expect(carveToMarkdown('::: note " "\nbody\n:::\n')).toBe('<strong> </strong>\n\nbody\n')
  })

  it('keeps a padded admonition title readable as strong', () => {
    expect(carveToMarkdown('::: note " Title "\nbody\n:::\n')).toBe('**Title** \n\nbody\n')
  })

  it('keeps an admonition title behind the escape readable as strong', () => {
    expect(carveToMarkdown('::: note "\\ T"\nbody\n:::\n')).toBe(' **T**\n\nbody\n')
  })

  it('keeps a padded container label readable as strong', () => {
    expect(carveToMarkdown('::: [ L ]\nbody\n:::\n')).toBe('**L** \n\nbody\n')
  })

  it('keeps a padded admonition label readable as strong', () => {
    expect(carveToMarkdown('::: note [ L ]\nbody\n:::\n')).toBe('**L** \n\nbody\n')
  })

  it('keeps a definition term behind the escape readable as strong', () => {
    expect(carveToMarkdown(':: \\ t\n: d\n')).toBe(' **t**\n: d\n')
  })

  it('keeps a figure-group caption behind the escape readable as strong', () => {
    expect(carveToMarkdown('::: figure\n![a](x.png)\n^ a\n:::\n^ \\ g\n')).toBe(
      '![a](x.png)\n\n*a*\n\n **g**\n',
    )
  })

  it('keeps a figure panel caption behind the escape readable as emphasis', () => {
    expect(carveToMarkdown('::: figure\n![a](x.png)\n^ \\ p\n:::\n^ g\n')).toBe(
      '![a](x.png)\n\n *p*\n\n**g**\n',
    )
  })

  it('leaves an unpadded admonition title exactly as it was', () => {
    expect(carveToMarkdown('::: note "T"\nbody\n:::\n')).toBe('**T**\n\nbody\n')
  })

  it('leaves an unpadded container label exactly as it was', () => {
    expect(carveToMarkdown('::: [L]\nbody\n:::\n')).toBe('**L**\n\nbody\n')
  })

  it('leaves an unpadded definition term exactly as it was', () => {
    expect(carveToMarkdown(':: t\n: d\n')).toBe('**t**\n: d\n')
  })

  it('leaves unpadded figure captions exactly as they were', () => {
    expect(carveToMarkdown('::: figure\n![a](x.png)\n^ p\n:::\n^ g\n')).toBe(
      '![a](x.png)\n\n*p*\n\n**g**\n',
    )
  })
})

/**
 * A hard break is spelled as a backslash then a newline. The newline is in the
 * class, so moving it out alone left the backslash escaping the delimiter
 * behind it and `**t\**` came back as text with a stray `*`.
 */
describe('a trailing hard break keeps its backslash', () => {
  it('does not split the backslash from its newline in a definition term', () => {
    expect(carveToMarkdown(':: \\ t\\ \n: d\n')).toBe(' **t**\\\n\n: d\n')
  })

  it('leaves no stray delimiter behind the backslash', () => {
    expect(carveToMarkdown(':: \\ t\\ \n: d\n')).not.toContain('t\\**')
  })
})
