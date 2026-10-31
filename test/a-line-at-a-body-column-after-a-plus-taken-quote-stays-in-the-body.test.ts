import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'

// CARVE-P9-067 (carve#4385): a quote a marker-line `+` takes as its block closes
// at an unprefixed line, and the div left open inside it measured no column that
// line could reach, so a line at the body's column stays in the item or description.
describe('a line at a body column after a plus-taken quote stays in the body', () => {
  it.each([
    [
      'the ticket shape',
      '- +\n> :::\n  x\n',
      "<ul>\n  <li>\n    <blockquote>\n      <div>\n\n      </div>\n    </blockquote>\n    x\n  </li>\n</ul>",
    ],
    [
      'an admonition in the quote',
      '- +\n> ::: note\n  x\n',
      "<ul>\n  <li>\n    <blockquote>\n      <aside class=\"admonition note\" aria-label=\"Note\">\n\n      </aside>\n    </blockquote>\n    x\n  </li>\n</ul>",
    ],
    [
      'an ordered item',
      '1. +\n> :::\n   x\n',
      "<ol>\n  <li>\n    <blockquote>\n      <div>\n\n      </div>\n    </blockquote>\n    x\n  </li>\n</ol>",
    ],
    [
      'the description spelling',
      ':: t\n: +\n> :::\n  x\n',
      "<dl>\n  <dt>t</dt>\n  <dd>\n    <blockquote>\n      <div>\n\n      </div>\n    </blockquote>\n    <p>x</p>\n  </dd>\n</dl>",
    ],
    [
      'a nested item',
      '- p\n  - +\n  > :::\n    x\n',
      "<ul>\n  <li>p\n    <ul>\n      <li>\n        <blockquote>\n          <div>\n\n          </div>\n        </blockquote>\n        x\n      </li>\n    </ul>\n  </li>\n</ul>",
    ],
    [
      'a nested quote holding the div',
      '- +\n> > :::\n  x\n',
      "<ul>\n  <li>\n    <blockquote>\n      <blockquote>\n        <div>\n\n        </div>\n      </blockquote>\n    </blockquote>\n    x\n  </li>\n</ul>",
    ],
    [
      'a line past the content column',
      '- +\n> :::\n   x\n',
      "<ul>\n  <li>\n    <blockquote>\n      <div>\n\n      </div>\n    </blockquote>\n    x\n  </li>\n</ul>",
    ],
    [
      'a line below the content column still leaves',
      '- +\n> :::\nx\n',
      "<ul>\n  <li>\n    <blockquote>\n      <div>\n\n      </div>\n    </blockquote>\n  </li>\n</ul>\n<p>x</p>",
    ],
    [
      'a lone plus keeps its reading',
      '- a\n+\n> :::\n  x\n',
      "<ul>\n  <li>a\n    <blockquote>\n      <div>\n\n      </div>\n    </blockquote>\n  </li>\n</ul>\n<p>x</p>",
    ],
    [
      'a footnote plus keeps its reading',
      '[^n]: +\n> :::\n  x\n\nr[^n]\n',
      "<p>x</p>\n<p>r<a id=\"fnref1\" href=\"#fn1\" role=\"doc-noteref\"><sup>1</sup></a></p>\n<section role=\"doc-endnotes\" aria-label=\"Footnotes\">\n  <hr>\n  <ol>\n    <li id=\"fn1\">\n      <blockquote>\n        <div>\n\n        </div>\n      </blockquote>\n      <p><a href=\"#fnref1\" role=\"doc-backlink\" aria-label=\"Back to reference\">↩</a></p>\n    </li>\n  </ol>\n</section>",
    ],
  ])('%s', (_name, source, html) => {
    expect(carveToHtml(source)).toBe(html)
  })
})
