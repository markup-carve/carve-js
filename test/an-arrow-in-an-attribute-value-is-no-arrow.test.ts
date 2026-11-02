import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

const html = (source: string) => carveToHtml(source).trim()

for (const [host, inner] of [
  ['`a`', '<code k="~&gt;">a</code>'],
  ['{+a+}', '<ins k="~&gt;">a</ins>'],
  ['{*a*}', '<strong k="~&gt;">a</strong>'],
  ['[a](/i)', '<a href="/i" k="~&gt;">a</a>'],
  ['[a]', '<span k="~&gt;">a</span>'],
  [':x:', '<span k="~&gt;">:x:</span>'],
] as const) {
  it(`keeps an arrow in the attribute value of ${host} out of the frame`, () => {
    expect(html(`{~${host}{k="~>"}b~}`)).toBe(`<p><s>${inner}b</s></p>`)
    expect(html(`{~${host}{k="~>"}b~>c~}`)).toBe(`<p><del>${inner}b</del><ins>c</ins></p>`)
  })
}

it('reads past a chain of attribute blocks', () => {
  expect(html('{~`a`{k="~>"}{j="~>"}b~}')).toBe('<p><s><code k="~&gt;" j="~&gt;">a</code>b</s></p>')
})

it('still finds an arrow behind a brace that is no attribute block', () => {
  expect(html('{~`a`{"~>"}b~}')).toContain('<del>')
  expect(html('{~`a`{ }{k="~>"}b~}')).toContain('<del>')
})
