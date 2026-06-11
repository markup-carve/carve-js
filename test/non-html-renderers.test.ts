import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { carveToMarkdown, carveToPlainText, carveToAnsi } from '../src/index.js'

/**
 * Parity oracle for the non-HTML renderers. There is no cross-impl corpus for
 * non-HTML output, so carve-php's Markdown / PlainText / ANSI output (captured
 * in fixtures/non-html-golden.json) is the reference these must reproduce.
 */
const here = dirname(fileURLToPath(import.meta.url))
const golden = JSON.parse(
  readFileSync(resolve(here, 'fixtures/non-html-golden.json'), 'utf8'),
) as Record<string, { carve: string; markdown: string; plain: string; ansi: string }>

for (const [name, g] of Object.entries(golden)) {
  describe(`non-html parity: ${name}`, () => {
    it('markdown', () => expect(carveToMarkdown(g.carve)).toBe(g.markdown))
    it('plain', () => expect(carveToPlainText(g.carve)).toBe(g.plain))
    it('ansi', () => expect(carveToAnsi(g.carve)).toBe(g.ansi))
  })
}
