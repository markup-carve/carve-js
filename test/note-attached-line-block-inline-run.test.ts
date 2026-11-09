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

for (const run of ['```', '~~~~']) {
  it(`honors a physical line-block closer after ${run} verse`, () => {
    const html = carveToHtml(`r[^a]\n\n[^a]: +\n::: |\na\n${run}\n:::\n\n  tail\n`)
    expect(html).toContain(run.startsWith('`') ? '<p>a<br>\n<code></code></p>' : `<p>a<br>\n${run}</p>`)
    expect(html).toContain('<p>tail<a href="#fnref1"')
    expect(html).not.toContain('<div>\n')
  })
}

it('does not treat a closer inside a verse comment span as physical', () => {
  const html = carveToHtml('r[^a]\n\n[^a]: +\n::: |\na\n%%%\n:::\n%%%\n\n  tail\n')
  expect(html).toContain('<div class="line-block">\n        <p>a</p>\n      </div>')
  expect(html).toContain('<p>tail<a href="#fnref1"')
  expect(html).not.toContain('<p>tail</p>')
})

it('does not treat a closer inside paired code verse as physical', () => {
  const html = carveToHtml('r[^a]\n\n[^a]: +\n::: |\na\n```\n:::\n```\n\n  tail\n')
  expect(html).toContain('<code>\n:::\n</code>')
  expect(html).toContain('<p>tail<a href="#fnref1"')
  expect(html).not.toContain('<p>tail</p>')
})
