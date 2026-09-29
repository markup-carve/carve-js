/*
 * Escaping a `[` takes it out of the run, so the `]` that answered it falls
 * through to the next opener out - and where THAT pair crosses the same
 * formatting boundary a second escape is owed. Only the closer can pay it,
 * because the outer opener keeps its bare form, which is what makes the rule
 * terminal at two passes.
 *
 * So the decision needs the completed run twice: pair it, name the crossing
 * openers, pair it again with those openers gone. One forward pass cannot reach
 * it, because which brackets survive is not known until the run is finished.
 * markup-carve/carve-rs#2211 measured the same shape as `carve fmt` spending one
 * more backslash per bracket level.
 *
 * AN ESCAPED CLOSER ANSWERS NOTHING, so its opener stays open for the next `]`
 * instead of being spent on it. Spending it leaves a second crossing `]` bare and
 * `carve fmt` writes that escape itself, which is the same drift one bracket
 * further in. carve-rs at `125be7b0` still does that, so the multi-closer shapes
 * below follow carve-php, which is the writer that settles.
 *
 * Every spelling here is byte-identical on carve-php at `0cb5a06b`, and on
 * carve-rs at `125be7b0` except where noted, and each one reads back as the HTML
 * that wrote it through the spec's own reader at the pinned spec `aa3678a2`.
 */
import { describe, expect, it } from 'vitest'
import { carveToCarve, carveToHtml, htmlToCarve } from '../src/index.js'

const imported = (html: string): string => htmlToCarve(html).value

describe('a crossing bracket escape is decided on the completed run', () => {
  it.each([
    ['<p>[[<ins>a]</ins>]</p>', '[\\[{+a\\]+}]'],
    ['<p>[[<del>a]</del>]</p>', '[\\[{-a\\]-}]'],
    ['<p>[[[<ins>a]</ins>]]</p>', '[[\\[{+a\\]+}]]'],
    ['<p>[[[<del>a]</del>]]</p>', '[[\\[{-a\\]-}]]'],
    ['<p>[[<mark>a]</mark>]</p>', '[\\[=a\\]=]'],
    ['<p>[[<strong>a]</strong>]</p>', '[\\[*a\\]*]'],
  ])('a crossing pair nested in a literal pair escapes its closer: %s', (html, expected) => {
    expect(imported(html)).toBe(`${expected}\n`)
  })

  it.each([
    ['<p>[<ins>a]</ins></p>', '\\[{+a]+}'],
    ['<p>[<sup>a]</sup></p>', '\\[{^a]^}'],
    ['<p>[<em>a](b)</em></p>', '\\[/a](b)/'],
    ['<p>[<em>a]</em></p>', '\\[/a]/'],
    ['<p>[<ins>a]</ins>]</p>', '\\[{+a]+}]'],
  ])('a lone crossing pair still spends one escape: %s', (html, expected) => {
    expect(imported(html)).toBe(`${expected}\n`)
  })

  /*
   * TWO crossing closers answered by ONE surviving opener. carve-rs writes
   * `[\\[\\[{+\\]]+}` here and `carve fmt` adds a backslash to it; carve-php writes
   * these bytes and formats them to themselves.
   */
  it.each([
    ['<p>[[[<ins>]]</ins></p>', '[\\[\\[{+\\]\\]+}'],
    ['<p>[[[[<ins>]]]</ins></p>', '[\\[\\[\\[{+\\]\\]\\]+}'],
    ['<p>[[[<sup>a]]</sup>]</p>', '[\\[\\[{^a\\]\\]^}]'],
    ['<p>[[<em>]]</em></p>', '\\[\\[/]]/'],
  ])('one surviving opener answers every crossing closer: %s', (html, expected) => {
    const out = imported(html)
    expect(out).toBe(`${expected}\n`)
    expect(carveToCarve(out)).toBe(out)
    expect(carveToHtml(out)).toBe(html)
  })

  it('escapes two openers and no closer where both pairs cross', () => {
    // The case a rule keyed on "the stack is not empty" gets wrong: both openers
    // cross, neither survives the second reading, and no closer is owed anything.
    // This is why the second reading pairs the run rather than testing a depth.
    expect(imported('<p>[[<sup>a]</sup><ins>b]</ins>]</p>')).toBe('\\[\\[{^a]^}{+b]+}]\n')
  })

  it.each([
    ['<p>[a](b)</p>', '[a]\\(b)'],
    ['<p>[a<em>x</em>b](c)</p>', '[a{/x/}b]\\(c)'],
    ['<p>[<em>a</em>](b)</p>', '[/a/]\\(b)'],
    ['<p>[<ins>a</ins>](b)</p>', '[{+a+}]\\(b)'],
  ])('CONTROL - a pair inside one host crosses nothing in either reading: %s', (html, expected) => {
    expect(imported(html)).toBe(`${expected}\n`)
  })

  /*
   * THE DEFECT ITSELF was that the writer disagreed with its own formatter, so
   * four passes are taken rather than one: a missing escape reappears as a new
   * backslash on a later pass, not on the first.
   */
  it('formats its own output to itself over four passes', () => {
    const drift: string[] = []
    for (const html of [
      '<p>[<ins>a]</ins></p>',
      '<p>[[<ins>a]</ins>]</p>',
      '<p>[[[<ins>a]</ins>]]</p>',
      '<p>[<ins>a](b)</ins></p>',
      '<p>[<ins>a]</ins>]</p>',
      '<p>[<del>a]</del></p>',
      '<p>[[<del>a]</del>]</p>',
      '<p>[[[<del>a]</del>]]</p>',
      '<p>[<sup>a]</sup></p>',
      '<p>[[<sup>a]</sup>]</p>',
      '<p>[[[<sup>a]</sup>]]</p>',
      '<p>[<sub>a]</sub></p>',
      '<p>[[<sub>a]</sub>]</p>',
      '<p>[<em>a]</em></p>',
      '<p>[[<em>a]</em>]</p>',
      '<p>[<strong>a]</strong></p>',
      '<p>[[<strong>a]</strong>]</p>',
      '<p>[<mark>a]</mark></p>',
      '<p>[[<mark>a]</mark>]</p>',
      '<p>[<u>a]</u></p>',
      '<p>[<s>a]</s></p>',
      '<p>[<sup><ins>a]</ins></sup></p>',
      '<p>[<ins><sup>a]</sup></ins></p>',
      '<p>[[<sup>a]</sup><ins>b]</ins>]</p>',
      '<p>[<ins>a]</ins><del>b</del></p>',
      '<p>[[[<ins>]]</ins></p>',
      '<p>[[[[<ins>]]]</ins></p>',
      '<p>[[[<sup>a]]</sup>]</p>',
      '<p>[[<em>]]</em></p>',
    ]) {
      const once = imported(html)
      let formatted = once
      for (let pass = 1; pass <= 4; pass++) {
        formatted = carveToCarve(formatted)
        if (formatted !== once) {
          drift.push(`${html} imported as ${once} and pass ${pass} wrote ${formatted}`)
          break
        }
      }
      if (carveToHtml(once) !== html) drift.push(`${html} imported as ${once} reads back as ${carveToHtml(once)}`)
    }
    expect(drift).toEqual([])
  })
})
