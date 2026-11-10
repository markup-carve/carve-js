import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'
import { lintCarve } from '../src/lint.js'

const refused = [
  ['surviving outer quote, outside follower', '> > q\n> +\npara\n', 3, 2],
  ['surviving outer quote, end of input', '> > q\n> +\n', 3, 2],
  ['surviving outer quote, shifted follower', '> > q\n> +\n>   para\n', 3, 2],
  ['lazy quote inside list with no marker owner', '- x\n  > q\n  +\n', 3, 3],
] as const

const refusedInNote = [
  ['footnote, one-column follower', '[^a]: intro\n+\n more\n\nsee[^a]\n', [2, 1]],
  ['footnote, two-column follower', '[^a]: intro\n+\n  more\n\nsee[^a]\n', [2, 1]],
  ['footnote, tab-indented follower', '[^a]: intro\n+\n\tmore\n', [2, 1]],
  ['footnote, blank follower', 'x[^a]\n\n[^a]: note\n+\n\npara\n', [4, 1]],
  ['quoted note, blank follower', '> [^a]: n\n> +\n\npara\n', [2, 3]],
] as const

const ruledHtml = new Map<string, string>([
  [
    "> > q\n> +\npara\n",
    "<blockquote>\n  <blockquote><p>q</p></blockquote>\n</blockquote>\n<p>para</p>"
  ],
  [
    "> > q\n> +\n",
    "<blockquote>\n  <blockquote><p>q</p></blockquote>\n</blockquote>"
  ],
  [
    "> > q\n> +\n>   para\n",
    "<blockquote>\n  <blockquote><p>q</p></blockquote>\n  <p>para</p>\n</blockquote>"
  ],
  [
    "- x\n  > q\n  +\n",
    "<ul>\n  <li>x\n    <blockquote><p>q</p></blockquote>\n  </li>\n</ul>"
  ],
  [
    "> > q\n> > +\n> > - s\n",
    "<blockquote>\n  <blockquote><p>q\n+\n- s</p></blockquote>\n</blockquote>"
  ],
  [
    "> q\n> +\n> - s\n",
    "<blockquote><p>q\n+\n- s</p></blockquote>"
  ],
  [
    "[^a]: intro\n+\n more\n\nsee[^a]\n",
    "<p>more</p>\n<p>see<a id=\"fnref1\" href=\"#fn1\" role=\"doc-noteref\"><sup>1</sup></a></p>\n<section role=\"doc-endnotes\" aria-label=\"Footnotes\">\n  <hr>\n  <ol>\n    <li id=\"fn1\">\n      <p>intro<a href=\"#fnref1\" role=\"doc-backlink\" aria-label=\"Back to reference\">↩</a></p>\n    </li>\n  </ol>\n</section>"
  ],
  [
    "[^a]: intro\n+\n  more\n\nsee[^a]\n",
    "<p>see<a id=\"fnref1\" href=\"#fn1\" role=\"doc-noteref\"><sup>1</sup></a></p>\n<section role=\"doc-endnotes\" aria-label=\"Footnotes\">\n  <hr>\n  <ol>\n    <li id=\"fn1\">\n      <p>intro</p>\n      <p>more<a href=\"#fnref1\" role=\"doc-backlink\" aria-label=\"Back to reference\">↩</a></p>\n    </li>\n  </ol>\n</section>"
  ],
  [
    "[^a]: intro\n+\n\tmore\n",
    ""
  ],
  [
    "x[^a]\n\n[^a]: note\n+\n\npara\n",
    "<p>x<a id=\"fnref1\" href=\"#fn1\" role=\"doc-noteref\"><sup>1</sup></a></p>\n<p>para</p>\n<section role=\"doc-endnotes\" aria-label=\"Footnotes\">\n  <hr>\n  <ol>\n    <li id=\"fn1\">\n      <p>note<a href=\"#fnref1\" role=\"doc-backlink\" aria-label=\"Back to reference\">↩</a></p>\n    </li>\n  </ol>\n</section>"
  ],
  [
    "> [^a]: n\n> +\n\npara\n",
    "<blockquote>\n\n</blockquote>\n<p>para</p>"
  ]
])

const refusalLocations = (source: string) => lintCarve(source)
  .filter(warning => warning.rule === 'refused-continuation-marker')
  .map(warning => [warning.line, warning.column])

describe('a refused marker at a surviving footnote or quote owner', () => {
  it.each(refusedInNote)('reports %s in the note', (_name, source, location) => {
    expect(refusalLocations(source)).toEqual([location])
    if (source.includes('see[^a]') || source.includes('x[^a]')) expect(carveToHtml(source)).toBe(ruledHtml.get(source))
  })
  it.each(refused)('reports %s', (_name, source, column, line) => {
    expect(refusalLocations(source)).toEqual([[line, column]])
    expect(carveToHtml(source)).toBe(ruledHtml.get(source))
  })

  it.each([
    '> > q\n> > +\n> > - s\n',
    '> q\n> +\n> - s\n',
  ])('keeps a visible plus quiet in %j', (source) => {
    expect(refusalLocations(source)).toEqual([])
    expect(carveToHtml(source)).toBe(ruledHtml.get(source))
  })

  it.each([
    '[^a]: intro\n+\nmore\n\nsee[^a]\n',
    '> > q\n> +\n> para\n',
    '- a\n  z\n\nx\n',
    '> > q\n>   +\n',
    '> > q\n> z\npara\n',
    // PART 0 S2: a `+` at an item's content column is a letter (carve#4648).
    '- foo\n  - [ ] task\n    +\n  - x\n',
    '- foo\n  - [ ] task\n    +\n    q\n',
    '- a\n  +\n\nx\n',
  ])('leaves an accepted marker or ordinary text silent: %j', source => {
    expect(refusalLocations(source)).toEqual([])
  })
})
