import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import { importDocument } from '../src/index.ts'

const catalog = JSON.parse(readFileSync(new URL('../../data/lint-rules.json', import.meta.url), 'utf8')) as {
  rules: { id: string }[]
}
const codes = new Set(catalog.rules.map(row => row.id))

it('uses catalog codes for BBCode tags mapped to their content and denied destinations', () => {
  for (const [input, code] of [
    ['[weird]x[/weird]', 'import-element-mapped'],
    ['[url=javascript:x]x[/url]', 'import-destination-denied'],
    ['[img]javascript:x[/img]', 'import-destination-denied'],
  ] as const) {
    const diagnostics = importDocument(input, { from: 'bbcode' }).diagnostics
    expect(diagnostics.map(entry => entry.code)).toContain(code)
    for (const entry of diagnostics) expect(codes.has(entry.code)).toBe(true)
  }
})
