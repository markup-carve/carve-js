import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

for (const lead of ['- {.x', '- +\n{.x']) {
  for (const marker of ['- n', '1. n']) {
    it(`keeps ${marker} as paragraph continuation after ${lead}`, () => {
      const html = carveToHtml(`${lead}\n.y}\n  ${marker}\n`)
      expect(html).toContain(`{.x\n.y}\n${marker}`)
      expect(html).not.toContain('<ul>\n      <li>n')
    })
  }
}
