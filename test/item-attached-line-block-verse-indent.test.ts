import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

for (const marker of ['-', '1.', '- [ ]']) {
  for (const follower of ['wa', '# h']) {
    it(`keeps a source-relative verse indent under ${marker} before ${follower}`, () => {
      const html = carveToHtml(`${marker} +\n::: |\n  a\n${follower}\n`)
      expect(html).toContain('<p>&nbsp;&nbsp;a<br>\n')
    })
  }
}
