import { describe, expect, it } from 'vitest'
import { carveToMarkdown, renderMarkdown } from '../src/index.js'
import { markdownToCarve } from '../src/markdown-migrate.js'

describe('a tight item has no blank before its sub-list', () => {
  it('keeps the reported list tight through Markdown', () => {
    const source = '- fruit\n  - apples\n  - oranges\n- vegetables\n'
    const markdown = carveToMarkdown(source)

    expect(markdown).toBe(source)
    expect(markdownToCarve(markdown)).toBe(source)
  })

  it('does the same for ordered and nested hosts', () => {
    expect(carveToMarkdown('1. fruit\n   - apples\n2. vegetables\n')).toBe(
      '1. fruit\n   - apples\n2. vegetables\n',
    )
    expect(carveToMarkdown('- outer\n  - fruit\n    - apples\n  - vegetables\n')).toBe(
      '- outer\n  - fruit\n    - apples\n  - vegetables\n',
    )
  })

  it('keeps the separator in a loose item', () => {
    const source = '{loose}\n- fruit\n\n  - apples\n- vegetables\n'
    expect(carveToMarkdown(source)).toBe('- fruit\n\n  - apples\n- vegetables\n')
  })

  it('keeps the separator when a non-1 ordered sub-list cannot interrupt', () => {
    const source = '- fruit\n  3. apples\n  4. pears\n- vegetables\n'
    expect(carveToMarkdown(source)).toBe('- fruit\n\n  3. apples\n  4. pears\n- vegetables\n')
  })

  it('keeps an empty first sub-list item from becoming a setext underline', () => {
    const paragraph = {
      type: 'paragraph' as const,
      children: [{ type: 'text' as const, value: 'fruit' }],
    }
    const emptyItem = { type: 'list_item' as const, children: [] }
    const document = {
      type: 'document' as const,
      children: [
        {
          type: 'list' as const,
          ordered: false,
          tight: true,
          items: [
            {
              type: 'list_item' as const,
              children: [
                paragraph,
                { type: 'list' as const, ordered: false, tight: true, items: [emptyItem] },
              ],
            },
          ],
        },
      ],
    }

    expect(renderMarkdown(document)).toBe('- fruit\n\n  -\n')
  })

  it('checks what the first sub-list item renders, not whether its AST is empty', () => {
    const source = '- fruit\n  - %% note\n  - apples\n- vegetables\n'
    expect(carveToMarkdown(source)).toBe('- fruit\n\n  -\n  - apples\n- vegetables\n')
  })
})
