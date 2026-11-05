import { describe, expect, it } from 'vitest'
import { carveToCarve, carveToHtml } from '../src/index.js'

// CARVE-P2-035 (markup-carve/carve#5203): lazy comment runs compare authored
// source columns after quote prefixes, whichever container owns the paragraph.
describe('lazy braced comments use source columns', () => {
  it.each([
    ["- pre\n{% b\nb %}\n", "<ul>\n  <li>pre\n{% b\nb %}</li>\n</ul>"],
    ["- pre\n{% b\n b %}\n", "<ul>\n  <li>pre\n</li>\n</ul>"],
    ["> pre\n{% b\nb %}\n", "<blockquote><p>pre\n{% b\nb %}</p></blockquote>"],
    ["> pre\n{% b\n b %}\n", "<blockquote><p>pre\n</p></blockquote>"],
    ["[^a]: pre\n{% b\nb %}\n\nref[^a]\n", "<p>ref<a id=\"fnref1\" href=\"#fn1\" role=\"doc-noteref\"><sup>1</sup></a></p>\n<section role=\"doc-endnotes\" aria-label=\"Footnotes\">\n  <hr>\n  <ol>\n    <li id=\"fn1\">\n      <p>pre\n{% b\nb %}<a href=\"#fnref1\" role=\"doc-backlink\" aria-label=\"Back to reference\">\u21a9</a></p>\n    </li>\n  </ol>\n</section>"],
    ["[^a]: pre\n{% b\n b %}\n\nref[^a]\n", "<p>ref<a id=\"fnref1\" href=\"#fn1\" role=\"doc-noteref\"><sup>1</sup></a></p>\n<section role=\"doc-endnotes\" aria-label=\"Footnotes\">\n  <hr>\n  <ol>\n    <li id=\"fn1\">\n      <p>pre\n<a href=\"#fnref1\" role=\"doc-backlink\" aria-label=\"Back to reference\">\u21a9</a></p>\n    </li>\n  </ol>\n</section>"],
    ["::: note\npre\n{% b\nb %}\n:::\n", "<aside class=\"admonition note\" aria-label=\"Note\">\n  <p>pre\n{% b\nb %}</p>\n</aside>"],
    ["::: note\npre\n{% b\n b %}\n:::\n", "<aside class=\"admonition note\" aria-label=\"Note\">\n  <p>pre\n</p>\n</aside>"],
  ])('renders corpus row %#', (source, html) => {
    expect(carveToHtml(source)).toBe(html)
    expect(carveToHtml(carveToCarve(source))).toBe(html)
  })
})
