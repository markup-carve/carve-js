import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

it.each([
  ['/*[a](u[) x*/] y*/', '<p><strong><em><a href="u[">a</a> x</em></strong>] y*/</p>'],
  ['/*:x[a]{title="["} x*/] y*/', '<p><strong><em><span class="ext-x" title="[">a</span> x</em></strong>] y*/</p>'],
  ['/*<https://a.test/[> x*/] y*/', '<p><strong><em><a href="https://a.test/[">https://a.test/[</a> x</em></strong>] y*/</p>'],
])('does not treat a bracket in an opaque child as a new boundary: %s', (source, html) => {
  expect(carveToHtml(source)).toBe(html)
})
