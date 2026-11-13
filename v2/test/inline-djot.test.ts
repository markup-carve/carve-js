// The inline pass against djot.js on the constructs whose rule Carve shares with Djot: strong
// with its braced form, code spans, inline links and references. Every content over a small
// alphabet is read by both engines. Where the two trees differ, a named clause of the inline
// chapter must explain the difference; a difference that no clause explains is a bug.
import { describe, expect, it } from 'vitest'
import { carveInline, djotInline } from './support/djot.ts'

const TOKENS = ['*', '{*', '*}', 'a', ' ', '`', '[', '](u)', ']']
const LENGTH = 5

/** The content without its code spans, so that a mark inside code is not counted as a token. */
function withoutCode(src: string): string {
  return src.replaceAll(/(?<!`)(`+)(?!`)[^]*?(?<!`)\1(?!`)/g, 'c').replace(/`[^]*$/, 'c')
}

/** C2-I-057: a `*}` stands where no braced opener is open, so Carve reads its star by the bare rules. */
function hasCloserWithoutOpener(src: string): boolean {
  const text = withoutCode(src)
  let open = 0
  for (let at = 0; at < text.length; at++) {
    if (text.startsWith('{*', at)) open++
    else if (text.startsWith('*}', at) && open-- === 0) return true
    else continue
    at++
  }
  return false
}

// [clause, what Carve does there and Djot does not, whether the clause applies to a content]
const EXPLANATIONS: readonly (readonly [string, string, (src: string) => boolean])[] = [
  ['C2-I-061', 'a braced opener glued to its own closer forms nothing', (src) => src.includes('{**}')],
  ['C2-I-049', 'a run of two stars is text', (src) => src.includes('**')],
  ['C2-I-047', 'a star behind a word character does not open', (src) => /[a-z]\*(?![ }]|$)/.test(src.replaceAll('{*', '{ '))],
  ['C2-I-048', 'a star before a word character does not close', (src) => /(?<![ {]|^)\*[a-z]/.test(src.replaceAll('*}', ' }'))],
  ['C2-I-064', 'a bracket pair takes only a valid attribute block', (src) => src.includes(']{')],
  ['C2-I-016', 'one space is removed from each end of a closed code span', (src) => /` [^`]* `/.test(src)],
  ['C2-I-017', 'an unclosed code span keeps the space behind its opener', (src) => /` `|`` /.test(src)],
  ['C2-I-079', 'a label with no key is no label', (src) => /\[ *\]\[\]|\]\[ +\]/.test(src)],
  ['C2-I-076', 'a label is taken whole, a backtick and a bracket included', (src) => /\]\[[^\]]*[`[][^\]]*\]/.test(src)],
  ['C2-I-119', 'behind a label that does not close the scan goes on as usual', (src) => /\]\[[^\]]*$/.test(src)],
  ['C2-I-007', 'a link is settled before the delimiters inside it pair', (src) => /\[.*\*.*\]\(u\)/.test(src)],
  ['C2-I-006', 'a closing bracket pairs with the nearest open one, also when the pair forms nothing', (src) => /\[.*\](?!\(u\)).*\]\(u\)|\[.*\]\]\[\]/.test(src)],
  ['C2-I-057', 'a star before a brace is a bare delimiter while no braced opener is open', hasCloserWithoutOpener],
]

describe('djot.js and the inline pass', () => {
  it(`every content of ${LENGTH} tokens: each difference is explained by a clause`, () => {
    const used = new Map<string, number>()
    const unexplained: string[] = []
    let equal = 0
    const choice = new Array<number>(LENGTH).fill(0)
    for (;;) {
      // The leading word and space keep the first token from being a block marker.
      const src = `x ${choice.map((index) => TOKENS[index]!).join('')}`
      const djot = djotInline(src)
      const carve = carveInline(src)
      if (djot === carve) {
        equal++
      } else {
        const explanation = EXPLANATIONS.find((row) => row[2](src))
        if (explanation === undefined) unexplained.push(`${JSON.stringify(src)}: djot ${djot}, carve ${carve}`)
        else used.set(explanation[0], (used.get(explanation[0]) ?? 0) + 1)
      }
      let at = LENGTH - 1
      while (at >= 0 && choice[at] === TOKENS.length - 1) choice[at--] = 0
      if (at < 0) break
      choice[at]!++
    }
    if (process.env['CARVE_DJOT_COUNTS'] !== undefined) console.log(equal, [...used.entries()].sort())
    expect(unexplained).toEqual([])
    // Every explanation is needed, and most contents need none.
    expect([...used.keys()].sort()).toEqual(EXPLANATIONS.map((row) => row[0]).sort())
    expect(equal).toBeGreaterThan(TOKENS.length ** LENGTH / 3)
  })

  it('the shared rules on written examples', () => {
    for (const src of [
      'x *a* b', 'x *a *b* c*', 'x {*a*}b', 'x *a {*b*} c*', 'x *a', 'x {*a', 'x `a *b*` c', 'x ``a`b`` c', 'x `a',
      'x [a](u) b', 'x [a *b*](u)', 'x *[a](u)*', 'x [a] b', 'x [a [b](u) c](u)', 'x [a][b]', 'x * a *', 'x {*a*} {*b',
    ]) expect(carveInline(src), src).toBe(djotInline(src))
  })
})
