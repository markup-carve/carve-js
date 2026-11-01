import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

for (const [host, source] of [
  ['item', '- :: t\n  : ```\n    ```\n    ^ p\nz\n'],
  ['note', '[^0]: :: t\n  : ```\n    ```\n    ^ p\nz\n\n[^0]\n'],
] as const) {
  it(`keeps a caption follower in a nested description under a ${host}`, () => {
    const html = carveToHtml(source)
    expect(html).toContain('<figcaption>p\nz</figcaption>')
    expect(html).not.toContain('<p>z</p>')
  })
}

it('ends the caption at a blank line', () => {
  const html = carveToHtml('- :: t\n  : ```\n    ```\n    ^ p\n\nz\n')
  expect(html).toContain('<figcaption>p</figcaption>')
  expect(html).toContain('<p>z</p>')
})
