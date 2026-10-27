import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'
import { readFileSync } from 'node:fs'

const cases: Array<{ name: string; source: string; html: string }> = JSON.parse(
  readFileSync(new URL('./fixtures/description-boundary-2316.json', import.meta.url), 'utf8'),
)
const currentRuling: Record<string, string> = JSON.parse(
  readFileSync(new URL('./fixtures/description-boundary-current-ruling.json', import.meta.url), 'utf8'),
)

// The original oracle fixture remains intact; these assertions select the later blank-run ruling.
it.each(cases)('$name', ({ name, source, html }) => {
  expect(carveToHtml(source)).toBe(currentRuling[name] ?? html)
})
