import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

const normalized = (html: string): string => html.split('\n').map(line => line.trim()).filter(Boolean).join('\n')

const cases = [
  {
    source: 'lead\n[^n]: note\n%% comment\n> quote\n',
    html: '<p>lead</p>\n<blockquote><p>quote</p></blockquote>',
  },
  {
    source: 'lead\n[^n]: note\n%% comment\n# heading\n',
    html: '<p>lead</p>\n<section id="heading">\n<h1>heading</h1>\n</section>',
  },
  {
    source: 'lead\n[^n]: note\n%% comment\n:: term\n: detail\n',
    html: '<p>lead</p>\n<dl>\n<dt>term</dt>\n<dd>detail</dd>\n</dl>',
  },
  {
    source: 'lead\n[^n]: note\n%% comment\n```\ncode\n```\n',
    html: '<p>lead</p>\n<pre><code>code\n</code></pre>',
  },
  {
    source: ':: T\n: D\n    [^n]: e\n\n     - a\n',
    html: '<dl>\n<dt>T</dt>\n<dd>\n<p>D</p>\n<ul>\n<li>a</li>\n</ul>\n</dd>\n</dl>',
  },
  {
    source: '- 1. ordered\n    1. ordered\n      [^n]: note\n        1. ordered\n     q\n     1. ordered\n',
    html: "<ul>\n  <li>\n    <ol>\n      <li>ordered\n1. ordered\n        <ol>\n          <li>ordered</li>\n        </ol>\n      </li>\n    </ol>\n  </li>\n</ul>",
  },
]

it('a footnote leaves its authored body and returns to the surviving item', () => {
  for (const { source, html } of cases) expect(normalized(carveToHtml(source))).toBe(normalized(html))
})
