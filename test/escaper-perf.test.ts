import { describe } from 'vitest'
import { bbcodeToCarve } from '../src/bbcode-migrate.js'
import { escapePlainCarveInlineSyntax } from '../src/carve-escape.js'
import { carveToCarve } from '../src/index.js'
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

/*
 * PART 11 §2b's narrowing is a SEARCH, and a search over units is where the
 * writer can go quadratic in the document.
 *
 * `narrowEscalation` offers a group of units its minimal form all at once and
 * halves the group when that fails, so its cost is proportional to how many
 * units FAIL rather than to how many there are: a document with a handful of
 * failing units costs about log(n) renders. A document where EVERY unit fails
 * drives the halving to its leaves instead and pays a render and a parse per
 * unit, which is a render of the whole document per block.
 *
 * That shape is an ordinary document, not an adversarial one - a file of
 * indented `## H` paragraphs is every block failing - and measured without the
 * budget it was 137 ms at 50 blocks, 1265 ms at 200 and 5020 ms at 400, four
 * times the work for twice the input. The budget in `narrowEscalation` is what
 * makes it the linear shape this guard asserts, and the OUTPUT is unchanged
 * either way: every block escalates in that document because every block needs
 * it.
 */
describe('escaper perf: narrowing an escalation stays linear', () => {
  perfIt('a document where every block escalates scales near-linearly', () => {
    expectScansLinearly((input) => void carveToCarve(input), '  ## H\n\n', {
      label: 'blocks that all escalate',
      smallRepeats: 100,
    })
  })
})
