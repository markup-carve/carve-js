import { describe, expect, it } from 'vitest'
import { carveToHtml, parse } from '../src/index.js'
import { renderCarve } from '../src/render-carve.js'

describe('a line below an over-indented list fence', () => {
  it.each(['```', '~~~'])('ends the item holding %s', (fence) => {
    const source = `- head\n\n      ${fence}\n      a\ntext\n`
    const expected = '<ul>\n  <li>head\n    <pre><code>a\n</code></pre>\n  </li>\n</ul>\n<p>text</p>'
    expect(carveToHtml(source)).toBe(expected)
    const formatted = renderCarve(parse(source))
    expect(carveToHtml(formatted)).toBe(expected)
    expect(renderCarve(parse(formatted))).toBe(formatted)
  })

  it('ends an item holding a raw fence', () => {
    expect(carveToHtml('- head\n\n      ```=html\n      a\ntext\n')).toBe(
      '<ul>\n  <li>head\n    a\n  </li>\n</ul>\n<p>text</p>',
    )
  })

  it.each(['   ', '    ', '      ', '\t\t'])('measures the opener at %j', (indent) => {
    expect(carveToHtml(`- head\n\n${indent}\`\`\`\n${indent}a\ntext\n`)).toBe(
      '<ul>\n  <li>head\n    <pre><code>a\n</code></pre>\n  </li>\n</ul>\n<p>text</p>',
    )
  })
})

describe('over-indented fence boundary controls', () => {
  it('flush opener', () => {
    expect(carveToHtml('- head\n\n  ```\n  a\ntext\n')).toBe(
      '<ul>\n  <li>head\n    <pre><code>a\n</code></pre>\n  </li>\n</ul>\n<p>text</p>',
    )
  })
  it('sibling marker', () => {
    expect(carveToHtml('- head\n\n      ```\n      a\n- next\n')).toBe(
      '<ul>\n  <li>head\n    <pre><code>a\n</code></pre>\n  </li>\n  <li>next</li>\n</ul>',
    )
  })
  it('ordered host', () => {
    expect(carveToHtml('1. head\n\n       ```\n       a\ntext\n')).toBe(
      '<ol>\n  <li>head\n    <pre><code>a\n</code></pre>\n  </li>\n</ol>\n<p>text</p>',
    )
  })
  it('task host', () => {
    expect(carveToHtml('- [x] head\n\n      ```\n      a\ntext\n')).toBe(
      '<ul>\n  <li><input type="checkbox" checked disabled aria-label="head"> head\n    <pre><code>a\n</code></pre>\n  </li>\n</ul>\n<p>text</p>',
    )
  })
  it('closer at the base', () => {
    expect(carveToHtml('- head\n\n      ```\n      a\n      ```\ntext\n')).toBe(
      '<ul>\n  <li>head\n    <pre><code>a\n</code></pre>\n  </li>\n</ul>\n<p>text</p>',
    )
  })
  it('closer at the item column', () => {
    expect(carveToHtml('- head\n\n      ```\n      a\n  ```\ntext\n')).toBe(
      '<ul>\n  <li>head\n    <pre><code>a\n</code></pre>\n  </li>\n</ul>\n<p>text</p>',
    )
  })
  it('run below the base', () => {
    expect(carveToHtml('- head\n\n      ```\n      a\n    ```\ntext\n')).toBe(
      '<ul>\n  <li>head\n    <pre><code>a\n  ```\n</code></pre>\n  </li>\n</ul>\n<p>text</p>',
    )
  })
  it('run above the base', () => {
    expect(carveToHtml('- head\n\n      ```\n      a\n        ```\ntext\n')).toBe(
      '<ul>\n  <li>head\n    <pre><code>a\n  ```\n</code></pre>\n  </li>\n</ul>\n<p>text</p>',
    )
  })
  it('paragraph after the closer', () => {
    expect(carveToHtml('- head\n\n      ```\n      a\n      ```\n  para\ntext\n')).toBe(
      '<ul>\n  <li>head\n    <pre><code>a\n</code></pre>\n    para\ntext\n  </li>\n</ul>',
    )
  })
  // A FLUSH-LEFT LINE REACHES THE DOCUMENT, not the descendant's fence body.
  // Re-measured at markup-carve/carve `d4c15e82` after markup-carve/carve#2490:
  // the fence's host and everything between it and the owner the column selects
  // end there, and the fence ends unterminated (carve-js#2261).
  it('nested item', () => {
    expect(carveToHtml('- outer\n  - head\n\n        ```\n        a\ntext\n')).toBe(
      '<ul>\n  <li>outer\n    <ul>\n      <li>head\n        <pre><code>a\n</code></pre>\n      </li>\n    </ul>\n  </li>\n</ul>\n<p>text</p>',
    )
  })
  it('nested lazy text', () => {
    expect(carveToHtml('- outer\n  - head\n  lazy\n\n        ```\n        a\ntext\n')).toBe(
      '<ul>\n  <li>outer\n    <ul>\n      <li>head\nlazy\n        <pre><code>a\n</code></pre>\n      </li>\n    </ul>\n  </li>\n</ul>\n<p>text</p>',
    )
  })
  it('nested closed fence', () => {
    expect(carveToHtml('- outer\n  - head\n  lazy\n\n    ```\n    a\n    ```\ntext\n')).toBe(
      '<ul>\n  <li>outer\n    <ul>\n      <li>head\nlazy\n        <pre><code>a\n</code></pre>\n      </li>\n    </ul>\n    text\n  </li>\n</ul>',
    )
  })
  it('nested paragraph continuation', () => {
    expect(carveToHtml('- outer\n  - head\n    a\n     ~~~\n\n  - next\n')).toBe(
      '<ul>\n  <li>outer\n    <ul>\n      <li><p>head\na\n~~~</p></li>\n      <li><p>next</p></li>\n    </ul>\n  </li>\n</ul>',
    )
  })
  it('quoted paragraph continuation', () => {
    expect(carveToHtml('- head\n\n  > q\n    ```\n\n  - next\n')).toBe(
      '<ul>\n  <li>head\n    <blockquote><p>q\n<code></code></p></blockquote>\n    <ul>\n      <li>next</li>\n    </ul>\n  </li>\n</ul>',
    )
  })
  it('a heading before the fence', () => {
    expect(carveToHtml('- head\n\n  # heading\n      ```\n      a\ntext\n')).toBe(
      '<ul>\n  <li>head\n    <h1 id="heading">heading</h1>\n    <pre><code>a\n</code></pre>\n  </li>\n</ul>\n<p>text</p>',
    )
  })
})

