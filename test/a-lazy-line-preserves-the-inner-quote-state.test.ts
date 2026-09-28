import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

const rows = JSON.parse(readFileSync(new URL('./fixtures/nested-quote-lazy-state.json', import.meta.url), 'utf8')) as { name: string; source: string; html: string }[]
it('keeps the complete regression population', () => expect(rows).toHaveLength(22))
for (const row of rows) it(row.name, () => {
  expect(carveToHtml(row.source).trim()).toBe(row.html)
})
