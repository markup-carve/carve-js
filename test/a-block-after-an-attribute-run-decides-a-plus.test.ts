import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'

// CARVE-P9-067 as ruled on carve#4278 and carve#4447: an attribute run after a
// lone `+` leads the attached block, so the block after the run decides whether
// the `+` attaches. A refused `+` is a letter (carve#4396), and the run labels
// the block that follows outside the item.
describe('the block after an attribute run decides a plus', () => {
  it.each([
    [
      'a sublist after the run',
      '- a\n+\n{x}\n  - c\n',
      "<ul>\n  <li>a\n+</li>\n</ul>\n<ul x=\"\">\n  <li>c</li>\n</ul>",
    ],
    [
      'a sibling after the run',
      '- a\n+\n{x}\n- c\n',
      "<ul>\n  <li>a\n+</li>\n</ul>\n<ul x=\"\">\n  <li>c</li>\n</ul>",
    ],
    [
      'a first-block plus and a sibling',
      '- +\n{x}\n- c\n',
      "<ul>\n  <li>+</li>\n</ul>\n<ul x=\"\">\n  <li>c</li>\n</ul>",
    ],
    [
      'a first-block plus and an ordered sibling',
      '- +\n{x}\n1. c\n',
      "<ul>\n  <li>+</li>\n</ul>\n<ol x=\"\">\n  <li>c</li>\n</ol>",
    ],
    [
      'two attribute lines',
      '- a\n+\n{x}\n{y}\n- c\n',
      "<ul>\n  <li>a\n+</li>\n</ul>\n<ul x=\"\" y=\"\">\n  <li>c</li>\n</ul>",
    ],
    [
      'a wrapped attribute block',
      '- a\n+\n{x\ny}\n  - c\n',
      "<ul>\n  <li>a\n+</li>\n</ul>\n<ul x=\"\" y=\"\">\n  <li>c</li>\n</ul>",
    ],
    [
      'a quoted list',
      '> - a\n> +\n> {x}\n>   - c\n',
      "<blockquote>\n  <ul>\n    <li>a\n+</li>\n  </ul>\n  <ul x=\"\">\n    <li>c</li>\n  </ul>\n</blockquote>",
    ],
    [
      'the description twin',
      ':: t\n: a\n+\n{x}\n: b\n',
      "<dl>\n  <dt>t</dt>\n  <dd>a\n+</dd>\n</dl>\n<p x=\"\">: b</p>",
    ],
    [
      'a first-block description plus',
      ':: t\n: +\n{x}\n: b\n',
      "<dl>\n  <dt>t</dt>\n  <dd>+</dd>\n</dl>\n<p x=\"\">: b</p>",
    ],
    [
      'a paragraph past the marker column',
      '- a\n+\n{x}\n  para\n',
      "<ul>\n  <li>a\n+</li>\n</ul>\n<p x=\"\">para</p>",
    ],
    [
      'a quote past the marker column',
      '- a\n+\n{.x}\n > q\n',
      "<ul>\n  <li>a\n+</li>\n</ul>\n<blockquote class=\"x\"><p>q</p></blockquote>",
    ],
    [
      'a paragraph at the marker column still attaches',
      '- a\n+\n{.x}\npara\n',
      "<ul>\n  <li>a\n    <p class=\"x\">para</p>\n  </li>\n</ul>",
    ],
    [
      'a quote at the marker column still attaches',
      '- a\n+\n{.x}\n> q\n- c\n',
      "<ul>\n  <li>a\n    <blockquote class=\"x\"><p>q</p></blockquote>\n  </li>\n  <li>c</li>\n</ul>",
    ],
    [
      'a list in a description still attaches',
      ':: t\n: a\n+\n{x}\n- c\n',
      "<dl>\n  <dt>t</dt>\n  <dd>\n    <p>a</p>\n    <ul x=\"\">\n      <li>c</li>\n    </ul>\n  </dd>\n</dl>",
    ],
  ])('%s', (_name, source, html) => {
    expect(carveToHtml(source)).toBe(html)
  })
})
