import { describe, expect, it } from 'vitest'
import { carveToMarkdown } from '../src/index.js'

/**
 * Extra coverage for the repair in carve-js#1684, which moved a padded run's
 * whitespace outside the delimiters. Its own test pins a plain space between
 * two letters; these are the shapes of the same rule that a mid-text space
 * cannot reach.
 *
 * Two of them are not "literal text" but a BLOCK. On its own line the old
 * output for `{/ a /}` was `* a *`, which a reader takes as a bullet list, and
 * for `{* *}` it was `** **`, which is a thematic break. A case written inside
 * a sentence never sees either, because a run mid-paragraph cannot open a
 * block.
 *
 * All of these pass as they stand; verified against markdown-it 3.0.2, which
 * reads back the same node kind Carve held in every row.
 */
describe('padded emphasis, in whitespace a mid-text space cannot reach', () => {
  const rows: Array<[string, string, string]> = [
    ['a tab', 'a{*\tb\t*}c\n', 'a\t**b**\tc\n'],
    ['a soft break', 'a{/\nb/}c\n', 'a\n*b*c\n'],
    ['an NBSP, which is Zs and blocks flanking too', 'a{*\u00a0b*}c\n', 'a\u00a0**b**c\n'],
    ['an NBSP inside a strike run', 'a{~\u00a0b~}c\n', 'a\u00a0~~b~~c\n'],
    ['padding around a nested run', 'a{* {/b/} *}c\n', 'a ***b*** c\n'],
  ]

  for (const [name, source, written] of rows) {
    it(`moves ${name} outside the delimiters`, () => {
      expect(carveToMarkdown(source)).toBe(written)
    })
  }
})

describe('a padded run alone on a line, where the old output opened a BLOCK', () => {
  it('does not write `* a *`, which reads as a bullet list', () => {
    expect(carveToMarkdown('{/ a /}\n')).toBe('*a*\n')
  })

  it('does not write `** **`, which reads as a thematic break', () => {
    expect(carveToMarkdown('{* *}\n')).toBe('<strong> </strong>\n')
  })

  it('falls back to inline HTML for an emphasis run that is only padding', () => {
    expect(carveToMarkdown('{/ /}\n')).toBe('<em> </em>\n')
  })

  it('falls back to inline HTML for a strike run that is only padding', () => {
    expect(carveToMarkdown('{~ ~}\n')).toBe('<del> </del>\n')
  })

  it('leaves a padded run alone on a line readable as strong', () => {
    expect(carveToMarkdown('{* a *}\n')).toBe('**a**\n')
  })
})
