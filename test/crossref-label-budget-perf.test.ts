import { describe, expect, it } from 'vitest'
import { carveToHtml, carveToMarkdown, carveToPlainText, carveToAnsi } from '../src/index.js'
import { abbrBudget, utf8ByteLength } from '../src/abbr-budget.js'
import { expectBuiltInputScansLinearly, perfIt } from './helpers/scaling.js'

/**
 * A cross-reference label the budget cannot afford costs nothing to skip.
 *
 * The budget caps the bytes a render writes; it did not cap the work done to
 * reach them. Every `</#slug>` rendered the target heading's whole label,
 * measured it, and only then asked the budget, so once the budget was spent
 * each later reference still paid for a render whose bytes were thrown away:
 * cost grew with references times heading length while the output stayed capped
 * (markup-carve/carve-js#2250).
 */
describe('cross-reference label expansion (work, not just output)', () => {
  /** The ticket's input: the slug is `A`, the label is long, and N of them refer to it. */
  const source = (n: number) => `# A${'!'.repeat(n - 1)}\n\n${'</#A> '.repeat(n)}\n`

  for (const [name, api] of [
    ['HTML', carveToHtml],
    ['plain text', carveToPlainText],
    ['ANSI', carveToAnsi],
  ] as const) {
    perfIt(`${name}: references to one long heading scale linearly`, () => {
      expectBuiltInputScansLinearly((input) => void api(input), source, {
        label: `${name} references to a long heading`,
      })
    })
  }

  // NO MARKDOWN ROW, and not because its label path is different: it takes the
  // same budget through the same call. Its writer picks an in-band sentinel run
  // by walking every string in the tree, and the resolver gives all N references
  // ONE shared display-text clone, so that walk reads the long heading N times
  // before rendering starts. It is a second amplification of the same shared
  // clone, in a pass this budget does not reach, and it keeps this shape
  // quadratic for Markdown after the label work is bounded
  // (markup-carve/carve-js#2269). The counted boundary below covers all four.

  it('emits exactly the labels the budget affords, and degrades the rest', () => {
    // COUNTED WORK, so it reads the same on any machine. Each reference charges
    // the rendered label's bytes, which for this heading is its length, so the
    // budget affords floor(budget / length) of them and the heading itself holds
    // one more copy. Skipping a render the budget cannot afford must not move
    // that boundary.
    const length = 10_000
    const src = source(length)
    const label = `A${'!'.repeat(length - 1)}`
    const afforded = Math.floor(abbrBudget(utf8ByteLength(src)) / length)

    expect(afforded).toBeLessThan(length)
    expect(carveToHtml(src).split(label).length - 1).toBe(afforded + 1)

    // The other three charge what THEY emit, so a target whose label carries an
    // escape pays for it and stops a reference earlier. Which side of the
    // boundary each one lands on is that target's own business; being off by
    // more than one reference is the truncation this guard is here to catch.
    for (const [name, api] of [
      ['Markdown', carveToMarkdown],
      ['plain text', carveToPlainText],
      ['ANSI', carveToAnsi],
    ] as const) {
      const emitted = api(src).split(label).length - 1
      expect(emitted, `${name} moved the degradation boundary`).toBeGreaterThanOrEqual(afforded)
      expect(emitted, `${name} moved the degradation boundary`).toBeLessThanOrEqual(afforded + 1)
    }
  })
})
