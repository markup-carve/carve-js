import { expect, it } from 'vitest'
import { carveToCarve, carveToHtml, parse } from '../src/index.js'

it('collects a quoted note with the comment at its body column', () => {
  const source = '> x[^f]\n>\n> [^f]: a\n>   %% c\n'
  const expected = '> x[^f]\n\n[^f]: a\n\n  %% c\n'
  const ast = parse(source)
  expect(ast.footnoteDefs?.f?.at(-1)).toMatchObject({ type: 'comment', content: 'c' })
  expect(carveToCarve(source)).toBe(expected)
  expect(carveToCarve(expected)).toBe(expected)
  expect(carveToHtml(expected)).toBe(carveToHtml(source))
})

it('does not extend an emptied list item through a hoisted note comment', () => {
  const source = '- [^n]: text\n    %% c\n    ```\n    code\n    ```\nafter [^n]\n'
  const ast = parse(source)
  expect(ast.footnoteDefs?.n?.some((block) => block.type === 'comment' && block.content === 'c')).toBe(true)
  expect(ast.children[0]?.type === 'list' ? ast.children[0].items[0]?.pos?.endOffset : undefined).toBe(2)
})
