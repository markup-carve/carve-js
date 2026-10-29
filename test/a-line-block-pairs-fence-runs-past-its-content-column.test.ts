import { expect, it } from 'vitest'
import type { Document, InlineNode } from '../src/ast.js'
import { carveToCarve, carveToHtml, htmlToCarve, parse, renderCarve, SourceUnspellableError } from '../src/index.js'

it('pairs overindented runs in a list line block', () => {
  const source = ['- ::: |', '    ```', '  :::', '    ```', '  :::', '  para', 'tail', ''].join('\n')
  expect(carveToHtml(source)).toBe(`<ul>
  <li>
    <div class="line-block">
      <p>&nbsp;&nbsp;<code>
:::
&nbsp;&nbsp;</code></p>
    </div>
    para
tail
  </li>
</ul>`)
})

it('pairs overindented runs in a quoted list line block', () => {
  const source = ['> - ::: |', '>     ```', '>   :::', '>     ```', '>   :::', '>   :::bad', '>   :::', '- tail', ''].join('\n')
  expect(carveToHtml(source)).toBe(`<blockquote>
  <ul>
    <li>
      <div class="line-block">
        <p>&nbsp;&nbsp;<code>
:::
&nbsp;&nbsp;</code></p>
      </div>
      :::bad
:::
- tail
    </li>
  </ul>
</blockquote>`)
})

it('leaves an unpaired overindented run in its line block', () => {
  const source = ['- ::: |', '    ```', '  :::', '  para', 'tail', ''].join('\n')
  expect(carveToHtml(source)).toBe(`<ul>
  <li>
    <div class="line-block">
      <p>&nbsp;&nbsp;<code></code></p>
    </div>
    para
tail
  </li>
</ul>`)
})

