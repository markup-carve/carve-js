import { describe, expect, it } from 'vitest'
import { carveToAstJson, carveToHtml } from '../src/index.js'

const cases = [
  [
    "553-a-below-column-line-continues-a-paragraph-only-where-one-is-open-24",
    ":: t\n: - # h\nx\n",
    "<dl>\n  <dt>t</dt>\n  <dd>\n    <ul>\n      <li>\n        <h1 id=\"h\">h</h1>\n      </li>\n    </ul>\n  </dd>\n</dl>\n<p>x</p>"
  ],
  [
    "553-a-below-column-line-continues-a-paragraph-only-where-one-is-open-25",
    ":: t\n: - a\n    # H\ntail\n",
    "<dl>\n  <dt>t</dt>\n  <dd>\n    <ul>\n      <li>a\n        <h1 id=\"H\">H</h1>\n      </li>\n    </ul>\n  </dd>\n</dl>\n<p>tail</p>"
  ],
  [
    "553-a-below-column-line-continues-a-paragraph-only-where-one-is-open-26",
    ":: t\n: - a\n     # H\ntail\n",
    "<dl>\n  <dt>t</dt>\n  <dd>\n    <ul>\n      <li>a\n        <h1 id=\"H\">H</h1>\n      </li>\n    </ul>\n  </dd>\n</dl>\n<p>tail</p>"
  ],
  [
    "553-a-below-column-line-continues-a-paragraph-only-where-one-is-open-27",
    ":: t\n: - a\n      # H\ntail\n",
    "<dl>\n  <dt>t</dt>\n  <dd>\n    <ul>\n      <li>a\n        <h1 id=\"H\">H</h1>\n      </li>\n    </ul>\n  </dd>\n</dl>\n<p>tail</p>"
  ],
  [
    "553-a-below-column-line-continues-a-paragraph-only-where-one-is-open-28",
    ":: t\n: - | a |\n    | - |\nx\n",
    "<dl>\n  <dt>t</dt>\n  <dd>\n    <ul>\n      <li>\n        <table>\n          <thead>\n            <tr><th scope=\"col\">a</th></tr>\n          </thead>\n        </table>\n      </li>\n    </ul>\n  </dd>\n</dl>\n<p>x</p>"
  ],
  [
    "recorded deepest-frame control 2",
    ":: t\n: - ---\nx\n",
    "<dl>\n  <dt>t</dt>\n  <dd>\n    <ul>\n      <li>\n        <hr>\n      </li>\n    </ul>\n  </dd>\n</dl>\n<p>x</p>"
  ],
  [
    "recorded deepest-frame control 3",
    ":: t\n: - {.k}\nx\n",
    "<dl>\n  <dt>t</dt>\n  <dd>\n    <ul>\n      <li></li>\n    </ul>\n  </dd>\n</dl>\n<p>x</p>"
  ],
  [
    "recorded deepest-frame control 4",
    ":: t\n: - %% c\nx\n",
    "<dl>\n  <dt>t</dt>\n  <dd>\n    <ul>\n      <li></li>\n    </ul>\n  </dd>\n</dl>\n<p>x</p>"
  ],
  [
    "recorded deepest-frame control 5",
    ":: t\n: - | a |\n    | - |\n    | b |\nx\n",
    "<dl>\n  <dt>t</dt>\n  <dd>\n    <ul>\n      <li>\n        <table>\n          <thead>\n            <tr><th scope=\"col\">a</th></tr>\n          </thead>\n          <tbody>\n            <tr><td>b</td></tr>\n          </tbody>\n        </table>\n      </li>\n    </ul>\n  </dd>\n</dl>\n<p>x</p>"
  ],
  [
    "recorded deepest-frame control 6",
    ":: t\n: 1. # h\nx\n",
    "<dl>\n  <dt>t</dt>\n  <dd>\n    <ol>\n      <li>\n        <h1 id=\"h\">h</h1>\n      </li>\n    </ol>\n  </dd>\n</dl>\n<p>x</p>"
  ],
  [
    "recorded deepest-frame control 7",
    ":: t\n: - - # h\nx\n",
    "<dl>\n  <dt>t</dt>\n  <dd>\n    <ul>\n      <li>\n        <ul>\n          <li>\n            <h1 id=\"h\">h</h1>\n          </li>\n        </ul>\n      </li>\n    </ul>\n  </dd>\n</dl>\n<p>x</p>"
  ],
  [
    "recorded deepest-frame control 8",
    ":: t\n: - > # h\nx\n",
    "<dl>\n  <dt>t</dt>\n  <dd>\n    <ul>\n      <li>\n        <blockquote>\n          <h1 id=\"h\">h</h1>\n        </blockquote>\n      </li>\n    </ul>\n  </dd>\n</dl>\n<p>x</p>"
  ],
  [
    "recorded deepest-frame control 9",
    ":: t\n: > - # h\nx\n",
    "<dl>\n  <dt>t</dt>\n  <dd>\n    <blockquote>\n      <ul>\n        <li>\n          <h1 id=\"h\">h</h1>\n        </li>\n      </ul>\n    </blockquote>\n  </dd>\n</dl>\n<p>x</p>"
  ],
  [
    "recorded deepest-frame control 10",
    ":: t\n: - %%%\nx\n",
    "<dl>\n  <dt>t</dt>\n  <dd>\n    <ul>\n      <li></li>\n    </ul>\n  </dd>\n</dl>\n<p>x</p>"
  ],
  [
    "recorded deepest-frame control 11",
    ":: t\n: - ```\n    c\n    ```\nx\n",
    "<dl>\n  <dt>t</dt>\n  <dd>\n    <ul>\n      <li>\n        <pre><code>c\n</code></pre>\n      </li>\n    </ul>\n  </dd>\n</dl>\n<p>x</p>"
  ]
] as const

