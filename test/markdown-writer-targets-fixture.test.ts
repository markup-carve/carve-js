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

describe('adjacent lists across unmarked wrappers (PART 11 section 10o)', () => {
  it('alternates the marker when a div between two lists writes nothing of its own', () => {
    const list = (text: string) => ({
      type: 'list',
      ordered: false,
      tight: true,
      bulletChar: '-',
      items: [{ type: 'list_item', children: [{ type: 'paragraph', children: [{ type: 'text', value: text }] }] }],
    })
    const doc = fromAstJson({
      type: 'document',
      srcByteLength: 0,
      children: [list('a'), { type: 'div', children: [list('b')] }, { type: 'block_quote', children: [list('c')] }],
    })
    expect(renderMarkdown(doc)).toBe('- a\n\n* b\n\n> - c\n')
  })
})