it('opens an overindented code fence in a plain div', () => {
  const source = ['- ::: box', '    ```', '  :::', '    ```', '  :::', '  para', 'tail', ''].join('\n')
  expect(carveToHtml(source)).toBe(`<ul>
  <li>
    <div class="box">
      <pre><code>:::
</code></pre>
    </div>
    para
tail
  </li>
</ul>`)
})

 it("keeps lazy prose after mixed-column runs in bullet ordered and quoted items", () => {
  expect(carveToHtml(["- ::: |", "  ```", "  :::", "    ```", "  :::", "  para", "tail", ''].join('\n'))).toBe("<ul>\n  <li>\n    <div class=\"line-block\">\n      <p><code>\n:::\n&nbsp;&nbsp;</code></p>\n    </div>\n    para\ntail\n  </li>\n</ul>")
  expect(carveToHtml(["- ::: |", "   ```", "  :::", "    ```", "  :::", "  para", "tail", ''].join('\n'))).toBe("<ul>\n  <li>\n    <div class=\"line-block\">\n      <p>&nbsp;<code>\n:::\n&nbsp;&nbsp;</code></p>\n    </div>\n    para\ntail\n  </li>\n</ul>")
  expect(carveToHtml(["- ::: |", "    ```", "  :::", "  ```", "  :::", "  para", "tail", ''].join('\n'))).toBe("<ul>\n  <li>\n    <div class=\"line-block\">\n      <p>&nbsp;&nbsp;<code>\n:::\n</code></p>\n    </div>\n    para\ntail\n  </li>\n</ul>")
  expect(carveToHtml(["- ::: |", "    ```", "  :::", "    ```", "  :::", "  para", "tail", ''].join('\n'))).toBe("<ul>\n  <li>\n    <div class=\"line-block\">\n      <p>&nbsp;&nbsp;<code>\n:::\n&nbsp;&nbsp;</code></p>\n    </div>\n    para\ntail\n  </li>\n</ul>")
  expect(carveToHtml(["- ::: |", "      ```", "  :::", "  ```", "  :::", "  para", "tail", ''].join('\n'))).toBe("<ul>\n  <li>\n    <div class=\"line-block\">\n      <p>&nbsp;&nbsp;&nbsp;&nbsp;<code>\n:::\n</code></p>\n    </div>\n    para\ntail\n  </li>\n</ul>")
  expect(carveToHtml(["- ::: |", "      ```", "  :::", "    ```", "  :::", "  para", "tail", ''].join('\n'))).toBe("<ul>\n  <li>\n    <div class=\"line-block\">\n      <p>&nbsp;&nbsp;&nbsp;&nbsp;<code>\n:::\n&nbsp;&nbsp;</code></p>\n    </div>\n    para\ntail\n  </li>\n</ul>")
  expect(carveToHtml(["- ::: |", "  ~~~", "  :::", "    ~~~", "  :::", "  para", "tail", ''].join('\n'))).toBe("<ul>\n  <li>\n    <div class=\"line-block\">\n      <p>~~~<br>\n:::<br>\n&nbsp;&nbsp;~~~</p>\n    </div>\n    para\ntail\n  </li>\n</ul>")
  expect(carveToHtml(["- ::: |", "   ~~~", "  :::", "    ~~~", "  :::", "  para", "tail", ''].join('\n'))).toBe("<ul>\n  <li>\n    <div class=\"line-block\">\n      <p>&nbsp;~~~<br>\n:::<br>\n&nbsp;&nbsp;~~~</p>\n    </div>\n    para\ntail\n  </li>\n</ul>")
  expect(carveToHtml(["- ::: |", "    ~~~", "  :::", "  ~~~", "  :::", "  para", "tail", ''].join('\n'))).toBe("<ul>\n  <li>\n    <div class=\"line-block\">\n      <p>&nbsp;&nbsp;~~~<br>\n:::<br>\n~~~</p>\n    </div>\n    para\ntail\n  </li>\n</ul>")
  expect(carveToHtml(["- ::: |", "    ~~~", "  :::", "    ~~~", "  :::", "  para", "tail", ''].join('\n'))).toBe("<ul>\n  <li>\n    <div class=\"line-block\">\n      <p>&nbsp;&nbsp;~~~<br>\n:::<br>\n&nbsp;&nbsp;~~~</p>\n    </div>\n    para\ntail\n  </li>\n</ul>")
  expect(carveToHtml(["- ::: |", "      ~~~", "  :::", "  ~~~", "  :::", "  para", "tail", ''].join('\n'))).toBe("<ul>\n  <li>\n    <div class=\"line-block\">\n      <p>&nbsp;&nbsp;&nbsp;&nbsp;~~~<br>\n:::<br>\n~~~</p>\n    </div>\n    para\ntail\n  </li>\n</ul>")
  expect(carveToHtml(["- ::: |", "      ~~~", "  :::", "    ~~~", "  :::", "  para", "tail", ''].join('\n'))).toBe("<ul>\n  <li>\n    <div class=\"line-block\">\n      <p>&nbsp;&nbsp;&nbsp;&nbsp;~~~<br>\n:::<br>\n&nbsp;&nbsp;~~~</p>\n    </div>\n    para\ntail\n  </li>\n</ul>")
  expect(carveToHtml(["> - ::: |", ">   ```", ">   :::", ">     ```", ">   :::", ">   para", "tail", ''].join('\n'))).toBe("<blockquote>\n  <ul>\n    <li>\n      <div class=\"line-block\">\n        <p><code>\n:::\n&nbsp;&nbsp;</code></p>\n      </div>\n      para\ntail\n    </li>\n  </ul>\n</blockquote>")
  expect(carveToHtml(["> - ::: |", ">    ```", ">   :::", ">   ```", ">   :::", ">   para", "tail", ''].join('\n'))).toBe("<blockquote>\n  <ul>\n    <li>\n      <div class=\"line-block\">\n        <p>&nbsp;<code>\n:::\n</code></p>\n      </div>\n      para\ntail\n    </li>\n  </ul>\n</blockquote>")
  expect(carveToHtml(["> - ::: |", ">    ```", ">   :::", ">     ```", ">   :::", ">   para", "tail", ''].join('\n'))).toBe("<blockquote>\n  <ul>\n    <li>\n      <div class=\"line-block\">\n        <p>&nbsp;<code>\n:::\n&nbsp;&nbsp;</code></p>\n      </div>\n      para\ntail\n    </li>\n  </ul>\n</blockquote>")
  expect(carveToHtml(["> - ::: |", ">     ```", ">   :::", ">   ```", ">   :::", ">   para", "tail", ''].join('\n'))).toBe("<blockquote>\n  <ul>\n    <li>\n      <div class=\"line-block\">\n        <p>&nbsp;&nbsp;<code>\n:::\n</code></p>\n      </div>\n      para\ntail\n    </li>\n  </ul>\n</blockquote>")
  expect(carveToHtml(["> - ::: |", ">     ```", ">   :::", ">     ```", ">   :::", ">   para", "tail", ''].join('\n'))).toBe("<blockquote>\n  <ul>\n    <li>\n      <div class=\"line-block\">\n        <p>&nbsp;&nbsp;<code>\n:::\n&nbsp;&nbsp;</code></p>\n      </div>\n      para\ntail\n    </li>\n  </ul>\n</blockquote>")
  expect(carveToHtml(["> - ::: |", ">       ```", ">   :::", ">   ```", ">   :::", ">   para", "tail", ''].join('\n'))).toBe("<blockquote>\n  <ul>\n    <li>\n      <div class=\"line-block\">\n        <p>&nbsp;&nbsp;&nbsp;&nbsp;<code>\n:::\n</code></p>\n      </div>\n      para\ntail\n    </li>\n  </ul>\n</blockquote>")
  expect(carveToHtml(["> - ::: |", ">       ```", ">   :::", ">     ```", ">   :::", ">   para", "tail", ''].join('\n'))).toBe("<blockquote>\n  <ul>\n    <li>\n      <div class=\"line-block\">\n        <p>&nbsp;&nbsp;&nbsp;&nbsp;<code>\n:::\n&nbsp;&nbsp;</code></p>\n      </div>\n      para\ntail\n    </li>\n  </ul>\n</blockquote>")
  expect(carveToHtml(["> - ::: |", ">   ~~~", ">   :::", ">     ~~~", ">   :::", ">   para", "tail", ''].join('\n'))).toBe("<blockquote>\n  <ul>\n    <li>\n      <div class=\"line-block\">\n        <p>~~~<br>\n:::<br>\n&nbsp;&nbsp;~~~</p>\n      </div>\n      para\ntail\n    </li>\n  </ul>\n</blockquote>")
  expect(carveToHtml(["> - ::: |", ">    ~~~", ">   :::", ">   ~~~", ">   :::", ">   para", "tail", ''].join('\n'))).toBe("<blockquote>\n  <ul>\n    <li>\n      <div class=\"line-block\">\n        <p>&nbsp;~~~<br>\n:::<br>\n~~~</p>\n      </div>\n      para\ntail\n    </li>\n  </ul>\n</blockquote>")
  expect(carveToHtml(["> - ::: |", ">    ~~~", ">   :::", ">     ~~~", ">   :::", ">   para", "tail", ''].join('\n'))).toBe("<blockquote>\n  <ul>\n    <li>\n      <div class=\"line-block\">\n        <p>&nbsp;~~~<br>\n:::<br>\n&nbsp;&nbsp;~~~</p>\n      </div>\n      para\ntail\n    </li>\n  </ul>\n</blockquote>")
  expect(carveToHtml(["> - ::: |", ">     ~~~", ">   :::", ">   ~~~", ">   :::", ">   para", "tail", ''].join('\n'))).toBe("<blockquote>\n  <ul>\n    <li>\n      <div class=\"line-block\">\n        <p>&nbsp;&nbsp;~~~<br>\n:::<br>\n~~~</p>\n      </div>\n      para\ntail\n    </li>\n  </ul>\n</blockquote>")
  expect(carveToHtml(["> - ::: |", ">     ~~~", ">   :::", ">     ~~~", ">   :::", ">   para", "tail", ''].join('\n'))).toBe("<blockquote>\n  <ul>\n    <li>\n      <div class=\"line-block\">\n        <p>&nbsp;&nbsp;~~~<br>\n:::<br>\n&nbsp;&nbsp;~~~</p>\n      </div>\n      para\ntail\n    </li>\n  </ul>\n</blockquote>")
  expect(carveToHtml(["> - ::: |", ">       ~~~", ">   :::", ">   ~~~", ">   :::", ">   para", "tail", ''].join('\n'))).toBe("<blockquote>\n  <ul>\n    <li>\n      <div class=\"line-block\">\n        <p>&nbsp;&nbsp;&nbsp;&nbsp;~~~<br>\n:::<br>\n~~~</p>\n      </div>\n      para\ntail\n    </li>\n  </ul>\n</blockquote>")
  expect(carveToHtml(["> - ::: |", ">       ~~~", ">   :::", ">     ~~~", ">   :::", ">   para", "tail", ''].join('\n'))).toBe("<blockquote>\n  <ul>\n    <li>\n      <div class=\"line-block\">\n        <p>&nbsp;&nbsp;&nbsp;&nbsp;~~~<br>\n:::<br>\n&nbsp;&nbsp;~~~</p>\n      </div>\n      para\ntail\n    </li>\n  </ul>\n</blockquote>")
  expect(carveToHtml(["1. ::: |", "   ```", "   :::", "     ```", "   :::", "   para", "tail", ''].join('\n'))).toBe("<ol>\n  <li>\n    <div class=\"line-block\">\n      <p><code>\n:::\n&nbsp;&nbsp;</code></p>\n    </div>\n    para\ntail\n  </li>\n</ol>")
  expect(carveToHtml(["1. ::: |", "    ```", "   :::", "   ```", "   :::", "   para", "tail", ''].join('\n'))).toBe("<ol>\n  <li>\n    <div class=\"line-block\">\n      <p>&nbsp;<code>\n:::\n</code></p>\n    </div>\n    para\ntail\n  </li>\n</ol>")
  expect(carveToHtml(["1. ::: |", "    ```", "   :::", "     ```", "   :::", "   para", "tail", ''].join('\n'))).toBe("<ol>\n  <li>\n    <div class=\"line-block\">\n      <p>&nbsp;<code>\n:::\n&nbsp;&nbsp;</code></p>\n    </div>\n    para\ntail\n  </li>\n</ol>")
  expect(carveToHtml(["1. ::: |", "     ```", "   :::", "   ```", "   :::", "   para", "tail", ''].join('\n'))).toBe("<ol>\n  <li>\n    <div class=\"line-block\">\n      <p>&nbsp;&nbsp;<code>\n:::\n</code></p>\n    </div>\n    para\ntail\n  </li>\n</ol>")
  expect(carveToHtml(["1. ::: |", "     ```", "   :::", "     ```", "   :::", "   para", "tail", ''].join('\n'))).toBe("<ol>\n  <li>\n    <div class=\"line-block\">\n      <p>&nbsp;&nbsp;<code>\n:::\n&nbsp;&nbsp;</code></p>\n    </div>\n    para\ntail\n  </li>\n</ol>")
  expect(carveToHtml(["1. ::: |", "       ```", "   :::", "   ```", "   :::", "   para", "tail", ''].join('\n'))).toBe("<ol>\n  <li>\n    <div class=\"line-block\">\n      <p>&nbsp;&nbsp;&nbsp;&nbsp;<code>\n:::\n</code></p>\n    </div>\n    para\ntail\n  </li>\n</ol>")
  expect(carveToHtml(["1. ::: |", "       ```", "   :::", "     ```", "   :::", "   para", "tail", ''].join('\n'))).toBe("<ol>\n  <li>\n    <div class=\"line-block\">\n      <p>&nbsp;&nbsp;&nbsp;&nbsp;<code>\n:::\n&nbsp;&nbsp;</code></p>\n    </div>\n    para\ntail\n  </li>\n</ol>")
  expect(carveToHtml(["1. ::: |", "   ~~~", "   :::", "     ~~~", "   :::", "   para", "tail", ''].join('\n'))).toBe("<ol>\n  <li>\n    <div class=\"line-block\">\n      <p>~~~<br>\n:::<br>\n&nbsp;&nbsp;~~~</p>\n    </div>\n    para\ntail\n  </li>\n</ol>")
  expect(carveToHtml(["1. ::: |", "    ~~~", "   :::", "   ~~~", "   :::", "   para", "tail", ''].join('\n'))).toBe("<ol>\n  <li>\n    <div class=\"line-block\">\n      <p>&nbsp;~~~<br>\n:::<br>\n~~~</p>\n    </div>\n    para\ntail\n  </li>\n</ol>")
  expect(carveToHtml(["1. ::: |", "    ~~~", "   :::", "     ~~~", "   :::", "   para", "tail", ''].join('\n'))).toBe("<ol>\n  <li>\n    <div class=\"line-block\">\n      <p>&nbsp;~~~<br>\n:::<br>\n&nbsp;&nbsp;~~~</p>\n    </div>\n    para\ntail\n  </li>\n</ol>")
  expect(carveToHtml(["1. ::: |", "     ~~~", "   :::", "   ~~~", "   :::", "   para", "tail", ''].join('\n'))).toBe("<ol>\n  <li>\n    <div class=\"line-block\">\n      <p>&nbsp;&nbsp;~~~<br>\n:::<br>\n~~~</p>\n    </div>\n    para\ntail\n  </li>\n</ol>")
  expect(carveToHtml(["1. ::: |", "     ~~~", "   :::", "     ~~~", "   :::", "   para", "tail", ''].join('\n'))).toBe("<ol>\n  <li>\n    <div class=\"line-block\">\n      <p>&nbsp;&nbsp;~~~<br>\n:::<br>\n&nbsp;&nbsp;~~~</p>\n    </div>\n    para\ntail\n  </li>\n</ol>")
  expect(carveToHtml(["1. ::: |", "       ~~~", "   :::", "   ~~~", "   :::", "   para", "tail", ''].join('\n'))).toBe("<ol>\n  <li>\n    <div class=\"line-block\">\n      <p>&nbsp;&nbsp;&nbsp;&nbsp;~~~<br>\n:::<br>\n~~~</p>\n    </div>\n    para\ntail\n  </li>\n</ol>")
  expect(carveToHtml(["1. ::: |", "       ~~~", "   :::", "     ~~~", "   :::", "   para", "tail", ''].join('\n'))).toBe("<ol>\n  <li>\n    <div class=\"line-block\">\n      <p>&nbsp;&nbsp;&nbsp;&nbsp;~~~<br>\n:::<br>\n&nbsp;&nbsp;~~~</p>\n    </div>\n    para\ntail\n  </li>\n</ol>")
})

 it("keeps the malformed-fence paragraph open after a quote line block", () => {
  expect(carveToHtml(["> ::: |", ">  ```", "> :::", ">   ```", "> :::", "> :::bad", "> :::", "- tail", ''].join('\n'))).toBe("<blockquote>\n  <div class=\"line-block\">\n    <p>&nbsp;<code>\n:::\n&nbsp;&nbsp;</code></p>\n  </div>\n  <p>:::bad\n:::\n- tail</p>\n</blockquote>")
})

 it("pairs mixed-column runs inside a description line block", () => {
  expect(carveToHtml([":: t", ": ::: |", "   ```", "  :::", "    ```", "  :::", "  para", "tail", ''].join('\n'))).toBe("<dl>\n  <dt>t</dt>\n  <dd>\n    <div class=\"line-block\">\n      <p>&nbsp;<code>\n:::\n&nbsp;&nbsp;</code></p>\n    </div>\n    <p>para\ntail</p>\n  </dd>\n</dl>")
})

