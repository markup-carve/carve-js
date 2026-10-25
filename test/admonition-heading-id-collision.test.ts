import { expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { carveToHtml } from '../src/index.js'

it('matches the merged C1 spec corpus row', () => {
  const slug = '663-a-titled-admonition-skips-an-authored-heading-id'
  const source = readFileSync(new URL(`../spec/tests/corpus/${slug}.crv`, import.meta.url), 'utf8')
  const expected = readFileSync(new URL(`../spec/tests/corpus/${slug}.html`, import.meta.url), 'utf8')
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
