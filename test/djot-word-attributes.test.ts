import { expect, it } from 'vitest'
import { carveToHtml, djotToCarve } from '../src/index.js'

it.each([
  [
    "_b{.c}_",
    "<p><em><span class=\"c\">b</span></em></p>"
  ],
  [
    "~b{.c}~",
    "<p><sub><span class=\"c\">b</span></sub></p>"
  ],
  [
    "{+b{.c}+}",
    "<p><ins><span class=\"c\">b</span></ins></p>"
  ],
  [
    "[a](b)c{.d}",
    "<p><a href=\"b\">a</a><span class=\"d\">c</span></p>"
  ],
  [
    "![i](s.png)t{.c}",
    "<p><img src=\"s.png\" alt=\"i\"><span class=\"c\">t</span></p>"
  ],
  [
    "<http://x.y>{.c}",
    "<p><a href=\"http://x.y\" class=\"c\">http://x.y</a></p>"
  ],
  [
    "x_y{.c}",
    "<p><span class=\"c\">x_y</span></p>"
  ]
,
  [
    "a *b{#id key=\"*\"}o\n",
    "<p>a <span id=\"id\" key=\"*\">*b</span>o</p>"
  ],
  [
    "hi{key=\"{#hi\"}\n",
    "<p><span key=\"{#hi\">hi</span></p>"
  ],
  [
    "hi\\{key=\"abc{#hi}\"\n",
    "<p>hi{key=\u201c<span id=\"hi\">abc</span>\u201d</p>"
  ],
  [
    "hi{#id .class\nkey=\"value\"}\n",
    "<p><span id=\"id\" class=\"class\" key=\"value\">hi</span></p>"
  ],
  [
    "foo{#ident % this is a comment % .class}\n",
    "<p><span id=\"ident\" class=\"class\">foo</span></p>"
  ],
  [
    "foo{#ident % this is a comment}\n",
    "<p><span id=\"ident\">foo</span></p>"
  ]
])('preserves Djot word attributes: %s', (source, expected) => {
  expect(carveToHtml(djotToCarve(source))).toBe(expected)
})