for (const prefix of ['', '> ']) {
  it(`round-trips paired payload runs in a ${prefix ? 'quoted ' : ''}list line block`, () => {
    const source = [
      `${prefix}- ::: |`,
      prefix + '    ```',
      `${prefix}  :::`,
      prefix + '    ```',
      `${prefix}  :::`,
      `${prefix}  para`,
      `${prefix}tail`,
      '',
    ].join('\n')
    const formatted = carveToCarve(source)
    expect(formatted).toContain(prefix + '    ```\n' + prefix + '  :::\n')
    expect(carveToHtml(formatted)).toBe(carveToHtml(source))
    expect(carveToCarve(formatted)).toBe(formatted)
    // A `:::`-only code line in a container paragraph has no spelling (CARVE-P11-046, carve#3922).
    expect(() => htmlToCarve(carveToHtml(source))).toThrow(SourceUnspellableError)
  })
}

for (const node of [
  { type: 'code', value: '\n:::\n', attrs: { classes: ['marked'] } },
  { type: 'literal_inline', content: '\n:::\n' },
  { type: 'raw_inline', format: 'html', content: '\n:::\n' },
  { type: 'math', display: false, content: '\n:::\n' },
] satisfies InlineNode[]) {
  it(`refuses a ${node.type} that cannot hide its line-block closer`, () => {
    expect(() => renderCarve({
      type: 'document',
      children: [{
        type: 'line_block',
        children: [{ type: 'paragraph', children: [node] }],
      }],
    })).toThrow(SourceUnspellableError)
  })
}

