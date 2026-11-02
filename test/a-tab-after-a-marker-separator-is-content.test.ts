import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'

// CARVE-P2-010 (carve#4610, carve#4404): a tab after a list or description marker's
// separator is content. It stays in the text, it does not move the content column,
// and what follows it is paragraph text whatever it spells.
describe('a tab after a marker separator is content', () => {
  it.each([
    [
      'the ruling\'s shape: a heading below stays in the item',
      "- \tx\n  # H\n",
      "<ul>\n  <li>\tx\n    <h1 id=\"H\">H</h1>\n  </li>\n</ul>",
    ],
    [
      'a lead tab and a lazy line',
      "- - \t+\n  x\n",
      "<ul>\n  <li>\n    <ul>\n      <li>\t+\nx</li>\n    </ul>\n  </li>\n</ul>",
    ],
    [
      'a plus behind the tab is a letter',
      "- \t+\nx\n",
      "<ul>\n  <li>\t+\nx</li>\n</ul>",
    ],
    [
      'an ordered item keeps its column',
      "1. \tx\n\n   y\n",
      "<ol>\n  <li><p>\tx</p>\n    <p>y</p>\n  </li>\n</ol>",
    ],
    [
      'a line at the column after the separator continues the item',
      "- \tx\n\n  y\n",
      "<ul>\n  <li><p>\tx</p>\n    <p>y</p>\n  </li>\n</ul>",
    ],
    [
      'a heading shape behind the tab is text and a marker below it opens a list',
      "1. \t# H\n  - z\n",
      "<ol>\n  <li>\t# H</li>\n</ol>\n<ul>\n  <li>z</li>\n</ul>",
    ],
    [
      'an item attribute block',
      "-{.c} \tx\n  y\n",
      "<ul>\n  <li class=\"c\">\tx\ny</li>\n</ul>",
    ],
    [
      'a definition term keeps its tab',
      ":: \tx\n: d\n",
      "<dl>\n  <dt>\tx</dt>\n  <dd>d</dd>\n</dl>",
    ],
    [
      'a whitespace run after the tab stays too',
      "- \t e\n",
      "<ul>\n  <li>\t e</li>\n</ul>",
    ],
    [
      'a quoted stacked item',
      "> - \t- +\nx\n",
      "<blockquote>\n  <ul>\n    <li>\t- +\nx</li>\n  </ul>\n</blockquote>",
    ],
    [
      'a description body keeps its tab and stays text',
      ":: t\n: \t# H\n",
      "<dl>\n  <dt>t</dt>\n  <dd>\t# H</dd>\n</dl>",
    ],
    [
      'a description body behind a tab takes the next paragraph',
      ":: t\n: \tx\n\n  y\n",
      "<dl>\n  <dt>t</dt>\n  <dd>\n    <p>\tx</p>\n    <p>y</p>\n  </dd>\n</dl>",
    ],
  ])('%s', (_name, source, html) => {
    expect(carveToHtml(source).trim()).toBe(html)
  })
})
