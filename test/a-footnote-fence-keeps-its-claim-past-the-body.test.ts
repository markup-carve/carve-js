import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

// carve#3891: a closer at or past the body column counts even after a line below it (carve-js#3877).
const fence = (first: string, below: string, closer: string): string =>
  `x[^1]\n\n[^1]: ${first}\n  \`\`\`\n  p\n${below}\n${closer}\`\`\`\n`

it.each(['> q', 'para', '- c'])('opens the fence after %j when the closer stands at the body column', (first) => {
  for (const below of ['c', '- c']) {
    const html = carveToHtml(fence(first, below, '  '))
    expect(html).toContain('<pre><code>p\n</code></pre>')
  }
})

it('leaves a fence closed only below the body column as inline text', () => {
  const html = carveToHtml(fence('> q', 'c', ''))
  expect(html).not.toContain('<pre>')
})
