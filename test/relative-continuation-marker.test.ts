import { describe, expect, it } from 'vitest'
import { carveToHtml, parse, renderCarve } from '../src/index.js'
import { lintCarve } from '../src/lint.js'

const cases = [
  {
    "input": "- a\n  - b\n  +\n  > q",
    "expected": "<ul>\n  <li>a\n    <ul>\n      <li>b\n        <blockquote><p>q</p></blockquote>\n      </li>\n    </ul>\n  </li>\n</ul>"
  },
  {
    "input": "- a\n  - b\n+\n> q",
    "expected": "<ul>\n  <li>a\n    <ul>\n      <li>b</li>\n    </ul>\n    <blockquote><p>q</p></blockquote>\n  </li>\n</ul>"
  },
  {
    "input": "- a\n+\n- b",
    "expected": "<ul>\n  <li>a\n+</li>\n  <li>b</li>\n</ul>"
  },
  {
    "input": "- a\n\n+\n- b",
    "expected": "<ul>\n  <li>a</li>\n</ul>\n<p>+\n- b</p>"
  },
  {
    "input": "- ```\n+\n- b",
    "expected": "<ul>\n  <li>\n    <pre><code></code></pre>\n  </li>\n</ul>\n<p>+\n- b</p>"
  },
  {
    "input": "- a\n  - b\n  +\n  1. sibling",
    "expected": "<ul>\n  <li>a\n    <ul>\n      <li>b\n+</li>\n    </ul>\n    <ol>\n      <li>sibling</li>\n    </ol>\n  </li>\n</ul>"
  },
  {
    "input": "- a\n  - b\n  +\n    - child",
    "expected": "<ul>\n  <li>a\n    <ul>\n      <li>b\n+\n        <ul>\n          <li>child</li>\n        </ul>\n      </li>\n    </ul>\n  </li>\n</ul>"
  },
  {
    "input": "- a\n  - b\n  +\ntail",
    "expected": "<ul>\n  <li>a\n    <ul>\n      <li>b\n+\ntail</li>\n    </ul>\n  </li>\n</ul>"
  },
  {
    "input": "- a\n  - b\n  +",
    "expected": "<ul>\n  <li>a\n    <ul>\n      <li>b\n+</li>\n    </ul>\n  </li>\n</ul>"
  },
  {
    "input": "- a\n  - [ ] task\n  +\n  ```\n  code\n  ```",
    "expected": "<ul>\n  <li>a\n    <ul class=\"task-list\">\n      <li><input type=\"checkbox\" disabled aria-label=\"task\"> task\n        <pre><code>code\n</code></pre>\n      </li>\n    </ul>\n  </li>\n</ul>"
  },
  {
    "input": "- a\n  - [ ] task\n    +\n    text",
    "expected": "<ul>\n  <li>a\n    <ul class=\"task-list\">\n      <li><input type=\"checkbox\" disabled aria-label=\"task + text\"> task\n+\ntext</li>\n    </ul>\n  </li>\n</ul>"
  },
  {
    "input": "- a\n  - ```\n  +\n  > q",
    "expected": "<ul>\n  <li>a\n    <ul>\n      <li>\n        <pre><code></code></pre>\n        <blockquote><p>q</p></blockquote>\n      </li>\n    </ul>\n  </li>\n</ul>"
  },
  {
    "input": "- a\n  - ```\n    +\n    payload",
    "expected": "<ul>\n  <li>a\n    <ul>\n      <li>\n        <pre><code>+\npayload</code></pre>\n      </li>\n    </ul>\n  </li>\n</ul>"
  },
  {
    "input": "- a\n  - +\n  > b",
    "expected": "<ul>\n  <li>a\n    <ul>\n      <li>\n        <blockquote><p>b</p></blockquote>\n      </li>\n    </ul>\n  </li>\n</ul>"
  },
  {
    "input": "- a\n  - +\n> b",
    "expected": "<ul>\n  <li>a\n    <ul>\n      <li>+</li>\n    </ul>\n  </li>\n</ul>\n<blockquote><p>b</p></blockquote>"
  },
  {
    "input": "- a\n  - +\n x",
    "expected": "<ul>\n  <li>a\n    <ul>\n      <li>+\nx</li>\n    </ul>\n  </li>\n</ul>"
  },
  {
    "input": "- a\n  - +\n- x",
    "expected": "<ul>\n  <li>a\n    <ul>\n      <li>+</li>\n    </ul>\n  </li>\n  <li>x</li>\n</ul>"
  },
  {
    "input": "- > +\n```\nx\n```",
    "expected": "<ul>\n  <li>\n    <blockquote><p>+</p></blockquote>\n  </li>\n</ul>\n<pre><code>x\n</code></pre>"
  },
  {
    "input": "> - +\n> > q",
    "expected": "<blockquote>\n  <ul>\n    <li>\n      <blockquote><p>q</p></blockquote>\n    </li>\n  </ul>\n</blockquote>"
  },
  {
    "input": "> - a\n  +\n  text",
    "expected": "<blockquote>\n  <ul>\n    <li>a\n+\ntext</li>\n  </ul>\n</blockquote>"
  },
  {
    "input": "- a\n  > q\n  +\n  para",
    "expected": "<ul>\n  <li>a\n    <blockquote>\n      <p>q</p>\n      <p>para</p>\n    </blockquote>\n  </li>\n</ul>"
  },
  {
    "input": "1. [ ] +",
    "expected": "<ol>\n  <li>[ ] +</li>\n</ol>"
  },
  {
    "input": "- [ ] +\n- s",
    "expected": "<ul class=\"task-list\">\n  <li><input type=\"checkbox\" disabled aria-label=\"+\"> +</li>\n</ul>\n<ul>\n  <li>s</li>\n</ul>"
  },
  {
    "input": "- [ ] a\n+\n- s",
    "expected": "<ul class=\"task-list\">\n  <li><input type=\"checkbox\" disabled aria-label=\"a +\"> a\n+</li>\n</ul>\n<ul>\n  <li>s</li>\n</ul>"
  },
  {
    "input": "[^a]: intro\n+\nmore\n\nsee[^a]",
    "expected": "<p>see<a id=\"fnref1\" href=\"#fn1\" role=\"doc-noteref\"><sup>1</sup></a></p>\n<section role=\"doc-endnotes\" aria-label=\"Footnotes\">\n  <hr>\n  <ol>\n    <li id=\"fn1\">\n      <p>intro</p>\n      <p>more<a href=\"#fnref1\" role=\"doc-backlink\" aria-label=\"Back to reference\">↩</a></p>\n    </li>\n  </ol>\n</section>"
  },
  {
    "input": ":: term\n:  intro\n+\nmore",
    "expected": "<dl>\n  <dt>term</dt>\n  <dd>\n    <p>intro</p>\n    <p>more</p>\n  </dd>\n</dl>"
  },
  {
    "input": "| a | b |\n- +\ntext",
    "expected": "<table>\n  <tbody>\n    <tr><td>a</td><td>b</td></tr>\n  </tbody>\n</table>\n<ul>\n  <li>text</li>\n</ul>"
  },
  {
    "input": "- a\n  - b\n\t+\n\t> q",
    "expected": "<ul>\n  <li>a\n    <ul>\n      <li>b\n+\n        <blockquote><p>q</p></blockquote>\n      </li>\n    </ul>\n  </li>\n</ul>"
  },
  {
    "input": "- a\n  - b\n  +  \n  > q",
    "expected": "<ul>\n  <li>a\n    <ul>\n      <li>b\n        <blockquote><p>q</p></blockquote>\n      </li>\n    </ul>\n  </li>\n</ul>"
  }
]

