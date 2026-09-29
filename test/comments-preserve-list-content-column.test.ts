import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

const cases: { source: string, html: string }[] = JSON.parse(readFileSync(new URL('./fixtures/comment-list-content-column.json', import.meta.url), 'utf8'))
for (const { source, html } of cases) {
  it(`comments preserve the list content column: ${JSON.stringify(source)}`, () => {
    expect(carveToHtml(source).trim()).toBe(html)
  })
}
