import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'

// A nested quote's first-block `+` opens no paragraph, so a line that misses both quotes finds none to fold into (carve#5023). Outputs are the spec model's.
describe("a nested quote's first-block plus opens no paragraph", () => {
  it.each([
    [
      "a heading item attached by a depth-2 plus",
      "> > +\n> - # h\nq\n",
      "<blockquote>\n  <blockquote>\n    <ul>\n      <li>\n        <h1 id=\"h\">h</h1>\n      </li>\n    </ul>\n  </blockquote>\n</blockquote>\n<p>q</p>",
    ],
    [
      "a thematic break item",
      "> > +\n> - ---\nq\n",
      "<blockquote>\n  <blockquote>\n    <ul>\n      <li>\n        <hr>\n      </li>\n    </ul>\n  </blockquote>\n</blockquote>\n<p>q</p>",
    ],
    [
      "an empty div item, then a caption-shaped line",
      "> > +\n> - ::: box\nq\n^ cap\n",
      "<blockquote>\n  <blockquote>\n    <ul>\n      <li>\n        <div class=\"box\">\n\n        </div>\n      </li>\n    </ul>\n  </blockquote>\n</blockquote>\n<p>q\n^ cap</p>",
    ],
    [
      "the follower written at the plus depth",
      "> > +\n> > - # h\nq\n",
      "<blockquote>\n  <blockquote>\n    <blockquote>\n      <ul>\n        <li>\n          <h1 id=\"h\">h</h1>\n        </li>\n      </ul>\n    </blockquote>\n  </blockquote>\n</blockquote>\n<p>q</p>",
    ],
    [
      "after a paragraph in the outer quote",
      "> a\n> > +\n> - # h\nq\n",
      "<blockquote>\n  <p>a</p>\n  <blockquote>\n    <ul>\n      <li>\n        <h1 id=\"h\">h</h1>\n      </li>\n    </ul>\n  </blockquote>\n</blockquote>\n<p>q</p>",
    ],
    [
      "a paragraph item still takes the lazy line",
      "> > +\n> - para\nq\n",
      "<blockquote>\n  <blockquote>\n    <ul>\n      <li>para\nq</li>\n    </ul>\n  </blockquote>\n</blockquote>",
    ],
    [
      "a plus with no follower stays text",
      "> > +\nq\n",
      "<blockquote>\n  <blockquote>\n\n  </blockquote>\n</blockquote>\n<p>q</p>",
    ],
  ])('%s', (_name, source, html) => {
    expect(carveToHtml(source).trim()).toBe(html)
  })
})
