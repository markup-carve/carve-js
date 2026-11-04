import { describe, expect, it } from 'vitest'
import { carveToHtml, parse } from '../src/index.js'

const ruledHtml = new Map<string, string>([
  [
    "- ```\n  x\n+\n\ntail\n",
    "<ul>\n  <li>\n    <pre><code>x\n</code></pre>\n  </li>\n</ul>\n<p>tail</p>"
  ],
  [
    "- - ```\n\n  +\n~~~\ny\n",
    "<ul>\n  <li>\n    <ul>\n      <li>\n        <pre><code>\n</code></pre>\n      </li>\n    </ul>\n  </li>\n</ul>\n<pre><code>y\n</code></pre>"
  ],
  [
    "- ```\n+\n",
    "<ul>\n  <li>\n    <pre><code></code></pre>\n  </li>\n</ul>"
  ],
  [
    "- ```\n+\n  x\n",
    "<ul>\n  <li>\n    <pre><code></code></pre>\n  </li>\n</ul>\n<p>x</p>"
  ],
  [
    "- ```\n+\n\n  x\n",
    "<ul>\n  <li>\n    <pre><code></code></pre>\n  </li>\n</ul>\n<p>x</p>"
  ],
  [
    "- ```\n  a\n+\n  x\n",
    "<ul>\n  <li>\n    <pre><code>a\n</code></pre>\n  </li>\n</ul>\n<p>x</p>"
  ],
  [
    "- ```\n+\n\ntail\n",
    "<ul>\n  <li>\n    <pre><code></code></pre>\n  </li>\n</ul>\n<p>tail</p>"
  ],
  [
    "- - ```\n  +\n\ntail\n",
    "<ul>\n  <li>\n    <ul>\n      <li>\n        <pre><code></code></pre>\n      </li>\n    </ul>\n  </li>\n</ul>\n<p>tail</p>"
  ],
  [
    "- - - ```\n    +\n\ntail\n",
    "<ul>\n  <li>\n    <ul>\n      <li>\n        <ul>\n          <li>\n            <pre><code></code></pre>\n          </li>\n        </ul>\n      </li>\n    </ul>\n  </li>\n</ul>\n<p>tail</p>"
  ],
  [
    "- ```=html\n  x\n+\n\ntail\n",
    "<ul>\n  <li>\n    x\n  </li>\n</ul>\n<p>tail</p>"
  ],
  [
    "1. ```\n   x\n+\n\ntail\n",
    "<ol>\n  <li>\n    <pre><code>x\n</code></pre>\n  </li>\n</ol>\n<p>tail</p>"
  ],
  [
    ":: term\n: ```\n+\n\n  x\n",
    "<dl>\n  <dt>term</dt>\n  <dd>\n    <pre><code></code></pre>\n  </dd>\n</dl>\n<p>x</p>"
  ],
  [
    ":: term\n: ```=html\n+\n\n  x\n",
    "<dl>\n  <dt>term</dt>\n  <dd>\n    \n  </dd>\n</dl>\n<p>x</p>"
  ],
  [
    "- 1. ```\n  +\n\nend\n",
    "<ul>\n  <li>\n    <ol>\n      <li>\n        <pre><code></code></pre>\n      </li>\n    </ol>\n  </li>\n</ul>\n<p>end</p>"
  ],
  [
    "1. - ```\n   +\n\nend\n",
    "<ol>\n  <li>\n    <ul>\n      <li>\n        <pre><code></code></pre>\n      </li>\n    </ul>\n  </li>\n</ol>\n<p>end</p>"
  ],
  [
    "- [ ] ```\n+\n\nend\n",
    "<ul class=\"task-list\">\n  <li><input type=\"checkbox\" disabled> \n    <pre><code></code></pre>\n  </li>\n</ul>\n<p>end</p>"
  ],
  [
    "- 1. - ```\n     +\n\nend\n",
    "<ul>\n  <li>\n    <ol>\n      <li>\n        <ul>\n          <li>\n            <pre><code></code></pre>\n          </li>\n        </ul>\n      </li>\n    </ol>\n  </li>\n</ul>\n<p>end</p>"
  ],
  [
    "1. - * ```=html\n     +\n\nend\n",
    "<ol>\n  <li>\n    <ul>\n      <li>\n        <ul>\n          <li>\n            \n          </li>\n        </ul>\n      </li>\n    </ul>\n  </li>\n</ol>\n<p>end</p>"
  ],
  [
    "- ::: d\n  ```\n  :::\n  ```\n+\ntail\n",
    "<ul>\n  <li>\n    <div class=\"d\">\n      <pre><code>:::\n</code></pre>\n    </div>\n    tail\n  </li>\n</ul>"
  ],
  [
    "- ::: d\n  x\n+\ntail\n",
    "<ul>\n  <li>\n    <div class=\"d\">\n      <p>x</p>\n    </div>\n    tail\n  </li>\n</ul>"
  ],
  [
    "- ::: d\n  :::\n+\ntail\n",
    "<ul>\n  <li>\n    <div class=\"d\">\n\n    </div>\n    tail\n  </li>\n</ul>"
  ],
  [
    "- ::: d\n+\ntail\n",
    "<ul>\n  <li>\n    <div class=\"d\">\n\n    </div>\n    tail\n  </li>\n</ul>"
  ],
  [
    "1. ::: d\n+\ntail\n",
    "<ol>\n  <li>\n    <div class=\"d\">\n\n    </div>\n    tail\n  </li>\n</ol>"
  ],
  [
    "- - ::: d\n  +\ntail\n",
    "<ul>\n  <li>\n    <ul>\n      <li>\n        <div class=\"d\">\n\n        </div>\n      </li>\n    </ul>\n  </li>\n</ul>\n<p>tail</p>"
  ],
  [
    "- - - ::: d\n    +\ntail\n",
    "<ul>\n  <li>\n    <ul>\n      <li>\n        <ul>\n          <li>\n            <div class=\"d\">\n\n            </div>\n          </li>\n        </ul>\n      </li>\n    </ul>\n  </li>\n</ul>\n<p>tail</p>"
  ],
  [
    "+\ntail",
    "<p>+\ntail</p>"
  ]
])

