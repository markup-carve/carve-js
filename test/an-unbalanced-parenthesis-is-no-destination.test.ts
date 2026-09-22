import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'

/*
 * `link_destination` and `balanced_parens` are both built from
 * `destination_char`, which excludes Unicode whitespace, so a `(` that is
 * still open when whitespace arrives can never be part of a destination and
 * the tail has none.
 *
 * The scan ended at the space with the `(` open and nothing asked whether the
 * parentheses had balanced, so `[t](( ")")` published the unbalanced href `(`
 * with the title `)` (markup-carve/carve-js#1872). The bare image line read
 * the run through a regex of its own, which let the same `(` through and also
 * kept the backslash of `![a](/i\(x)` that the inline tail resolves.
 */
describe('an unbalanced parenthesis is no destination', () => {
  // Asserted as whole renderings. "No link" also describes an engine that
  // dropped the run, and what the production asks for is the author's
  // characters surviving as text.
  const prose: [string, string, string][] = [
    ['a link', '[t](( ")")', '<p>[t](( “)”)</p>'],
    ['an image', '![a](( ")")', '<p>![a](( “)”)</p>'],
    ['a single-quoted run', "[t](( ')')", '<p>[t](( ‘)’)</p>'],
    // The attribute block belongs to the construct the tail opens, and there
    // is none.
    ['a trailing attribute block', '[t](( ")"){.x}', '<p>[t](( “)”){.x}</p>'],
    ['an image with a trailing attribute block', '![a](( ")"){.x}', '<p>![a](( “)”){.x}</p>'],
    // No quoted run at all: the space alone ends the scan with the `(` open.
    // This row reads the same with the balance check gone, because what
    // follows the space is neither a title nor the tail's `)`; it is here for
    // the shape, not as a witness.
    ['a bare space inside the pair', '[t](a( b)', '<p>[t](a( b)</p>'],
    // The pair closes after the quoted run, which leaves a destination
    // carrying a space and a tail that ends later than the scan thought.
    ['a pair that closes after the run', '[t](( "a") b)', '<p>[t](( “a”) b)</p>'],
  ]

  for (const [name, source, expected] of prose) {
    it(`leaves the run as prose: ${name}`, () => {
      expect(carveToHtml(source)).toBe(expected)
    })
  }

  // A bare image line is read by a regex rather than by the inline tail, so
  // every row above needs its standalone-line partner or the regex keeps its
  // own reading of the production.
  const bare: [string, string, string][] = [
    ['an unbalanced pair', '![a](( ")")\n', '<p>![a](( “)”)</p>'],
    ['an unbalanced pair with attributes', '![a](( ")"){.x}\n', '<p>![a](( “)”){.x}</p>'],
    ['an escaped parenthesis', '![a](/i\\(x)\n', '<img src="/i(x" alt="a">'],
    ['an escaped backslash', '![a](/i\\\\y)\n', '<img src="/i\\y" alt="a">'],
  ]

  for (const [name, source, expected] of bare) {
    it(`reads a standalone image line as the inline tail does: ${name}`, () => {
      expect(carveToHtml(source)).toBe(expected)
    })
  }

  // Rows that keep the balancing rule pointed at the open pair rather than at
  // the parenthesis.
  const links: [string, string, string][] = [
    ['a balanced pair inside the destination', '[x](http://a/b(c))', '<p><a href="http://a/b(c)">x</a></p>'],
    ['a destination that is one pair', '[t]((a))', '<p><a href="(a)">t</a></p>'],
    ['an unpaired closer ends the tail', '[y](e)f)', '<p><a href="e">y</a>f)</p>'],
    ['a quoted title after a balanced pair', '[t](a(b) "c")', '<p><a href="a(b)" title="c">t</a></p>'],
    ['a quote inside the destination', '[t](a"b "c")', '<p><a href="a&quot;b" title="c">t</a></p>'],
    ['a closing parenthesis inside the title', '[t](/u "T)")', '<p><a href="/u" title="T)">t</a></p>'],
    ['a balanced pair on a bare image line', '![a](http://a/b(c))\n', '<img src="http://a/b(c)" alt="a">'],
  ]

  for (const [name, source, expected] of links) {
    it(`still builds the construct: ${name}`, () => {
      expect(carveToHtml(source)).toBe(expected)
    })
  }

  it('covers every row', () => {
    expect(prose).toHaveLength(7)
    expect(bare).toHaveLength(4)
    expect(links).toHaveLength(7)
  })
})
