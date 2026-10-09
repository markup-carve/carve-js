import { describe, expect, it } from 'vitest'
import { carveToMarkdown } from '../src/index.js'
import cases from './fixtures/markdown-wrapper-hard-breaks.json'

describe('Markdown wrappers ending in a hard break', () => {
  for (const [index, item] of cases.entries()) {
    it(`preserves the emphasis and break in case ${index}`, () => {
      expect(carveToMarkdown(item.source)).toBe(item.markdown)
    })
  }
  it('keeps an escaped literal backslash separate from a hard break', () => {
    expect(carveToMarkdown(':: word\\\\\n: definition\n')).toBe('**word\\\\**\n\ndefinition\n')
  })
})