describe('a definition ends after its nested leaf block', () => {
  for (const [name, source, expected] of cases) {
    it(name, () => {
      expect(carveToHtml(source).trim()).toBe(expected)
      expect(carveToAstJson(source).children.map(node => node.type)).toEqual(['definition_list', 'paragraph'])
    })
  }

  it('keeps a lazy line in an open nested paragraph', () => {
    const source = ':: t\n: - a\nx\n'
    expect(carveToAstJson(source).children.map(node => node.type)).toEqual(['definition_list'])
    expect(carveToHtml(source)).toContain('<li>a\nx</li>')
  })

  it('keeps an unfinished nested fence control', () => {
    const source = ':: t\n: - - ```\n      x\n'
    expect(carveToAstJson(source).children.map(node => node.type)).toEqual(['definition_list'])
    expect(carveToHtml(source)).toContain('x\n</code>')
  })
  for (const { name, source, expected } of [
  {
    "name": "post_closer_paragraph",
    "source": ":: t\n: - ```\n    c\n    ```\n    p\nx\n",
    "expected": "<dl>\n  <dt>t</dt>\n  <dd>\n    <ul>\n      <li>\n        <pre><code>c\n</code></pre>\n        p\nx\n      </li>\n    </ul>\n  </dd>\n</dl>"
  },
  {
    "name": "post_closer_heading",
    "source": ":: t\n: - ```\n    c\n    ```\n    # H\nx\n",
    "expected": "<dl>\n  <dt>t</dt>\n  <dd>\n    <ul>\n      <li>\n        <pre><code>c\n</code></pre>\n        <h1 id=\"H\">H</h1>\n      </li>\n    </ul>\n  </dd>\n</dl>\n<p>x</p>"
  },
  {
    "name": "post_closer_unfinished_fence",
    "source": ":: t\n: - ```\n    c\n    ```\n    ~~~\nx\n",
    "expected": "<dl>\n  <dt>t</dt>\n  <dd>\n    <ul>\n      <li>\n        <pre><code>c\n</code></pre>\n        <pre><code></code></pre>\n      </li>\n    </ul>\n  </dd>\n</dl>\n<p>x</p>"
  }
]) {
    it(name, () => {
      expect(carveToHtml(source).trim()).toBe(expected)
    })
  }

})
