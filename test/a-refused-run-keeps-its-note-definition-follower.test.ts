import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

it.each([
  ['description', ':: t\n: {.x\n}\n[^m]: n\nz\n', '<dl>\n  <dt>t</dt>\n  <dd>{.x\n}\n[^m]: n\nz</dd>\n</dl>'],
  ['item', '- {.x\n}\n[^m]: n\nz\n', '<ul>\n  <li>{.x\n}\n[^m]: n\nz</li>\n</ul>'],
  ['description in an item', '- :: t\n  : {.x\n}\n[^m]: n\nz\n', '<ul>\n  <li>\n    <dl>\n      <dt>t</dt>\n      <dd>{.x\n}\n[^m]: n\nz</dd>\n    </dl>\n  </li>\n</ul>'],
  ['item in a quote', '> - {.x\n> }\n> [^m]: n\n> z\n', '<blockquote>\n  <ul>\n    <li>{.x\n}\n[^m]: n\nz</li>\n  </ul>\n</blockquote>'],
  ['description in a quote', '> :: t\n> : {.x\n> }\n> [^m]: n\n> z\n', '<blockquote>\n  <dl>\n    <dt>t</dt>\n    <dd>{.x\n}\n[^m]: n\nz</dd>\n  </dl>\n</blockquote>'],
])('keeps the note-definition follower of a refused brace run in %s (carve#5784)', (_name, source, expected) => {
  expect(carveToHtml(source)).toBe(expected)
})

it('still collects a note definition after a valid attribute run', () => {
  expect(carveToHtml('- {.x\n   .y}\n[^m]: n\nz\n')).toBe('<ul>\n  <li></li>\n</ul>')
})

it('keeps an inline note reference when the follower is not a definition', () => {
  expect(carveToHtml('- {.x\n}\n[^m]:foo\n\n[^m]: real\n')).toBe(
    '<ul>\n  <li>{.x\n}\n<a id="fnref1" href="#fn1" role="doc-noteref"><sup>1</sup></a>:foo</li>\n</ul>\n<section role="doc-endnotes" aria-label="Footnotes">\n  <hr>\n  <ol>\n    <li id="fn1">\n      <p>real<a href="#fnref1" role="doc-backlink" aria-label="Back to reference">↩</a></p>\n    </li>\n  </ol>\n</section>',
  )
})
