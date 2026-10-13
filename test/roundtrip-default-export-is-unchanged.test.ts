import { readFileSync } from 'node:fs'
import { expect, test } from 'vitest'
import { carveToHtml, carveToMarkdown } from '../src/index.js'

const pin = JSON.parse(readFileSync(new URL('fixtures/roundtrip-default-export-pin.json', import.meta.url), 'utf8'))

test('default export preserves the captured bytes', () => {
  expect(carveToHtml(pin.source)).toBe(pin.html)
  expect(carveToHtml(pin.source, { roundtrip: false })).toBe(pin.html)
  expect(carveToMarkdown(pin.source)).toBe(pin.markdown)
})
