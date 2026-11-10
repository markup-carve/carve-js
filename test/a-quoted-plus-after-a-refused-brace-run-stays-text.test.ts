import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

// R03: a lone `+` after a refused brace run stays paragraph text, read after its quote prefixes (carve#5790).
it.each([
  ["an item", "> - {.x\n> }\n> +\n> z\n", "<blockquote>\n  <ul>\n    <li>{.x\n}\n      z\n    </li>\n  </ul>\n</blockquote>"],
  ["a description", "> :: t\n> : {.x\n> }\n> +\n> z\n", "<blockquote>\n  <dl>\n    <dt>t</dt>\n    <dd>\n      <p>{.x\n}</p>\n      <p>z</p>\n    </dd>\n  </dl>\n</blockquote>"],
  ["a note", "> [^1]: {.x\n> }\n> +\n> z\n\nx[^1]\n", "<blockquote>\n\n</blockquote>\n<p>x<a id=\"fnref1\" href=\"#fn1\" role=\"doc-noteref\"><sup>1</sup></a></p>\n<section role=\"doc-endnotes\" aria-label=\"Footnotes\">\n  <hr>\n  <ol>\n    <li id=\"fn1\">\n      <p>{.x\n}</p>\n      <p>z<a href=\"#fnref1\" role=\"doc-backlink\" aria-label=\"Back to reference\">↩</a></p>\n    </li>\n  </ol>\n</section>"],
  ["an item with a lazy tail after a comment run", "> - {% a\n>  %}\n> +\nz\n", "<blockquote>\n  <ul>\n    <li>{% a\n%}</li>\n  </ul>\n</blockquote>\n<p>z</p>"],
  ["an item with a lazy closer at column 0", "> - {.x\n}\n> +\nz\n", "<blockquote>\n  <ul>\n    <li>{.x\n}</li>\n  </ul>\n</blockquote>\n<p>z</p>"],
  ["an unquoted note", "[^1]: {.x\n}\n+\nz\n\nx[^1]\n", "<p>x<a id=\"fnref1\" href=\"#fn1\" role=\"doc-noteref\"><sup>1</sup></a></p>\n<section role=\"doc-endnotes\" aria-label=\"Footnotes\">\n  <hr>\n  <ol>\n    <li id=\"fn1\">\n      <p>{.x\n}</p>\n      <p>z<a href=\"#fnref1\" role=\"doc-backlink\" aria-label=\"Back to reference\">↩</a></p>\n    </li>\n  </ol>\n</section>"],
  ["a nested quote", "> > - {.x\n> > }\n> > +\n> > z\n", "<blockquote>\n  <blockquote>\n    <ul>\n      <li>{.x\n}\n        z\n      </li>\n    </ul>\n  </blockquote>\n</blockquote>"],
])('keeps the R03 `+` after a refused brace run in %s as text', (_name, source, expected) => {
  expect(carveToHtml(source)).toBe(expected)
})

it('measures a lazy closer at its written column against the quoted opener', () => {
  const [, source, expected] = ["a lazy closer past the quoted opener column", "> > - {.x\n   }\n> > +\n> > z\n", "<blockquote>\n  <blockquote>\n    <ul>\n      <li>{.x\n}\n        z\n      </li>\n    </ul>\n  </blockquote>\n</blockquote>"]
  expect(carveToHtml(source)).toBe(expected)
})
