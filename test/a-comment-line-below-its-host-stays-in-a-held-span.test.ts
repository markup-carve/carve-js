import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'

// A %% line is column-exempt under PART 0 S1, so it does not end a %%% span its host holds (carve-js#4276). Outputs are the spec model's.
describe("a comment line below its host stays in a held span", () => {
  it.each([
    [
      "an item hosting a box",
      "- ::: box\n  %%%%\n%% j\n  x\n",
      "<ul>\n  <li>\n    <div class=\"box\">\n\n    </div>\n  </li>\n</ul>",
    ],
    [
      "an item paragraph",
      "- a\n  %%%%\n%% j\n  x\n",
      "<ul>\n  <li>a</li>\n</ul>",
    ],
    [
      "a nested item",
      "- - a\n    %%%%\n  %% j\n    x\n",
      "<ul>\n  <li>\n    <ul>\n      <li>a</li>\n    </ul>\n  </li>\n</ul>",
    ],
    [
      "a quoted item",
      "> - a\n>   %%%%\n> %% j\n>   x\n",
      "<blockquote>\n  <ul>\n    <li>a</li>\n  </ul>\n</blockquote>",
    ],
    [
      "a closer after the comment line",
      "- a\n  %%%%\n%% j\n  x\n  %%%%\n- b\n",
      "<ul>\n  <li>a</li>\n  <li>b</li>\n</ul>",
    ],
    [
      "a description body",
      ":: t\n: head\n\n  %%%\n%% below\n\n  tail\n",
      "<dl>\n  <dt>t</dt>\n  <dd>head</dd>\n</dl>",
    ],
    [
      "a footnote body",
      "[^n]: head\n\n  %%%\n%% below\n\n  tail\n",
      "",
    ],
    [
      "a line block in an item",
      "- ::: |\n  %%%%\n %% c\n",
      "<ul>\n  <li>\n    <div class=\"line-block\">\n\n    </div>\n  </li>\n</ul>",
    ],
    [
      "CONTROL: a text line below the host ends the span",
      "- a\n  %%%%\nx\n  y\n",
      "<ul>\n  <li>a</li>\n</ul>\n<p>x\ny</p>",
    ],
  ])('%s', (_name, source, html) => {
    expect(carveToHtml(source).trim()).toBe(html)
  })
})
