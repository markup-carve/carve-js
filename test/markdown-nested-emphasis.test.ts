import { expect, it } from 'vitest'
import { carveToMarkdownWithReport, parse, renderMarkdownWithReport, resolve } from '../src/index.js'
import controls from './fixtures/markdown-nested-emphasis.json'

// Native Carve HTML and cmark-gfm readback validate these Markdown goldens.
it.each(controls)('keeps nested emphasis during Markdown export: $source', ({ source, markdown }) => {
  for (const result of [carveToMarkdownWithReport(source), renderMarkdownWithReport(resolve(parse(source)))]) {
    expect(result.value).toBe(markdown.js)
    expect(result.losses).toEqual([])
    expect(result.totalLosses).toBe(0)
    expect(result.truncated).toBe(false)
  }
})
