import { expect, test } from 'vitest'
import { djotToCarve, carveToHtml } from '../src/index.js'

test.each([
  ['_(_foo_)_', '<p><em>(</em>foo<em>)</em></p>'],
  ['_({_foo_})_', '<p><em>(foo)</em></p>'],
  ['{_ x_ _} _x_}', '<p><em> x_ </em> _x_}</p>'],
  ['*****a*****', '<p><strong>a</strong></p>'],
  ['foo*bar*baz', '<p>foo<strong>bar</strong>baz</p>'],
  ['_}b_', '<p>_}b_</p>'],
  ['___', '<p>___</p>'],
  ['_[bar_](url)', '<p><em>[bar</em>](url)</p>'],
  ['_<http://example.com/a_b>', '<p>_<a href="http://example.com/a_b">http://example.com/a_b</a></p>'],
  ['[basic _link_][a_b_]\n\n[a_b_]: url', '<p><a href="url">basic <em>link</em></a></p>'],
  ['_a {.c}_', '<p><em>a </em></p>'],
  ['*a {.c}*', '<p><strong>a </strong></p>'],
  ['~_x_~', '<p><sub><em>x</em></sub></p>'],
  ['^_x_^', '<p><sup><em>x</em></sup></p>'],
  ['_a_+ b', '<p><em>a</em>+ b</p>'],
  ['x {.a}{.b}', '<p>x</p>'],
  ['a\n{.c}\nb', '<p>a\nb</p>'],
  ['_emph_{.a}', '<p><em class="a">emph</em></p>'],
  ['*s*{#id .cls key=val}', '<p><strong id="id" class="cls" key="val">s</strong></p>'],
  ['{+ins+}{.a}', '<p><ins class="a">ins</ins></p>'],
  ['^sup^{.a}', '<p><sup class="a">sup</sup></p>'],
  ['x_y_{.c}', '<p>x<em class="c">y</em></p>'],
  ['(some text){.attr}', '<p>(some <span class="attr">text)</span></p>'],
])('Djot emphasis pairing: %s', (source, expected) => {
  expect(carveToHtml(djotToCarve(source)).trim()).toBe(expected)
})

test.each(['```', '~~~'])('a definition marker can open a fenced description: %s', fence => {
  const html = carveToHtml(djotToCarve(`: ${fence}\n  ok\n  ${fence}\n`))
  expect(html.trim()).toBe('<dl>\n  <dt></dt>\n  <dd>\n    <pre><code>ok\n</code></pre>\n  </dd>\n</dl>')
})

test.each([
  ['``` =html\n<b>_x</b>\n```', '<b>_x</b>'],
  ['[r]: /u_v\n\n[x][r]', '<p><a href="/u_v">x</a></p>'],
  ['![alt_x](u.png)', '<img src="u.png" alt="alt_x">'],
  ['_a\n```\nx\n```\nb_', '<p>_a</p>\n<pre><code>x\n</code></pre>\n<p>b_</p>'],
])('opaque block and image label ownership: %s', (source, expected) => {
  expect(carveToHtml(djotToCarve(source)).trim()).toBe(expected)
})

test('inline code in a definition term remains in the term', () => {
  expect(carveToHtml(djotToCarve(': ```a```')).trim()).toBe('<dl>\n  <dt><code>a</code></dt>\n</dl>')
})

test('deep same-kind spans migrate without using the call stack', () => {
  expect(djotToCarve('{_'.repeat(10000) + 'x' + '_}'.repeat(10000))).toBe('{/x/}')
})
