import { describe, it, expect } from 'vitest'
import { carveToHtml, carveToCarve } from '../src/index.js'

/**
 * §17 L3 (`AND FLUSH-LEFT MEANS COLUMN 0`) gives the continuation marker its
 * own control: a refused `+` behaves "exactly as if the `+` line had been a
 * comment". In the FIRST-BLOCK form - `:  +` for a description, `- +` for a
 * list item - no paragraph is open, so the `+` genuinely IS a marker and the
 * clause reads its payload's column. A payload at any column other than 0 is
 * refused, and the body ends there exactly as it ends at a comment
 * (markup-carve/carve#1821).
 *
 * WHY A RELATION AND NOT A PAIR OF GOLDENS. The clause states that two
 * SPELLINGS give one answer. Two independent goldens cannot express that: a
 * change repairing one spelling and drifting the other passes both. So the rows
 * below assert the marker spelling EQUALS its comment control across the band,
 * and the column-0 rows assert the one pair that must NOT agree - without which
 * a form that refused everything would satisfy all the rest.
 *
 * THE LIST ITEM IS NOT A FREE PASS. The oracle already answered the item and
 * did not change for it, but that is a fact about the oracle: this engine is
 * measured here too, in both containers.
 */

const marker = (container: 'description' | 'item', col: number) =>
  container === 'description'
    ? `:: t\n:  +\n${' '.repeat(col)}flush\n`
    : `- +\n${' '.repeat(col)}flush\n`

const comment = (container: 'description' | 'item', col: number) =>
  container === 'description'
    ? `:: t\n:  %% c\n${' '.repeat(col)}flush\n`
    : `- %% c\n${' '.repeat(col)}flush\n`

describe('an empty body claims no line below column 0', () => {
  it('ends the body exactly where the comment control ends it', () => {
    for (const container of ['description', 'item'] as const) {
      for (const col of [1, 2, 3, 4]) {
        expect(
          carveToHtml(marker(container, col)),
          `${container} at payload column ${col}`,
        ).toBe(carveToHtml(comment(container, col)))
      }
    }
  })

  it('leaves the payload outside the container across the refused band', () => {
    // The relation above is satisfied by any answer both spellings share, so it
    // cannot say WHICH answer. These pin the oracle's.
    const dd = '<dl>\n  <dt>t</dt>\n  <dd></dd>\n</dl>\n<p>flush</p>'
    const li = '<ul>\n  <li></li>\n</ul>\n<p>flush</p>'
    for (const col of [1, 2]) {
      expect(carveToHtml(marker('description', col)).trim()).toBe(dd)
      expect(carveToHtml(comment('description', col)).trim()).toBe(dd)
    }
    expect(carveToHtml(marker('item', 1)).trim()).toBe(li)
    expect(carveToHtml(comment('item', 1)).trim()).toBe(li)
  })

  it('keeps a line at the content column as the container first block', () => {
    // The other end of the band. A change that refused everything would pass
    // the rows above and break these.
    const dd = '<dl>\n  <dt>t</dt>\n  <dd>flush</dd>\n</dl>'
    expect(carveToHtml(marker('description', 3)).trim()).toBe(dd)
    expect(carveToHtml(comment('description', 3)).trim()).toBe(dd)
    const li = '<ul>\n  <li>flush</li>\n</ul>'
    expect(carveToHtml(marker('item', 2)).trim()).toBe(li)
    expect(carveToHtml(comment('item', 2)).trim()).toBe(li)
  })

  it('attaches at column 0, where the two spellings must differ', () => {
    // THE ONE PAIR THAT MUST NOT AGREE. At column 0 the marker is not refused,
    // so the first-block form keeps the one flush-left block it names.
    expect(carveToHtml(marker('description', 0)).trim()).toBe(
      '<dl>\n  <dt>t</dt>\n  <dd>flush</dd>\n</dl>',
    )
    expect(carveToHtml(comment('description', 0)).trim()).toBe(
      '<dl>\n  <dt>t</dt>\n  <dd></dd>\n</dl>\n<p>flush</p>',
    )
    expect(carveToHtml(marker('item', 0)).trim()).toBe('<ul>\n  <li>flush</li>\n</ul>')
    expect(carveToHtml(comment('item', 0)).trim()).toBe(
      '<ul>\n  <li></li>\n</ul>\n<p>flush</p>',
    )
    for (const container of ['description', 'item'] as const) {
      expect(carveToHtml(marker(container, 0))).not.toBe(carveToHtml(comment(container, 0)))
    }
  })

  it('keeps a marker under an open paragraph as literal text', () => {
    // NOT IN SCOPE, pinned so the port cannot quietly take it. A marker cannot
    // interrupt a paragraph, so under an open body the `+` stays literal. All
    // four containers agree and this must not change.
    expect(carveToHtml(':: t\n:  d\n   +\nflush\n').trim()).toBe(
      '<dl>\n  <dt>t</dt>\n  <dd>d\n+\nflush</dd>\n</dl>',
    )
  })

  it('writes the list item back without changing what it says', () => {
    // PART 11 §1a on the shapes this ruling creates. The item survives the
    // round trip in both spellings; the DESCRIPTION rows are the two that do
    // not, and they are deliberately not asserted here - see the writer note in
    // markup-carve/carve-js#1557. Pinning the half that holds keeps a later
    // change from quietly breaking it too.
    for (const src of ['- +\n flush\n', '- %% c\n flush\n']) {
      expect(carveToHtml(carveToCarve(src)), src).toBe(carveToHtml(src))
      expect(carveToCarve(carveToCarve(src)), src).toBe(carveToCarve(src))
    }
  })
})
