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

test.each(['_a\n- b_', '_a\n1. b_', '_a\n| b_', 'para _a\n  - b_'])('keeps emphasis across paragraph marker text: %s', source => {
  expect(carveToHtml(djotToCarve(source))).toContain('<em>')
})
test.each(['![basic _image_](url)', '![basic _image_][a_b_]\n\n[a_b_]: url'])('converts image alt text: %s', source => {
  expect(carveToHtml(djotToCarve(source))).toContain('alt="basic image"')
})
test('preserves a reference fragment destination', () => {
  expect(carveToHtml(djotToCarve('[Introduction][]\n\n[Introduction]: #bar'))).toContain('href="#bar"')
})

test.each([
  ['a[^1]\n\n[^1]: note _x_', '<em>x</em>'],
  ['para\n[x]: y _z_', '<em>z</em>'],
  ['> ~~~\n> a_b *c\n> ~~~', '<code>a_b *c'],
  ['- ~~~\n  a_b\n  ~~~', '<code>a_b'],
  ['![y][r]\n\n> [r]: /i_m.png', 'src="/i_m.png"'],
  ['![# hash](x.png)', 'alt="# hash"'],
  ['![> quote](x.png)', 'alt="&gt; quote"'],
  ['![***](x.png)', 'alt="***"'],
  ['![a -- b...](x.png)', 'alt="a -- b..."'],
  ['- a\n{.x}\npara', '<p class="x">para</p>'],
  ['[a\n\n_b ] c_', '<em>b ] c</em>'],
  ['_a\n::: b_', '<em>a\n::: b</em>'],
  [': ```\n  code\n\nnext _x_', '<em>x</em>'],
  ['para\n: ```\n_b_ c\n\n_d_ e', '<em>d</em>'],
])('preserves importer context: %s', (source, expected) => {
  expect(carveToHtml(djotToCarve(source))).toContain(expected)
})

test.each([["> - ```\n>   a_b *c\n>   ```", "<code>a_b *c"], ["- [r]: /a_b_\n\n[x][r]", "href=\"/a_b_\""], ["\\![a _b_](x)", "<em>b</em>"], ["Look ![](x.png) here", "alt=\"\""], ["![{.c}](x.png)", "alt=\"\""], ["> ```\n> a_b\n\n_c_", "<em>c</em>"], ["- * a", "<li>a</li>"], ["{=_a_=} {+b_+} {-_c-}", "<ins>b_</ins>"], ["```\ncode\n```\n- _a\n- b_", "<li>_a</li>"]])('preserves nested importer context: %s', (source, expected) => {
  expect(carveToHtml(djotToCarve(source))).toContain(expected)
})

test.each([["Use `[a][]` here.\n\n[a]: /u", "<code>[a][]</code>"], ["See [Introduction][].\n\n# Introduction", "href=\"#Introduction\""], ["::: warn_ing\ntext\n:::", "class=\"warn_ing\""], ["a `x_y {#i}", "<code>x_y {#i}</code>"], ["a _b {+ c_ d", "<em>b {+ c</em>"], ["see ![_x_] here", "<em>x</em>"]])('preserves code and reference context: %s', (source, expected) => {
  expect(carveToHtml(djotToCarve(source))).toContain(expected)
})

test.each([["a [b](u){title=\"[x][]\"} c\n\n[x]: /u", "title=\"[x][]\""], ["a <http://e.com/[x][]> c\n\n[x]: /u", "href=\"http://e.com/%5Bx%5D%5B%5D\""], ["# x\n\nNote [x]: see. Go to [x][].", "href=\"#x\""], ["a `b _c_ d", "<code>b _c_ d</code>"], ["- a\n\n  b _c\n- d_ e", "b _c"], ["- x\n\n  ```\n  a\n      ```\n\nlater _em_", "<em>em</em>"]])('keeps references and delimiter runs within their native contexts: %s', (source, expected) => {
  expect(carveToHtml(djotToCarve(source))).toContain(expected)
})

test.each([[" ```\ncode _b_\n```\n\nlater _em_", "code _b_"], [" ```\ncode _b_\n```\n\nlater _em_", "<em>em</em>"], ["![a *s*{#i} c](u)", "alt=\"a s c\""], ["![a _e_{#i} c](u)", "alt=\"a e c\""]])('preserves top-level fences and attributes in image alt text: %s', (source, expected) => {
  expect(carveToHtml(djotToCarve(source))).toContain(expected)
})

test.each([["Mr. Smith\n\n ```\ncode _b_\n```\n\nlater _em_", "code _b_"], ["Mr. Smith\n\n ```\ncode _b_\n```\n\nlater _em_", "<em>em</em>"], ["Dr. Brown\n\n ```\ncode _b_\n```\n\nlater _em_", "code _b_"], ["Dr. Brown\n\n ```\ncode _b_\n```\n\nlater _em_", "<em>em</em>"], ["Fig. 1\n\n ```\ncode _b_\n```\n\nlater _em_", "code _b_"], ["Fig. 1\n\n ```\ncode _b_\n```\n\nlater _em_", "<em>em</em>"], ["(ab) prose\n\n ```\ncode _b_\n```\n\nlater _em_", "code _b_"], ["(ab) prose\n\n ```\ncode _b_\n```\n\nlater _em_", "<em>em</em>"]])('keeps prose prefixes outside list containers: %s', (source, expected) => {
  expect(carveToHtml(djotToCarve(source))).toContain(expected)
})

test.each([["- item\n\n  > quote\n\n  ```\n  code _b_\n\nlater _em_", "<em>em</em>"], ["> - item\n>\n>   > quote\n>\n>   ```\n>   code _b_\n>\n> later _em_", "<em>em</em>"]])('keeps parent list ancestry around a nested quote: %s', (source, expected) => {
  expect(carveToHtml(djotToCarve(source))).toContain(expected)
})

test.each([["> - a\n\n>   ```\n> code _b_", "code _b_"], ["> > - a\n>\n> >   ```\n> > code _b_", "code _b_"]])('ends quote ancestry at a shallower blank line: %s', (source, expected) => {
  expect(carveToHtml(djotToCarve(source))).toContain(expected)
})
