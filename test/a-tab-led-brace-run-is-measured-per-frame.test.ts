import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

// carve-js#5008: a brace run's tab-led lines are measured per frame by the walk and every run reader (carve#5755, carve#5874).
const cases: Array<[string, string, string]> = [
  ["a tab-led refused lazy comment run in a note description stays text", "[^n]: p\n    :: t\n    : pre\n  \t{% x\n     %}\n\nx[^n]\n",
    "<p>x<a id=\"fnref1\" href=\"#fn1\" role=\"doc-noteref\"><sup>1</sup></a></p>\n<section role=\"doc-endnotes\" aria-label=\"Footnotes\">\n  <hr>\n  <ol>\n    <li id=\"fn1\">\n      <p>p</p>\n      <dl>\n        <dt>t</dt>\n        <dd>pre\n{% x\n%}</dd>\n      </dl>\n      <p><a href=\"#fnref1\" role=\"doc-backlink\" aria-label=\"Back to reference\">↩</a></p>\n    </li>\n  </ol>\n</section>"],
  ["a tab-led comment run in a note is refused per frame", "[^n]: p\n  \t{% x\n     %}\n\nx[^n]\n",
    "<p>x<a id=\"fnref1\" href=\"#fn1\" role=\"doc-noteref\"><sup>1</sup></a></p>\n<section role=\"doc-endnotes\" aria-label=\"Footnotes\">\n  <hr>\n  <ol>\n    <li id=\"fn1\">\n      <p>p\n{% x\n%}<a href=\"#fnref1\" role=\"doc-backlink\" aria-label=\"Back to reference\">↩</a></p>\n    </li>\n  </ol>\n</section>"],
  ["a tab-led comment run in a description reaches its closer per frame", ":: t\n: pre\n  \t{% x\n\t %}\n",
    "<dl>\n  <dt>t</dt>\n  <dd>pre\n{% x\n%}</dd>\n</dl>"],
  ["a tab-led attribute run in a description is measured per frame", ":: t\n: pre\n\t\t{.a\n       #b}\n",
    "<dl>\n  <dt>t</dt>\n  <dd>pre</dd>\n</dl>"],
  ["a tab-led attribute run in an item is measured per frame", "- a\n    \t{.a\n       #b}\n",
    "<ul>\n  <li>a</li>\n</ul>"],
  ["a tab-led comment run in a nested item reaches its closer per frame", "- a\n  - b\n  \t{% x\n\t y %}\n",
    "<ul>\n  <li>a\n    <ul>\n      <li>b\n{% x\ny %}</li>\n    </ul>\n  </li>\n</ul>"],

]

it.each(cases)('%s', (_name, source, html) => {
  expect(carveToHtml(source).trim()).toBe(html)
})