describe('a refused continuation marker below an open verbatim fence', () => {
  it('accepts a marker followed by another flush-left marker', () => {
    const children = parse('- a\n\n  ```\n+\n+\n\ntail\n').children
    const item = children[0]
    expect(item?.type).toBe('list')
    if (item?.type !== 'list') return
    expect(item.items[0]?.children.at(-1)).toMatchObject({ type: 'code_block', content: '' })
    // The consumed markers leave no node (carve#5157).
    expect(children.map((child) => child.type)).toEqual(['list', 'paragraph'])
  })

  it('keeps the source line of a following paragraph', () => {
    const tail = parse('- ```\n  x\n+\n\ntail\n').children.at(-1)
    expect(tail?.type).toBe('paragraph')
    if (tail?.type !== 'paragraph' || tail.pos === undefined) throw new Error('expected a positioned paragraph')
    expect(tail?.pos.startLine).toBe(5)
  })

  it('keeps the indented plus as text at depth two', () => {
    expect(carveToHtml('- - ```\n\n  +\n~~~\ny\n')).toBe("<ul>\n  <li>\n    <ul>\n      <li>\n        <pre><code>\n</code></pre>\n      </li>\n    </ul>\n  </li>\n</ul>\n<pre><code>y\n</code></pre>")
  })

  const rows = [
    ['end of input', '- ```\n+\n', "<ul><li><pre><code></code></pre></li></ul>"],
    ['first payload', '- ```\n+\n  x\n', 'x\n'],
    ['first blank', '- ```\n+\n\n  x\n', '\nx\n'],
    ['after payload', '- ```\n  a\n+\n  x\n', 'a\nx\n'],
    ['blank then tail', '- ```\n+\n\ntail\n', '\n'],
    ['payload blank then tail', '- ```\n  x\n+\n\ntail\n', 'x\n\n'],
    ['nested blank then tail', '- - ```\n  +\n\ntail\n', '\n'],
    ['three levels', '- - - ```\n    +\n\ntail\n', '\n'],
    ['raw fence', '- ```=html\n  x\n+\n\ntail\n', 'x\n\n'],
    ['ordered item', '1. ```\n   x\n+\n\ntail\n', 'x\n\n'],
    ['description', ':: term\n: ```\n+\n\n  x\n', '\nx\n'],
    ['raw description', ':: term\n: ```=html\n+\n\n  x\n', '\nx\n'],
  ] as const

  for (const [name, source] of [
    ['bullet then ordered', '- 1. ```\n  +\n\nend\n'],
    ['ordered then bullet', '1. - ```\n   +\n\nend\n'],
    ['task marker', '- [ ] ```\n+\n\nend\n'],
    ['depth three', '- 1. - ```\n     +\n\nend\n'],
    ['raw at depth three', '1. - * ```=html\n     +\n\nend\n'],
  ] as const) {
    it(`retains the indented plus in ${name}`, () => {
      expect(carveToHtml(source)).toBe(ruledHtml.get(source))
    })
  }

  for (const [name, source] of rows) {
    it(name, () => {
      expect(carveToHtml(source)).toBe(ruledHtml.get(source))
    })
  }
})

describe('a continuation marker below a marker-line colon div', () => {
  it('keeps a div open when a code fence contains its closer text', () => {
    expect(carveToHtml('- ::: d\n  ```\n  :::\n  ```\n+\ntail\n')).toBe(
      '<ul>\n  <li>\n    <div class="d">\n      <pre><code>:::\n</code></pre>\n    </div>\n    tail\n  </li>\n</ul>',
    )
  })

  it('keeps existing div content before the attached text', () => {
    expect(carveToHtml('- ::: d\n  x\n+\ntail\n')).toMatch(
      /<div class="d">\s*<p>x<\/p>\s*<\/div>\s*tail/,
    )
  })

  it('leaves a div that already closed alone', () => {
    expect(carveToHtml('- ::: d\n  :::\n+\ntail\n')).toBe(
      '<ul>\n  <li>\n    <div class="d">\n\n    </div>\n    tail\n  </li>\n</ul>',
    )
  })

  it('matches a closed div at depths one and two', () => {
    expect(carveToHtml('- ::: d\n+\ntail\n')).toBe(
      '<ul>\n  <li>\n    <div class="d">\n\n    </div>\n    tail\n  </li>\n</ul>',
    )
    for (const [open, closed] of [
      ['- ::: d\n+\ntail\n', '- ::: d\n  :::\n+\ntail\n'],
    ]) {
      expect(carveToHtml(open)).toBe(carveToHtml(closed))
    }
  })

  for (const [name, source] of [
    ['bullet', '- ::: d\n+\ntail\n'],
    ['ordered item', '1. ::: d\n+\ntail\n'],
  ] as const) {
    it(name, () => {
      const html = carveToHtml(source)
      expect(html).toMatch(/<div class="d">\s*<\/div>\s*tail/)
    })
  }

  it.each(['- - ::: d\n  +\ntail\n', '- - - ::: d\n    +\ntail\n'])('consumes a nested refused marker in %s', source => {
    expect(carveToHtml(source)).toBe(ruledHtml.get(source))
  })
})
