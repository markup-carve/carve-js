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

/*
 * PART 11 §2's per-OPENER-OCCURRENCE test runs the same search ONE LEVEL FINER,
 * which is one level more of the same risk (markup-carve/carve#1533).
 *
 * `narrowOccurrences` offers the candidate sites inside the units that stayed
 * escalated, halving a group when it fails, so its cost is proportional to how
 * many OCCURRENCES fail rather than to how many there are. The shape that finds
 * its leaves is a document where a load-bearing occurrence sits beside an idle
 * one on every line, so no group above a leaf can be relaxed whole: a paragraph
 * of indented table rows is exactly that - the leading `|` opens a row and the
 * trailing one opens nothing - and it is ordinary input rather than an
 * adversarial one.
 *
 * MEASURED BOTH WAYS on this shape at 50/100/200/400 rows, over the unit search
 * carve-js#1330 narrowed. With the budget: 45 / 89 / 171 / 362 ms, and 64 / 72 /
 * 80 / 88 occurrence renders - the log(n) the bound buys. Without it the halving
 * reaches its leaves and pays a render of the whole document per occurrence.
 *
 * THE GUARD ITSELF reads 3.61x per byte without the budget and well inside 2.0
 * with it - so it fails on the unbounded search rather than sitting just above
 * it. The `## H` guard above covers the same code and reads 3.50x unbounded,
 * and it is kept beside this one rather than instead of it: there the UNIT
 * search's own bounded cost is part of the reading.
 *
 * The millisecond columns are for the shape of the curve and not for a
 * threshold - four times the work for twice the input, against the flat
 * per-byte cost the ratio asserts. A threshold in milliseconds would describe
 * the machine that chose it, which is the whole reason this file measures a
 * ratio.
 *
 * THE OUTPUT IS WIDER WHERE THE BUDGET BINDS, NEVER NARROWER. A document that
 * spends it keeps escapes §2 would have retired - the same trade `narrowEscalation`
 * already takes - and every state the search returns has been verified against the
 * conservative form's own re-parse. On the corpus the budget never binds: 51
 * documents reach the search, the most expensive spends 16 renders on 7
 * occurrences, and no document offers more than 7 - carve-js#1330 narrowed the
 * unit search to the units the writer actually asks about, and the occurrence
 * search inherits that smaller candidate set.
 */
describe('escaper perf: narrowing to the occurrence stays linear', () => {
  perfIt('a document where every line holds a failing and an idle candidate scales near-linearly', () => {
    expectScansLinearly((input) => void carveToCarve(input), ' | a |\n', {
      label: 'lines that all escalate one occurrence',
      smallRepeats: 100,
    })
  })
})