describe('other container boundaries', () => {
  it('keeps the definition-description boundary already present on main', () => {
    expect(carveToHtml(':: term\n:  head\n\n       ```\n       a\ntext\n')).toBe(
      '<dl>\n  <dt>term</dt>\n  <dd>\n    <p>head</p>\n    <pre><code>a\n</code></pre>\n  </dd>\n</dl>\n<p>text</p>',
    )
  })

  it('keeps the footnote boundary', () => {
    const html = carveToHtml('[^n]\n\n[^n]: head\n\n      ```\n      a\ntext\n')
    expect(html).toContain('<p>text</p>\n<section role="doc-endnotes"')
    expect(html).toContain('<pre><code>a\n</code></pre>')
  })
})

describe('fence ownership after earlier blocks', () => {
  it('an inline fence after a sublist', () => {
    expect(carveToHtml('- head\n\n  - sub\n\n  para\n\n      ```\n      a\n      ```\ntext\n')).toBe(
      '<ul>\n  <li><p>head</p>\n    <ul>\n      <li>sub</li>\n    </ul>\n    <p>para</p>\n    <p><code>\na\n</code>\ntext</p>\n  </li>\n</ul>',
    )
  })
  it('an unfinished inline fence after a sublist', () => {
    expect(carveToHtml('- head\n\n  - sub\n\n  para\n\n      ```\n      a\ntext\n')).toBe(
      '<ul>\n  <li><p>head</p>\n    <ul>\n      <li>sub</li>\n    </ul>\n    <p>para</p>\n    <p><code>\na\ntext</code></p>\n  </li>\n</ul>',
    )
  })
  it('a heading after a sublist', () => {
    expect(carveToHtml('- head\n\n  - sub\n\n  # heading\n\n      ```\n      a\n      ```\ntext\n')).toBe(
      '<ul>\n  <li>head\n    <ul>\n      <li>sub</li>\n    </ul>\n    <h1 id=\"heading\">heading</h1>\n    <code>\na\n</code>\ntext\n  </li>\n</ul>',
    )
  })
  it('quote-lazy text', () => {
    expect(carveToHtml('> - head\n>\n>       ```\n>       a\ntext\n')).toBe(
      '<blockquote>\n  <ul>\n    <li>head\n      <pre><code>a\ntext\n</code></pre>\n    </li>\n  </ul>\n</blockquote>',
    )
  })
  it('trailing blank before a sibling', () => {
    expect(carveToHtml('- head\n\n      ```\n      a\n\n- next\n')).toBe(
      '<ul>\n  <li><p>head</p>\n    <pre><code>a\n\n</code></pre>\n  </li>\n  <li><p>next</p></li>\n</ul>',
    )
  })
  it('trailing blank before document text', () => {
    expect(carveToHtml('- head\n\n      ```\n      a\n\ntext\n')).toBe(
      '<ul>\n  <li>head\n    <pre><code>a\n\n</code></pre>\n  </li>\n</ul>\n<p>text</p>',
    )
  })
  it('trailing blank at EOF', () => {
    expect(carveToHtml('- head\n\n      ```\n      a\n\n')).toBe(
      '<ul>\n  <li>head\n    <pre><code>a\n\n</code></pre>\n  </li>\n</ul>',
    )
  })
})
