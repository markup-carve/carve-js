import { describe, expect, it } from 'vitest'
import { carveToCarve, carveToHtml } from '../src/index.js'

/*
 * THE WRITER'S HALF of markup-carve/carve-js#2263 (the reader's landed in #2262,
 * where `test/a-comment-span-closer-belongs-to-its-span.test.ts` pins it).
 *
 * While a container ended at the CLOSER of a span it already held, the split pair
 * left the container's own parse reading an opener with no closer. PART 9 §28
 * makes that one `%%` line comment, so `carve fmt` wrote the delimiter back as a
 * `%% %` line - a comment whose text is the single character `%` - and published
 * the payload between the two of them as an ordinary paragraph. A format pass
 * turned an authored hidden body into visible text and destroyed both delimiters,
 * which is worse than the reader bug it followed from.
 *
 * Asserted as the two properties the formatter owes rather than as one golden per
 * column: the formatted source must render to the page its input rendered to, and
 * it must not spell a delimiter as a line comment whose whole text is `%`.
 *
 * THE FIRST PROPERTY COULD NOT SEE THE BUG ON ITS OWN while the reader was wrong
 * too: both halves published the payload, so the pages matched. It is an
 * invariant now that the reader hides it, and the spelling assertion is what
 * fails at the base either way.
 *
 * A BLOCK QUOTE IS NOT AN EXCEPTION TO THE SECOND ONE, it is the control for it.
 * There the oracle publishes the payload itself - an indented `%%%` inside the
 * quote body opens no span - so `%% %` is the faithful spelling of a degraded
 * opener, and the page is preserved. That is why the assertion is about page
 * equivalence first and about the spelling only where a span really opened.
 */

const pad = (n: number): string => ' '.repeat(n)
const hosts: [string, (closerColumn: number) => string, number, boolean][] = [
  ['a description body', (c) => `:: t\n:  head\n\n     %%%\n     a\n${pad(c)}%%%\n`, 6, true],
  ['a note body', (c) => `see[^f]\n\n[^f]: head\n\n  %%%\n  a\n${pad(c)}%%%\n`, 4, true],
  ['a single-span list item', (c) => `- head\n\n    %%%\n    a\n${pad(c)}%%%\n\n  tail\n`, 6, true],
  [
    'two spans in a list item',
    (c) => `- head\n\n    %%%\n    a\n${pad(c)}%%%\n    %%%\n    b\n    %%%\n\n  tail\n`,
    6,
    true,
  ],
  [
    'a nested list item',
    (c) => `- o\n  - head\n\n    %%%\n    a\n${pad(c)}%%%\n%%%\n    b\n    %%%\n`,
    6,
    true,
  ],
  ['a block quote, where the payload is published either way', (c) => `> head\n>\n>   %%%\n>   a\n${pad(c)}%%%\n`, 4, false],
]

describe('fmt keeps a comment span whose closer sits below its host column', () => {
  it.each(hosts)('%s renders the same after a format pass', (_name, make, maxColumn) => {
    for (let column = 0; column <= maxColumn; column++) {
      const source = make(column)
      const formatted = carveToCarve(source)
      expect(carveToHtml(formatted)).toBe(carveToHtml(source))
      expect(carveToCarve(formatted)).toBe(formatted)
    }
  })

  it.each(hosts.filter(([, , , spanOpens]) => spanOpens))(
    '%s keeps its delimiters instead of writing a one-character line comment',
    (_name, make, maxColumn) => {
      for (let column = 0; column <= maxColumn; column++) {
        const formatted = carveToCarve(make(column))
        expect(formatted).not.toMatch(/^[ \t]*%% +%[ \t]*$/m)
        expect(formatted).toContain('%%%')
      }
    },
  )

  // The four documents the ticket reports, spelled out so a change to the
  // canonical form is visible in the diff rather than only in a property.
  it.each([
    ['a description body', ':: t\n:  head\n\n     %%%\n     a\n%%%\n', ':: t\n: head\n\n  %%%\n    a\n  %%%\n'],
    [
      'a note body',
      'see[^f]\n\n[^f]: head\n\n  %%%\n  a\n%%%\n',
      'see[^f]\n\n[^f]: head\n\n  %%%\n  a\n  %%%\n',
    ],
    [
      'two spans in a list item',
      '- head\n\n    %%%\n    a\n%%%\n    %%%\n    b\n    %%%\n\n  tail\n',
      '- head\n\n  %%%\n    a\n  %%%\n\n  %%%\n    b\n  %%%\n\n  tail\n',
    ],
    [
      'a nested list item',
      '- o\n  - head\n\n    %%%\n    a\n%%%\n%%%\n    b\n    %%%\n',
      '- o\n  - head\n    %%%\n    a\n    %%%\n\n%%%\n    b\n%%%\n',
    ],
  ])('%s writes a canonical span', (_name, source, expected) => {
    expect(carveToCarve(source)).toBe(expected)
  })
})
