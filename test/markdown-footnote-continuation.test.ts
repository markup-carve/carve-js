import { expect, it } from 'vitest'
import { carveToMarkdown, markdownToCarve, parse, resolve } from '../src/index.js'

it('indents a second footnote paragraph and imports both blocks', () => {
  const source = 'see[^a]\n\n[^a]: note\n\n  second para\n'
  const markdown = 'see[^a]\n\n[^a]: note\n\n    second para\n'
  expect(carveToMarkdown(source)).toBe(markdown)
  const imported = resolve(parse(markdownToCarve(markdown)))
  expect(imported.children.map((block) => block.type)).toEqual(['paragraph'])
  expect(imported.footnoteDefs?.a?.map((block) => block.type)).toEqual(['paragraph', 'paragraph'])
  expect(carveToMarkdown(markdownToCarve(markdown))).toBe(markdown)
})

it('indents later lists and whole code fences without padding blank lines', () => {
  const source = 'see[^a]\n\n[^a]: note\n\n  - one\n    - nested\n\n  ```js\n  code\n\n  more\n  ```\n'
  const markdown = 'see[^a]\n\n[^a]: note\n\n    - one\n      - nested\n\n    ```js\n    code\n\n    more\n    ```\n'
  expect(carveToMarkdown(source)).toBe(markdown)
  expect(markdown).not.toMatch(/^ +$/m)
  const imported = resolve(parse(markdownToCarve(markdown)))
  expect(imported.children.map((block) => block.type)).toEqual(['paragraph'])
  expect(imported.footnoteDefs?.a?.map((block) => block.type)).toEqual(['paragraph', 'list', 'code_block'])
  expect(carveToMarkdown(markdownToCarve(markdown))).toBe(markdown)
})

it('preserves quotes and tables under the continuation indent', () => {
  const source = 'see[^a]\n\n[^a]: note\n\n  > quoted\n\n  | a |\n  | - |\n  | b |\n'
  const markdown = 'see[^a]\n\n[^a]: note\n\n    > quoted\n\n    | a |\n    | --- |\n    | b |\n'
  expect(carveToMarkdown(source)).toBe(markdown)
  const imported = resolve(parse(markdownToCarve(markdown)))
  expect(imported.footnoteDefs?.a?.map((block) => block.type)).toEqual(['paragraph', 'block_quote', 'table'])
  expect(carveToMarkdown(markdownToCarve(markdown))).toBe(markdown)
})

it('keeps following blocks and definitions outside a footnote', () => {
  const markdown = '- outside\n\n[^a]: note\n\n    second\n\n[^b]: other\n\n    last\n\noutside\n'
  const imported = resolve(parse(markdownToCarve(markdown)))
  expect(imported.children.map((block) => block.type)).toEqual(['list', 'paragraph'])
  expect(imported.footnoteDefs?.a?.map((block) => block.type)).toEqual(['paragraph', 'paragraph'])
  expect(imported.footnoteDefs?.b?.map((block) => block.type)).toEqual(['paragraph', 'paragraph'])
})

it('imports a body starting below an empty definition opener', () => {
  const markdown = 'see[^a]\n\n[^a]:\n    note\n\n    second\n'
  const imported = resolve(parse(markdownToCarve(markdown)))
  expect(imported.footnoteDefs?.a?.map((block) => block.type)).toEqual(['paragraph', 'paragraph'])
  expect(carveToMarkdown(markdownToCarve(markdown))).toBe('see[^a]\n\n[^a]: note\n\n    second\n')
})
