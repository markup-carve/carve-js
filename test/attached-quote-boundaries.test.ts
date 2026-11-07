import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

it('resumes an outer item after a quote with its own attached block', () => {
  expect(carveToHtml('- +\n> - +\n> ```\n> ```\n\n  # outer\n')).toBe(`<ul>
  <li>
    <blockquote>
      <ul>
        <li>
          <pre><code></code></pre>
        </li>
      </ul>
    </blockquote>
    <h1 id="outer">outer</h1>
  </li>
</ul>`)
})

it.each([
  ['- +\n> q\n  ^ cap\n', '<ul>\n  <li>\n    <figure>\n      <blockquote><p>q</p></blockquote>\n      <figcaption>cap</figcaption>\n    </figure>\n  </li>\n</ul>'],
  ['[^1]: +\n> q\n  ^ cap\n\n[^1]\n', '<figure>\n        <blockquote><p>q</p></blockquote>\n        <figcaption>cap</figcaption>\n      </figure>'],
  [':: t\n: +\n> q\n  ^ cap\n', '<figure>\n      <blockquote><p>q</p></blockquote>\n      <figcaption>cap</figcaption>\n    </figure>'],
])('attaches a host-column caption after an attached quote', (source, expected) => {
  expect(carveToHtml(source)).toContain(expected)
})

it.each([
  ['- +\n> q\n  ^ cap\n  more\n', '<figcaption>cap\n  more</figcaption>'],
  ['[^1]: +\n> q\n  ^ cap\n  more\n\n[^1]\n', '<figcaption>cap\n  more</figcaption>'],
  [':: t\n: +\n> q\n  ^ cap\n  more\n', '<figcaption>cap\n  more</figcaption>'],
])('keeps the authored indent in an attached quote caption', (source, expected) => {
  expect(carveToHtml(source)).toContain(expected)
})

it('does not extend a quote past a refused description plus', () => {
  expect(carveToHtml('> :: t\n> : +\n h\n')).toBe(`<blockquote>
  <dl>
    <dt>t</dt>
    <dd></dd>
  </dl>
</blockquote>
<p>h</p>`)
})
