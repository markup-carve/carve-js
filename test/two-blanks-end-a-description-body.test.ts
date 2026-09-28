import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'
import { readFileSync } from 'node:fs'

const cases: Array<{ name: string; source: string; html: string }> = JSON.parse(
  readFileSync(new URL('./fixtures/description-boundary-2316.json', import.meta.url), 'utf8'),
)

// Expected HTML measured with the spec oracle at e24e38e9 (#2316).
it.each(cases)('$name', ({ source, html }) => {
  expect(carveToHtml(source)).toBe(html)
})
