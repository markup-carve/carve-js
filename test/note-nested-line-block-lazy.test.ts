import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

it('keeps a below-column lazy line in a nested line block in a note', () => {
  const source = '[^f]: :: t\n    - ::: |\n      a\n     b\n\n[^f]\n'
  const html = carveToHtml(source)
  expect(html).toContain('<div class="line-block">\n            <p>a<br>\nb</p>')
  expect(html).not.toContain('<p>b</p>')
  expect(html).not.toContain('&nbsp;b')
})

for (const line of ['b', 'second line', 'x & y']) {
  it(`keeps lazy payload ${JSON.stringify(line)} in the nested line block`, () => {
    const html = carveToHtml(`[^f]: :: t\n    - ::: |\n      a\n     ${line}\n\n[^f]\n`)
    expect(html).toContain('<div class="line-block">')
    expect(html).toContain(`a<br>\n${line.replace('&', '&amp;')}`)
  })
}
