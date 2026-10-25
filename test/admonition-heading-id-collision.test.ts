import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

it('matches the merged C1 spec corpus row', () => {
  const source = '{#adm-1}\n# H\n\n::: warning "Careful"\nbody\n:::\n'
  const expected = '<section id="adm-1">\n  <h1>H</h1>\n  <aside class="admonition warning" aria-labelledby="adm-1-2">\n    <p class="admonition-title" id="adm-1-2">Careful</p>\n    <p>body</p>\n  </aside>\n</section>'
  expect(carveToHtml(source).trim()).toBe(expected.trim())
})

it.each([
  ['explicit heading before admonition', '{#adm-1}\n# H\n\n::: warning "Careful"\nbody\n:::\n'],
  ['automatic heading after admonition', '::: warning "Careful"\nbody\n:::\n\n# adm-1\n'],
])('%s keeps the heading id and suffixes the title id', (_name, source) => {
  const html = carveToHtml(source)
  expect(html).toContain('<section id="adm-1">')
  expect(html).toContain('aria-labelledby="adm-1-2"')
  expect(html).toContain('<p class="admonition-title" id="adm-1-2">')
})
