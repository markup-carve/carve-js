import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

for (const run of ['`', '```', '~~~~']) {
  it(`does not close an inline ${run} with a generated fence`, () => {
    const html = carveToHtml(`r[^a]\n\n[^a]: +\n::: |\n  a\n${run}\n`)
    if (run.startsWith('`')) expect(html).toContain('<code></code>')
    else expect(html).toContain('~~~~')
    expect(html).not.toContain('<code>\n</code>')
  })
}
