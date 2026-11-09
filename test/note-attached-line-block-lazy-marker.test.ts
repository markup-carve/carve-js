import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

for (const marker of ['- sib', '* sib', '1. sib']) {
  it(`keeps ${marker} as lazy verse in a note-attached line block`, () => {
    const html = carveToHtml(`r[^a]\n\n[^a]: +\n::: |\n  a\n${marker}\n`)
    expect(html).toContain(`<p>&nbsp;&nbsp;a<br>\n${marker}</p>`)
    expect(html).not.toContain('<ul>')
    expect(html).not.toContain('<ol>\n  <li>sib')
  })
}
