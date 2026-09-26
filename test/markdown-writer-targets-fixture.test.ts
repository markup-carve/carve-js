import { readFileSync } from 'node:fs'
import { describe, it, expect } from 'vitest'
import { carveToMarkdown } from '../src/index.js'
import { fromAstJson } from '../src/ast-json.js'
import { renderMarkdown } from '../src/render-markdown.js'

// PART 11 sections 9a and 11a, rendered against the spec's shared fixture.
const cases = JSON.parse(
  readFileSync(new URL('../spec/tests/fixtures/markdown-writer-targets.json', import.meta.url), 'utf8'),
) as { name: string; carve?: string; ast?: unknown; markdown: string }[]

describe('Markdown writer targets fixture', () => {
  it('reads a non-empty fixture', () => {
    expect(cases.length).toBeGreaterThanOrEqual(3)
  })
  for (const c of cases) {
    it(c.name, () => {
      const out = c.carve !== undefined ? carveToMarkdown(c.carve) : renderMarkdown(fromAstJson(c.ast))
      expect(out).toBe(c.markdown)
    })
  }
})
