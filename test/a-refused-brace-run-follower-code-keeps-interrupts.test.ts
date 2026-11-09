import { expect, test } from 'vitest'
import { carveToCarve, carveToHtml } from '../src/index.js'

for (const marker of ['> q', '# h', '::: note', '| a |', '---']) {
  test(`writer keeps ${marker} in a refused run's paired fence follower`, () => {
    const input = `{.x\n.y}\n\`\`\`\n${marker}\n \`\`\`\n`
    const formatted = carveToCarve(input)
    expect(carveToHtml(formatted)).toBe(carveToHtml(input))
  })
}

test('a smart punctuation node elsewhere does not rewrite verbatim hyphens', () => {
  const input = 'a -- b\n{.x\n.y}\n```\n---\n ```\n'
  expect(carveToHtml(carveToCarve(input))).toBe(carveToHtml(input))
})