it('keeps NBSP before a fence run as line-block content', () => {
  const source = `::: |
 ~~~
:::
 ~~~

after
`
  expect(carveToHtml(source)).toBe(`<div class="line-block">
  <p>&nbsp;~~~</p>
</div>
<p>&nbsp;~~~</p>
<p>after</p>`)
})

it('keeps EM SPACE before a fence run as line-block content', () => {
  const source = `::: |
 ~~~
:::
 ~~~

after
`
  expect(carveToHtml(source)).toBe(`<div class="line-block">
  <p> ~~~</p>
</div>
<p> ~~~</p>
<p>after</p>`)
})

it.each([
  ['a code span', '::: |\n`x\n:::`\n:::\n'],
  ['an attributed code span', '::: |\n`x\n:::`{.c}\n:::\n'],
  ['a raw inline', '::: |\n`x\n:::`{=html}\n:::\n'],
])('formats %s whose value ends in a colon run, which its delimiter keeps off a bare line', (_label, source) => {
  const written = carveToCarve(source)
  expect(carveToHtml(written)).toBe(carveToHtml(source))
})

const lineBlockTree = (children: InlineNode[]): Document => ({
  type: 'document',
  children: [{ type: 'line_block', children: [{ type: 'paragraph', children }] }],
})

it.each([
  [{ type: 'code', value: 'a\n:::\nb' }],
  [{ type: 'code', value: '\n:::\n ' }],
  [{ type: 'code', value: '\n:::\n\t' }],
  [{ type: 'text', value: 'x ' }, { type: 'code', value: '\n:::\n' }],
  [{ type: 'text', value: 'x' }, { type: 'code', value: '\n:::\nb' }, { type: 'text', value: ' y' }],
  [{ type: 'code', value: '\n:::\n' }, { type: 'text', value: 'y' }],
  [{ type: 'text', value: 'x' }, { type: 'soft_break' }, { type: 'code', value: '\n:::\n' }, { type: 'soft_break' }, { type: 'text', value: 'y' }],
] satisfies InlineNode[][])('refuses glued line-block code fences %j', (...children) => {
  expect(() => renderCarve(lineBlockTree(children))).toThrow(SourceUnspellableError)
})

it.each([
  [{ type: 'code', value: '\n:::\n' }],
  [{ type: 'text', value: 'x' }, { type: 'hard_break' }, { type: 'code', value: '\n:::\n' }, { type: 'hard_break' }, { type: 'text', value: 'y' }],
] satisfies InlineNode[][])('round-trips standalone line-block code fences %j', (...children) => {
  const tree = lineBlockTree(children)
  const structural = (value: unknown): unknown => JSON.parse(JSON.stringify(value, (key, item) =>
    ['pos', 'srcByteLength', 'marker', 'termSpans', 'definitionLines', 'definitionSpans'].includes(key) ? undefined : item))
  expect(structural(parse(renderCarve(tree)))).toEqual(structural(tree))
})
