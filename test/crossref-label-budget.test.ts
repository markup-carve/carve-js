import { describe, it, expect } from 'vitest'
import { carveToHtml, carveToMarkdown, carveToPlainText, carveToAnsi, carveToCarve } from '../src/index.js'
import { ABBR_BUDGET_BASE, ABBR_BUDGET_FACTOR, abbrBudget, utf8ByteLength } from '../src/abbr-budget.js'

/**
 * A cross-reference label is a derived-text expansion, and it is budgeted.
 *
 * `</#slug>` republishes the target heading's whole display text while costing
 * only the slug, so K references to one long heading emit `K * heading_len`
 * bytes. That is the abbreviation expansion's shape, so it charges the
 * abbreviation expansion's budget (markup-carve/carve-js#892).
 */
describe('cross-reference label expansion (DoS guard)', () => {
  /** A heading of mostly non-slug characters: the slug is `A`, the text is long. */
  const source = (headingLen: number, references: number) =>
    `# A${'!'.repeat(headingLen - 1)}\n\n${'</#A> '.repeat(references)}\n`

  const HEADING = 10_000
  const REFERENCES = 1_600
  const src = source(HEADING, REFERENCES)
  const budget = abbrBudget(utf8ByteLength(src))
  /** Budget, plus what each reference pays for itself, plus slack. */
  const ceiling = budget + 60 * REFERENCES + 10_000

  it('keeps the budget policy identical to carve-rs and carve-php', () => {
    expect(ABBR_BUDGET_BASE).toBe(1_000_000)
    expect(ABBR_BUDGET_FACTOR).toBe(8)
    // The naive output is the heading text once per reference.
    expect(HEADING * REFERENCES).toBeGreaterThan(4 * ceiling)
  })

  for (const [name, api] of [
    ['HTML', carveToHtml],
    ['Markdown', carveToMarkdown],
    ['plain text', carveToPlainText],
    ['ANSI', carveToAnsi],
  ] as const) {
    it(`${name}: the label expansion stays within the budget`, () => {
      expect(utf8ByteLength(api(src))).toBeLessThan(ceiling)
    })
  }

  it('does not multiply the output when the input doubles', () => {
    // Unbudgeted, output grows with the square of the input, so the RATIO
    // doubles with it. That is the property to pin, not any single size.
    const small = source(5_000, 800)
    const large = source(10_000, 1_600)
    const smallRatio = utf8ByteLength(carveToHtml(small)) / utf8ByteLength(small)
    const largeRatio = utf8ByteLength(carveToHtml(large)) / utf8ByteLength(large)
    expect(largeRatio).toBeLessThan(smallRatio)
  })

  it('degrades an over-budget label to the authored target, not to nothing', () => {
    // The way an over-budget abbreviation degrades to its plain key: the
    // reference still anchors, labelled with what the author typed.
    expect(carveToHtml(src)).toContain('<a href="#A">A</a>')
  })

  it('sizes every target from the same document', () => {
    // On an input where 8 x length clears the 1 MB floor, a target that never
    // installed a budget would fall back to the floor and emit far less. That
    // is what the plain-text target did before it was given one.
    const big = source(50_000, 50_000)
    expect(8 * utf8ByteLength(big)).toBeGreaterThan(2_000_000)
    const html = utf8ByteLength(carveToHtml(big))
    for (const [name, api] of [
      ['Markdown', carveToMarkdown],
      ['plain text', carveToPlainText],
      ['ANSI', carveToAnsi],
    ] as const) {
      const ratio = utf8ByteLength(api(big)) / html
      expect(ratio, `${name} is not sharing one budget with HTML`).toBeGreaterThan(0.75)
      expect(ratio, `${name} is not sharing one budget with HTML`).toBeLessThan(1.25)
    }
    expect(utf8ByteLength(carveToPlainText(big))).toBeGreaterThan(2_000_000)
  })

  it('leaves the Carve target alone', () => {
    // PART 11 §1 makes its contract to give the author's document back
    // (markup-carve/carve#759): it re-emits `</#A>` rather than the label, so
    // it never amplified and must not gain a budget.
    const out = carveToCarve(src)
    expect(utf8ByteLength(out)).toBeLessThan(utf8ByteLength(src) + 100)
    expect(out).toContain('</#A>')
  })

  it('CONTROL: an ordinary document renders every label in full', () => {
    const ordinary = '# The Long Heading Here\n\nsee </#the-long-heading-here> and </#the-long-heading-here>\n'
    expect(carveToHtml(ordinary).split('The Long Heading Here').length - 1).toBe(3)
    expect(carveToPlainText(ordinary).split('The Long Heading Here').length - 1).toBe(3)
    expect(carveToMarkdown(ordinary).split('The Long Heading Here').length - 1).toBe(3)
    expect(carveToAnsi(ordinary).split('The Long Heading Here').length - 1).toBe(3)
  })
})
