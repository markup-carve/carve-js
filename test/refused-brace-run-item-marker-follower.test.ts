import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

// A refused brace run claims no lines, so a marker at the item's content column opens a nested list (carve#5830).
for (const lead of ['- {.x', '- +\n{.x']) {
  for (const [marker, list] of [['- n', 'ul'], ['1. n', 'ol']]) {
    it(`opens a nested list at ${marker} after ${lead}`, () => {
      expect(carveToHtml(`${lead}\n.y}\n  ${marker}\n`)).toBe(
        `<ul>\n  <li>{.x\n.y}\n    <${list}>\n      <li>n</li>\n    </${list}>\n  </li>\n</ul>`)
    })
  }
}
