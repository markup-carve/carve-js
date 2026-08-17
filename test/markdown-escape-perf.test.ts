import { describe } from 'vitest'
import { carveToMarkdown } from '../src/index.js'
import { expectScansLinearly, perfIt } from './helpers/scaling.js'

/*
 * THE MARKDOWN TARGET HAD NO SCALING ROW AT ALL (markup-carve/carve#1331).
 * `markdown-deep-list-perf.test.ts` guards the target against one shape with
 * two absolute bounds, and absolute bounds catch "did not return inside a
 * minute"; they do not catch a path that got 33x slower while still finishing.
 * PART 11 section 8b shipped exactly that, and it shipped invisibly.
 *
 * The rule resolves each narrowed escape by asking where it stands, and both
 * halves of the question were answered by scanning the whole line: a backward
 * search for the line's newline to establish the content position, and a count
 * of the entire run of hashes before comparing that count to six. Two O(n)
 * scans at O(n) candidates is O(n^2), and a line of adjacent authored hashes is
 * all candidates.
 *
 * FIXED-WIDTH FRAGMENTS ON PURPOSE. The helper reads per-byte cost, so the
 * signal it prints is only honest when the byte multiple and the unit multiple
 * agree - a builder whose bytes grow with the square of the unit count makes
 * quadratic work read as constant cost per byte, which is how a guard elsewhere
 * passed the regression it existed for. Every fragment here is two or three
 * bytes wide whatever the repeat count.
 *
 * The two hash shapes are NOT redundant, and which one a change breaks says
 * which scan it broke:
 *
 * - Adjacent hashes make the RUN long, so they reach both scans.
 * - Spaced hashes hold every run at one character, so the run bound cannot
 *   help them and only the line-start search is under test.
 *
 * Measured before the fix, per-byte cost at 4x the input: 3.38x for the
 * adjacent shape and 3.72x for the spaced one, against a healthy 1.0x. The
 * asterisk row is the other family (M1b, which decides on the neighbouring
 * delimiter rather than on the line) and was linear throughout; it is here so
 * the target keeps a row for both families rather than only for the one that
 * regressed.
 */
describe('the Markdown target on a line of authored escapes', () => {
  perfIt('a run of adjacent authored hashes scales near-linearly', () => {
    expectScansLinearly((input) => void carveToMarkdown(input), '\\#', {
      label: 'adjacent authored hashes',
      suffix: '\n',
      // Large enough that the quadratic term dominates the linear parse: at
      // 12,500 the parse dilutes the pre-fix reading to 1.93x, under the
      // threshold that has to catch it.
      smallRepeats: 50_000,
    })
  })

  perfIt('authored hashes spaced along one line scale near-linearly', () => {
    expectScansLinearly((input) => void carveToMarkdown(input), '\\# ', {
      label: 'spaced authored hashes',
      suffix: '\n',
      smallRepeats: 25_000,
    })
  })

  perfIt('a run of adjacent authored asterisks scales near-linearly', () => {
    expectScansLinearly((input) => void carveToMarkdown(input), '\\*', {
      label: 'adjacent authored asterisks',
      suffix: '\n',
    })
  })
})
