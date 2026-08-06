import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

/*
 * The colon fence's separator is a literal space; its metadata slots are not.
 *
 * `resources/grammar.ebnf` PART 7, MARKER SEPARATORS AND PADDING SLOTS, is
 * normative and splits the opener line into two roles that must NOT be swept
 * together (carve#878 step 2, spec edit carve#886):
 *
 *   - The slot immediately after the fence run is a MARKER SEPARATOR: `space`,
 *     U+0020 only, because the token after it selects which of the four blocks
 *     the line opens.
 *   - The admonition opener's title and label slots are PADDING: `whitespace`,
 *     which the grammar defines as `' ' | '\t'` and nothing else.
 *
 * So a blanket widening or narrowing of the opener's whitespace class is wrong
 * in one direction or the other, which is why both halves are pinned here.
 */

describe('the separator after the fence run is a literal space', () => {
  const openers: Array<[string, string]> = [
    ['admonition', 'note'],
    ['div label', '[lbl]'],
    ['line block', '|'],
    ['local hard break', '\\'],
  ]

  for (const [label, token] of openers) {
    it(`a tab there opens nothing: ${label}`, () => {
      // Asserted as "the opener line survives as text", not "there is a <p>":
      // a div and a line block BOTH wrap a paragraph, so a `<p>` check passes
      // for a container that should not have opened at all.
      const tabbed = carveToHtml(`:::\t${token}\nx\n:::\n`)

      expect(tabbed).toContain(':::')
      expect(tabbed).not.toContain('<aside')
      expect(tabbed).not.toContain('<div')
    })

    it(`a space there still opens it: ${label}`, () => {
      // The control for each row: narrowing the class must not close the door
      // on the spelling the grammar does admit.
      const spaced = carveToHtml(`::: ${token}\nx\n:::\n`)

      expect(spaced).not.toBe(carveToHtml(`:::\t${token}\nx\n:::\n`))
    })
  }
})

describe('the admonition metadata slots take a tab', () => {
  it('a tab before the title is padding, not a separator', () => {
    const out = carveToHtml('::: note\t"Title"\nx\n:::\n')

    expect(out).toContain('admonition-title')
    expect(out).toContain('Title')
  })

  it('a tab before the label is padding too', () => {
    const out = carveToHtml('::: note\t"T"\t[lbl]\nx\n:::\n')

    expect(out).toContain('admonition-title')
  })

  it('the space spelling is unchanged', () => {
    expect(carveToHtml('::: note "Title"\nx\n:::\n')).toContain('admonition-title')
  })
})

describe('padding is a space or a tab, and nothing else', () => {
  // `whitespace = ' ' | '\t'` is exhaustive. The slots were spelled `\s`,
  // which in JavaScript also admits a form feed, a vertical tab, U+FEFF and
  // every Unicode space - none of which the grammar names.
  for (const [label, ws] of [['form feed', '\f'], ['vertical tab', '\v'], ['en quad', ' ']] as const) {
    it(`a ${label} before the title does not pad`, () => {
      const out = carveToHtml(`::: note${ws}"Title"\nx\n:::\n`)

      expect(out).not.toContain('admonition-title')
    })
  }
})
