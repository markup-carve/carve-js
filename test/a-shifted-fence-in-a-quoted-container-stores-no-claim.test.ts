import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

describe('a shifted fence in a quoted container stores no claim', () => {
  it("releases an unprefixed tail after the shifted fence", () => {
    expect(carveToHtml("> - ::: box\n>    ```\n>    code\ntail\n")).toBe(
      "<blockquote>\n  <ul>\n    <li>\n      <div class=\"box\">\n        <pre><code>code\n</code></pre>\n      </div>\n    </li>\n  </ul>\n</blockquote>\n<p>tail</p>",
    )
  })

  it("releases a marker tail after a nested quoted comment", () => {
    expect(carveToHtml("> > - ::: box\n> >   - inner\n> >     %% c\n> >    ```\n> >    code\n- tail\n")).toBe(
      "<blockquote>\n  <blockquote>\n    <ul>\n      <li>\n        <div class=\"box\">\n          <ul>\n            <li>inner</li>\n          </ul>\n          <pre><code>code\n</code></pre>\n        </div>\n      </li>\n    </ul>\n  </blockquote>\n</blockquote>\n<ul>\n  <li>tail</li>\n</ul>",
    )
  })

  it("releases the tail in an unquoted container", () => {
    expect(carveToHtml("- ::: box\n   ```\n   code\ntail\n")).toBe(
      "<ul>\n  <li>\n    <div class=\"box\">\n      <pre><code>code\n</code></pre>\n    </div>\n  </li>\n</ul>\n<p>tail</p>",
    )
  })

  it("resumes a paragraph after a closed fence", () => {
    expect(carveToHtml("> - ::: box\n>    ```\n>    code\n>    ```\n>   prose\ntail\n")).toBe(
      "<blockquote>\n  <ul>\n    <li>\n      <div class=\"box\">\n        <pre><code>code\n</code></pre>\n        <p>prose\ntail</p>\n      </div>\n    </li>\n  </ul>\n</blockquote>",
    )
  })
})
