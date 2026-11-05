import { expect, it } from 'vitest'
import { carveToCarve, carveToHtml, parse } from '../src/index.js'

it('collects a quoted note with the comment at its body column', () => {
  const source = '> x[^f]\n>\n> [^f]: a\n>   %% c\n'
  const expected = '> x[^f]\n\n[^f]: a\n\n  %% c\n'
  const ast = parse(source)
  expect(ast.footnoteDefs?.f?.at(-1)).toMatchObject({ type: 'comment', content: 'c' })
  expect(ast.footnoteDefPos?.f?.endLine).toBe(4)
  expect(carveToCarve(source)).toBe(expected)
  expect(carveToCarve(expected)).toBe(expected)
  expect(carveToHtml(expected)).toBe(carveToHtml(source))
})
