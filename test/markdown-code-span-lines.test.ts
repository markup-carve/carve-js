import { expect, it } from 'vitest'
import { carveToHtml, markdownToCarve } from '../src/index.js'

it.each([
  ['* a `b\n  c` d\n* e', '<ul>\n  <li>a <code>b c</code> d</li>\n  <li>e</li>\n</ul>'],
  ['a `x\n   y` b', '<p>a <code>x y</code> b</p>'],
  ['- `a\n  # b`', '<ul>\n  <li>`a\n    <h1 id="b">b`</h1>\n  </li>\n</ul>'],
  ['a <!--> `x\ny` -->', '<p>a <!--> <code>x y</code> --&gt;</p>'],
  ['x <y `a\nb` z> w', '<p>x &lt;y <code>a b</code> z&gt; w</p>'],
  ['a <!-- `a\nb` --> b', '<p>a <!-- `a\nb` --> b</p>'],
  ['``\nfoo\n``', '<p><code>foo</code></p>'],
  ['``\nfoo\nbar  \nbaz\n``', '<p><code>foo bar   baz</code></p>'],
  ['``\nfoo \n``', '<p><code>foo </code></p>'],
  ['`foo   bar \nbaz`', '<p><code>foo   bar  baz</code></p>'],
  ['`code  \nspan`', '<p><code>code   span</code></p>'],
  ['`code\\\nspan`', '<p><code>code\\ span</code></p>'],
  ['a `  \n  ` b', '<p>a <code>   </code> b</p>'],
  ['<span title="`a\nb`">x</span>', '<p><span title="`a\nb`">x</span></p>'],
])('normalizes code-span line endings: %s', (source, expected) => {
  expect(carveToHtml(markdownToCarve(source))).toBe(expected)
})
