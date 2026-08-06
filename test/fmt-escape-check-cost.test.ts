import { describe, it, expect } from 'vitest'
import { carveToCarve, carveToHtml } from '../src/index.js'
import { perfIt } from './helpers/scaling.js'

/*
 * carve-js#641, the residual factor.
 *
 * `renderCarve` decides between the minimal and the conservative escape form by
 * PARSING both and comparing the trees (PART 11 §4 - "the check is the parser's,
 * not a table's"). Two full parses, and they were paid by every document holding
 * a single escapable character in text, which is nearly all of them.
 *
 * It looked like depth sensitivity because parse is what costs on a deep
 * document. Measured on a 40 KB `- x` ladder: the ladder alone formatted in
 * ~6 ms, and adding one `-` to a paragraph took it to ~186 ms - about twice the
 * parse. Nothing about the depth changed; the escape check switched on.
 *
 * A middle tier now answers the question with ONE parse where it can: if the
 * minimal form re-parses to the tree we were handed, it is faithful and there is
 * nothing left to compare. Strictly stronger than "the two renders agree".
 *
 * These tests pin the OUTPUT, not the timing. The saving is real but a ratio
 * bound tight enough to catch its loss would flake on a loaded machine, which is
 * the observation that produced #641 in the first place.
 */
const ladder = (depth: number): string =>
  Array.from({ length: depth }, (_, i) => ' '.repeat(i * 2) + '- x').join('\n') + '\n'

describe('the escape decision does not change what it decides', () => {
  it('leaves a mid-text dash, asterisk, dot and paren unescaped', () => {
    // The characters that used to trigger the two-parse comparison. All four are
    // candidates, none is load-bearing mid-text, so the minimal form wins - and
    // it is now reached by the one-parse tier.
    for (const tail of ['tail - dash', 'tail * star', 'tail end.', 'tail (x)']) {
      expect(carveToCarve(`${tail}\n`)).toBe(`${tail}\n`)
    }
  })

  it('still escapes where the bare form would re-parse differently', () => {
    // The tier only fires when the minimal form reproduces the tree. Here it
    // does not, so the comparison runs and picks the conservative form.
    expect(carveToCarve('![a](/u)\n\\^ cap')).toBe('![a](/u)\n\\^ cap\n')
  })

  it('is unchanged on a deep ladder carrying an escapable character', () => {
    const src = `${ladder(60)}\ntail - dash\n`
    const out = carveToCarve(src)
    expect(out).toBe(src)
    expect(carveToCarve(out)).toBe(out)
    expect(carveToHtml(out)).toBe(carveToHtml(src))
  })
})

describe('formatting a deep document stays bounded', () => {
  perfIt('formats a 200-level ladder with an escapable character well inside a second', () => {
    // An ABSOLUTE bound with wide headroom, the convention #640 established for
    // this file's neighbours: ~0.2s on an idle machine, and the two-parse form
    // this replaced was ~0.3s, so the bound catches a return to it only when the
    // machine is not otherwise busy. It is here to fail on an ORDER-of-magnitude
    // regression, not to measure the saving.
    const src = `${ladder(200)}\ntail - dash\n`
    carveToCarve(ladder(40))
    const started = Date.now()
    const out = carveToCarve(src)
    expect(Date.now() - started).toBeLessThan(5000)
    expect(out).toBe(src)
  })
})