describe('relative continuation marker columns', () => {
  it.each(['- ', '1. '])('keeps a quoted attached fence payload exact for %s', marker => {
    const input = `> ${marker}\`\`\`\n> \n> +\n> \`\`\`\n> x\n> \`\`\`\n`
    expect(carveToHtml(input)).toContain('<pre><code>x\n</code></pre>')
  })

  it.each(['- a\n  - ```\n\n+\n```\nx\n```', '1. a\n  1. b\n    1. ```\n\n+\n```\nx\n```'])('keeps a nested fence blank when attachment opens a sibling fence in %s', input => {
    expect(carveToHtml(input)).toContain('<pre><code>\n</code></pre>')
    expect(carveToHtml(input)).toContain('<pre><code>x\n</code></pre>')
  })

  it.each(['- >+\n b\n', '- > +\n b\n'])('reads a first-block form in %s', input => {
    expect(carveToHtml(input)).toBe(input.includes('>+')
      ? '<ul>\n  <li>&gt;+\nb</li>\n</ul>'
      // Column 1 is no opener column of `- > +`, so the `+` stays quote text (CARVE-P9-067).
      : '<ul>\n  <li>\n    <blockquote><p>+\nb</p></blockquote>\n  </li>\n</ul>')
  })

  it('attaches a quoted follower at the quote column as a nested quote', () => {
    expect(carveToHtml('- > +\n  > more\n').replace(/>\s+</g, '><')).toContain('<blockquote><blockquote><p>more</p></blockquote></blockquote>')
  })

  it.each([
    ['> > - a\n>   +\n>   - b\n', '<blockquote><blockquote><ul><li>a\n+\n- b</li></ul></blockquote></blockquote>'],
    ['1. ordered\n  > > quote\n+  \n- item\n', '<ol><li>ordered</li></ol><blockquote><blockquote><p>quote\n+\n- item</p></blockquote></blockquote>'],
  ])('folds a refused marker like ordinary text in %s', (input, expected) => {
    expect(carveToHtml(input).replace(/>\s+</g, '><').replace(/\n\s*/g, '\n').trim()).toBe(expected)
  })

  it.each([
    ['> > - a\n> +\n>   - b\n', '<blockquote><blockquote><ul><li>a\n+\n- b</li></ul></blockquote></blockquote>'],
    ['> > - [ ] a\n> +\n> tail', '<blockquote><blockquote><ul class="task-list"><li><input type="checkbox" disabled aria-label="a"> a</li></ul><p>tail</p></blockquote></blockquote>'],
    ['- a\n  > q\n+\n- b\n', '<ul><li>a\n<blockquote><p>q\n+</p></blockquote></li><li>b</li></ul>'],
    ['- a\n  > q\n  +\n  - b\n', '<ul><li>a\n<blockquote><p>q</p><ul><li>b</li></ul></blockquote></li></ul>'],
    ['> - a\n>   > q\n>   +\n>   para\n', '<blockquote><ul><li>a\n<blockquote><p>q</p><p>para</p></blockquote></li></ul></blockquote>'],
    ['  * [ ] task\n    [^n]: note\n\t+\n\ttext\n\nsee[^n]\n', '<p>text<a href="#fnref1" role="doc-backlink" aria-label="Back to reference">↩</a></p>'],
    ['  - a\n    [^n]: note\n    +\n    1. ordered\n\nsee[^n]\n', '<ol>\n        <li>ordered</li>\n      </ol>'],
    ['* [ ] task\n  * [ ] task\n    1. ordered\n      > quote\n\t+\n\ttext\n', '<blockquote><p>quote\n+\ntext</p></blockquote>'],
  ])('uses the owning container for %s', (input, expected) => {
    const html = carveToHtml(input)
    if (input.startsWith('>') || input.startsWith('- a\n  >')) expect(html.replace(/>\s+</g, '><').replace(/\n\s*/g, '\n').trim()).toBe(expected)
    else expect(html).toContain(expected)
  })

  it('keeps a nested footnote continuation inside that note', () => {
    const html = carveToHtml(':: term\n:  detail\n  [^n]: note\n    [^n]: note\n      * [ ] task\n    +\n    :  detail\n')
    expect(html).toBe('<dl>\n  <dt>term</dt>\n  <dd>detail</dd>\n</dl>')
    expect(html).not.toContain('<p>+\n:  detail</p>')
  })

  it('attaches a table at its quote marker column', () => {
    const html = carveToHtml('* [ ] task\n  :: term\n  :  detail\n    > quote\n    > [^n]: note\n    +\n    | a |\n| b |\n')
    expect(html).toContain('<blockquote>\n      <p>quote</p>\n      <table>')
    expect(html).not.toContain('    +\n')
  })

  it('accepts a nested list marker after its footnote', () => {
    expect(carveToHtml('- a\n  1. ordered\n    [^n]: note\n  +\n  > quote\n')).toBe('<ul>\n  <li>a\n    <ol>\n      <li>ordered</li>\n    </ol>\n    <blockquote><p>quote</p></blockquote>\n  </li>\n</ul>')
  })

  it('attaches tabbed text after a nested description at its list column', () => {
    expect(carveToHtml('1. ordered\n  [^n]: note\n    1. ordered\n      :: term\n      :  detail\n\t+\n\ttext\n')).toBe('<ol>\n  <li>ordered</li>\n</ol>')
  })

  it('measures a tab after a quote prefix in that quote frame', () => {
    const source = '> - a\n>   - b\n> \t+\n>   > q\n'
    const expected = '<blockquote>\n  <ul>\n    <li>a\n      <ul>\n        <li>b\n+</li>\n      </ul>\n      <blockquote><p>q</p></blockquote>\n    </li>\n  </ul>\n</blockquote>'
    expect(carveToHtml(source)).toBe(expected)
  })

  it('keeps an unprefixed marker below an inner quote as text', () => {
    expect(carveToHtml('- a\n  > > q\n    +\n    para\n')).toContain('<blockquote><p>q\n+\npara</p></blockquote>')
  })

  it('keeps a tabbed marker with its open nested list item', () => {
    const html = carveToHtml('1. ordered\n  1. ordered\n    - a\n      * [ ] task\n\t+  \n    :  detail\n')
    expect(html).toContain('task\n+\n:  detail</li>')
  })

  it('keeps an unprefixed marker after lazy quote text in its description', () => {
    const html = carveToHtml(':: term\n:  detail\n  > quote\n+\n* [x] done\n')
    expect(html).toContain('<dd>detail\n&gt; quote\n+\n* [x] done</dd>')
  })

  it.each([
    ['a\n+\nb', []],
    // PART 0 S2: a `+` at an item's content column is a letter, so it is quiet (carve#4648).
    ['- a\n  +\n  x', []],
    ['- foo\n  - [ ] task\n    +\n    text', []],
  ] as const)('keeps the plus literal and reports any unowned marker in %s', (input, expected) => {
    expect(lintCarve(input).filter(warning => warning.rule === 'continuation-marker-refused')
      .map(warning => [warning.line, warning.column])).toEqual(expected)
  })

  it.each([
    ['- a\n+\n- b', 2, 1, 'sibling'],
  ] as const)('reports the refused marker at $0', (input, line, column, reason) => {
    const findings = lintCarve(input).filter(warning => warning.rule === 'continuation-marker-refused')
    expect(findings).toHaveLength(1)
    expect(findings[0]).toMatchObject({ line, column })
    expect(findings[0]!.message).toContain(reason)
  })

  it.each([
    {
      input: '> - a\n> +\n> \n> tail',
      expected: '<blockquote>\n  <ul>\n    <li>a\n+</li>\n  </ul>\n  <p>tail</p>\n</blockquote>',
    },
    {
      input: '> - a\n>   - b\n>   +\n>   > q',
      expected: '<blockquote>\n  <ul>\n    <li>a\n      <ul>\n        <li>b\n          <blockquote><p>q</p></blockquote>\n        </li>\n      </ul>\n    </li>\n  </ul>\n</blockquote>',
    },
  ])('keeps quoted marker ownership for $input', ({ input, expected }) => {
    expect(carveToHtml(input)).toBe(expected)
  })

  it.each(cases)('reads $input', ({ input, expected }) => {
    expect(carveToHtml(input)).toBe(expected)
  })

  it.each([
    '- a\n\t- b\n\tc\n',
    '- a\n\t- b\n\t+\n\t> q\n',
  ])('anchors tab-indented list positions to their authored marker', input => {
    const outer = parse(input, { positions: true }).children[0]
    expect(outer?.type).toBe('list')
    if (outer?.type !== 'list') return
    const nested = outer.items[0]?.children[1]
    expect(nested?.type).toBe('list')
    if (nested?.type !== 'list') return
    expect(nested.pos).toMatchObject({ startLine: 2, startColumn: 2, startOffset: 5 })
    expect(nested.items[0]?.pos).toMatchObject({ startLine: 2, startColumn: 2, startOffset: 5 })
  })

  it.each([
  "- a\n  - b\n  +\n  > q",
  "- a\n  - [ ] task\n  +\n  ```\n  code\n  ```"
])('round-trips nested item blocks', input => {
    const original = parse(input, { positions: false })
    const written = renderCarve(original)
    expect({ ...parse(written, { positions: false }), srcByteLength: 0 }).toEqual({ ...original, srcByteLength: 0 })
  })

  it.each([
    '- outer\n  - inner\n    > q\n  +\n  tail',
    '- outer\n  - inner\n    - child\n  +\n  tail',
  ])('round-trips a nested item with a following block', input => {
    const original = parse(input, { positions: false })
    const written = renderCarve(original)
    expect({ ...parse(written, { positions: false }), srcByteLength: 0 }).toEqual({ ...original, srcByteLength: 0 })
  })

  it('uses a content-column spelling when it preserves a nested tight item', () => {
    const original = parse('- outer\n  - inner\n\n    > q', { positions: false })
    const written = renderCarve(original)
    expect(written).toBe('- outer\n  - inner\n    > q\n')
    expect({ ...parse(written, { positions: false }), srcByteLength: 0 }).toEqual({ ...original, srcByteLength: 0 })
  })

  it.each(['see a > b', 'see <b>x</b>'])('keeps a greater-than sign in description text: %s', lead => {
    const html = carveToHtml(`:: t\n: ${lead}\n+\n> quoted\n`)
    expect(html).toContain('<blockquote><p>quoted</p></blockquote>')
    expect(html).not.toContain('<p>+</p>')
  })

  it('adds buffered blanks only to the last open descendant fence', () => {
    const source = '- a\n  - b\n    ```\n    one\n    ```\n    ```\n    two\n\n\n+\nmore\n'
    const outer = parse(source, { positions: false }).children[0]
    expect(outer?.type).toBe('list')
    if (outer?.type !== 'list') return
    const nested = outer.items[0]?.children.find(block => block.type === 'list')
    expect(nested?.type).toBe('list')
    if (nested?.type !== 'list') return
    expect(nested.items[0]?.children.filter(block => block.type === 'code_block').map(block => block.content))
      .toEqual(['one\n', 'two\n\n\n'])
  })
})
