import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

it('reads a quoted note marker-line plus follower as one closed code fence', () => {
  const source = '> [^m]: +\n>   ```\n>   x\n>   ```\n\nsee[^m]\n'
  expect(carveToHtml(source)).toContain('<pre><code>x\n</code></pre>')
  expect(carveToHtml(source)).not.toContain('<p><code>')
})
