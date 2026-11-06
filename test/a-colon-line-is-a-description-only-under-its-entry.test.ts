import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

const html = (source: string) => carveToHtml(source).trim()

// carve#5290: a `: ` line with no term above is paragraph text, whatever its body holds, so a lazy line continues it (PART 0 S4).
it.each([
  ['- u\n  : :: |\nb\n', '<ul>\n  <li>u\n: :: |\nb</li>\n</ul>'],
  ['- u\n  : # h\nb\n', '<ul>\n  <li>u\n: # h\nb</li>\n</ul>'],
  ['> - u\n>   : :: |\nb\n', '<blockquote>\n  <ul>\n    <li>u\n: :: |\nb</li>\n  </ul>\n</blockquote>'],
  ['- - u\n    : x\n: b\n', '<ul>\n  <li>\n    <ul>\n      <li>u\n: x\n: b</li>\n    </ul>\n  </li>\n</ul>'],
])('keeps a termless colon line in the item paragraph: %j', (source, expected) => {
  expect(html(source)).toBe(expected)
})

// carve#5289: a term holds no body, so a deeper line after it ends the entry and a later `: ` line is paragraph text.
it.each([
  ['- - :: t\n     a\n    : ```\nz\n',
    '<ul>\n  <li>\n    <ul>\n      <li>\n        <dl>\n          <dt>t</dt>\n        </dl>\n        a\n: <code>\nz</code>\n      </li>\n    </ul>\n  </li>\n</ul>'],
  ['- :: t\n   a\n  : # h\nz\n',
    '<ul>\n  <li>\n    <dl>\n      <dt>t</dt>\n    </dl>\n    a\n: # h\nz\n  </li>\n</ul>'],
])('reads a colon line after a term and a deeper line as text: %j', (source, expected) => {
  expect(html(source)).toBe(expected)
})

// A term on a sub-item's marker line, or one a line comment follows, still opens its description.
it.each([
  ['- - :: t\n    : ```\n: z\n'],
  ['- - :: t\n     %% c\n    : ```\n: z\n'],
])('keeps the description a marker-line term opens: %j', (source) => {
  expect(html(source)).toBe('<ul>\n  <li>\n    <ul>\n      <li>\n        <dl>\n          <dt>t</dt>\n          <dd>\n' +
    '            <pre><code></code></pre>\n          </dd>\n        </dl>\n      </li>\n    </ul>\n  </li>\n</ul>\n<p>: z</p>')
})
