import { expect, it } from 'vitest'
import { carveToCarve, carveToHtml } from '../src/index.js'

it.each([
  ['open fence, normal quote', '\n  > y\n  > ```\n', '\n> y\n> ``\n'],
  ['open fence, indented quote', '\n    > y\n  > ```\n', '\n> y\n> ``\n'],
  ['closed fence, normal quote', '  > ```\n\n  > y\n', '\n> y\n'],
  ['closed fence, indented quote', '  > ```\n\n    > y\n', '\n> y\n'],
])('writes the second quote behind a continuation marker after a raw fence: %s', (_case, sourceTail, expectedTail) => {
  const source = `- > \`\`\`=html\n  > x\n${sourceTail}`
  const expected = `- > \`\`\`=html\n  > x\n  > \`\`\`\n+${expectedTail}`
  const formatted = carveToCarve(source)
  expect(formatted).toBe(expected)
  expect(carveToHtml(formatted)).toBe(carveToHtml(source))
  expect(carveToCarve(formatted)).toBe(formatted)
})
