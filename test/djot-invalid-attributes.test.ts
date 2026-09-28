import { expect, it } from 'vitest'
import { carveToHtml, djotToCarve } from '../src/index.js'

it.each([
  [
    "[not a span]{#a<b}\n",
    "<p>[not a span]{#a&lt;b}</p>"
  ],
  [
    "[*not* a span]{#a<b}\n",
    "<p>[<strong>not</strong> a span]{#a&lt;b}</p>"
  ],
  [
    "[not a span]{#a\n",
    "<p>[not a span]{#a</p>"
  ],
  [
    "[hi]{#id key=\"{#x\"}",
    "<p><span id=\"id\" key=\"{#x\">hi</span></p>"
  ],
  [
    "`{#a<b}`",
    "<p><code>{#a&lt;b}</code></p>"
  ],
  [
    "{#a `x}` y",
    "<p>{#a <code>x}</code> y</p>"
  ],
  [
    "{#a\\} b",
    "<p>{#a} b</p>"
  ]
])('keeps invalid Djot attributes literal: %s', (source, expected) => {
  expect(carveToHtml(djotToCarve(source))).toBe(expected)
})

it('does not invent a hashtag in an unterminated attribute', () => {
  const html = carveToHtml(djotToCarve('{#id .cla*ss*'))
  expect(html).not.toContain('class="tag"')
  expect(html).toContain('{#id')
})

it.each(['a {"q\n\nlater {#b', 'a {%q\n\nlater {#b'])('resumes after an unfinished attribute paragraph: %s', source => {
  expect(carveToHtml(djotToCarve(source))).not.toContain('class="tag"')
})
it('keeps braces inside an autolink destination', () => {
  expect(djotToCarve('<https://x.y/{#a>')).toContain('<https://x.y/{#a>')
})
