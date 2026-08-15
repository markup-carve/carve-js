import { describe } from 'vitest'
import { bbcodeToCarve } from '../src/bbcode-migrate.js'
import { escapePlainCarveInlineSyntax } from '../src/carve-escape.js'
import { expectScansLinearly, perfIt } from './helpers/scaling.js'

/*
 * The escaper inserts backslashes into a line, and HOW it inserts them decides
 * whether a converter is linear or a denial of service.
 *
 * Splicing each backslash into a growing string copies the whole string per
 * insertion, so a line is quadratic in the NUMBER of escapes rather than in its
 * length - and the sizes that reaches are ordinary, not adversarial: 192KB of
 * `{^x^}` pairs took 5.5 seconds spliced and 8 milliseconds built in one
 * forward pass, well inside the BBCode converter's own 256KB input bound. Both
 * shapes below are lines that take many escapes, which is the input the splice
 * was quadratic on.
 *
 * A line of UNCLOSED braced openers is quadratic here for a different and older
 * reason - the pair pattern rescans to the line end from every opener, exactly
 * as it does in carve-php - so it is not guarded here. It predates this file
 * and is a separate scan to fix.
 */
describe('escaper perf: inserting many escapes stays linear', () => {
  perfIt('a line of braced pairs scales near-linearly', () => {
    expectScansLinearly((input) => void escapePlainCarveInlineSyntax(input), '{^x^} ', {
      label: 'braced pairs',
      smallRepeats: 4_000,
    })
  })

  perfIt('a post of backslashes and backticks scales near-linearly', () => {
    expectScansLinearly((input) => void bbcodeToCarve(input), 'a \\ then `t` here ', {
      label: 'bbcode literal text',
      smallRepeats: 2_000,
    })
  })
})
