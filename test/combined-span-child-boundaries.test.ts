import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

it.each([
  ['/*:x[a*/ b]*/', '<p><strong><em><span class="ext-x">a*/ b</span></em></strong></p>'],
  ['/*[a](u*/) b*/', '<p><strong><em><a href="u*/">a</a> b</em></strong></p>'],
  ['/*![a](u*/) b*/', '<p><strong><em><img src="u*/" alt="a"> b</em></strong></p>'],
  ['/*:x[a]{title="v*/ w"} q*/', '<p><strong><em><span class="ext-x" title="v*/ w">a</span> q</em></strong></p>'],
  ['/*<https://a.test/x*/y> q*/', '<p><strong><em><a href="https://a.test/x*/y">https://a.test/x*/y</a> q</em></strong></p>'],
  ['/*[a]{title="v*/ w"} q*/', '<p><strong><em><span title="v*/ w">a</span> q</em></strong></p>'],
  ['/*[a*/ b] q*/', '<p><strong><em>[a*/ b] q</em></strong></p>'],
  ['/*`a*/ b` q*/', '<p><strong><em><code>a*/ b</code> q</em></strong></p>'],
])('keeps a combined closer outside a child boundary: %s', (source, html) => {
  expect(carveToHtml(source)).toBe(html)
})
