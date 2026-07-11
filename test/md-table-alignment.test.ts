import { describe, it, expect } from 'vitest'
import { carveToMarkdown } from '../src/index.js'

describe('Markdown renderer preserves table column alignment', () => {
  it('emits :--- / :---: / ---: from the column alignment', () => {
    const out = carveToMarkdown('| a | b | c |\n|:--|:-:|--:|\n| 1 | 2 | 3 |\n')
    expect(out).toContain('| :--- | :---: | ---: |')
  })
})
