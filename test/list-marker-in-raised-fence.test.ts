import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'

// Expectations verified with the layout and HTML oracle at spec 8017328e.
const hosts = [
  ['item', 2, '- head\n\n', '', '<ul>\n  <li>head\n    ', '\n  </li>\n</ul>'],
  [
    'nested',
    4,
    '- outer\n\n  - inner\n\n',
    '',
    '<ul>\n  <li>outer\n    <ul>\n      <li>inner\n        ',
    '\n      </li>\n    </ul>\n  </li>\n</ul>',
  ],
  [
    'quoteitem',
    2,
    '> - head\n>\n',
    '> ',
    '<blockquote>\n  <ul>\n    <li>head\n      ',
    '\n    </li>\n  </ul>\n</blockquote>',
  ],
] as const

describe('list markers inside raised fences', () => {
  for (const [host, cc, prefix, quote, before, after] of hosts) {
    for (const [kind, opener] of [
      ['code', '```'],
      ['tilde', '~~~'],
      ['raw', '```=html'],
    ] as const) {
      for (const offset of [0, 4]) {
        const base = cc + offset
        for (const column of offset === 0 ? [cc, cc + 2] : [cc, cc + 2, base, base + 2]) {
          for (const payload of ['- second', '1. second', '- [x] second', 'second']) {
            it(`${host}: ${kind} opener +${offset}, payload column ${column}: ${payload}`, () => {
              const source =
                prefix +
                [' '.repeat(base) + opener, ' '.repeat(base) + 'a', ' '.repeat(column) + payload]
                  .map((line) => quote + line + '\n')
                  .join('')
              const residue = ' '.repeat(column < base ? column - cc : column - base)
              const body = 'a\n' + residue + payload + '\n'
              const block =
                kind === 'raw' ? body.slice(0, -1) : '<pre><code>' + body + '</code></pre>'
              expect(carveToHtml(source)).toBe(before + block + after)
            })
          }
        }
      }
    }
  }

  const guards = [
    [
      'marker-line fence retains payload indent',
      '- ```\n    - x\n  ```\n',
      '<ul>\n  <li>\n    <pre><code>  - x\n</code></pre>\n  </li>\n</ul>',
    ],
    [
      'column-zero marker still ends the item',
      '- head\n\n      ```\n      a\n- second\n',
      '<ul>\n  <li>head\n    <pre><code>a\n</code></pre>\n  </li>\n  <li>second</li>\n</ul>',
    ],
    [
      'document fence keeps marker payload',
      '```\na\n- second\n',
      '<pre><code>a\n- second\n</code></pre>',
    ],
    [
      'tab opener keeps marker at content column',
      '- head\n\n\t  ```\n\t  a\n  - second\n',
      '<ul>\n  <li>head\n    <pre><code>a\n- second\n</code></pre>\n  </li>\n</ul>',
    ],
    [
      'raised fence closer "  ```" before marker',
      '- head\n\n      ```\n      a\n  ```\n  - second\n',
      '<ul>\n  <li>head\n    <pre><code>a\n</code></pre>\n    <ul>\n      <li>second</li>\n    </ul>\n  </li>\n</ul>',
    ],
    [
      'raised fence closer "      ```" before marker',
      '- head\n\n      ```\n      a\n      ```\n  - second\n',
      '<ul>\n  <li>head\n    <pre><code>a\n</code></pre>\n    <ul>\n      <li>second</li>\n    </ul>\n  </li>\n</ul>',
    ],
    [
      'raised fence closer "    ```" before marker',
      '- head\n\n      ```\n      a\n    ```\n  - second\n',
      '<ul>\n  <li>head\n    <pre><code>a\n  ```\n- second\n</code></pre>\n  </li>\n</ul>',
    ],
    [
      'raised fence closer "        ```" before marker',
      '- head\n\n      ```\n      a\n        ```\n  - second\n',
      '<ul>\n  <li>head\n    <pre><code>a\n  ```\n- second\n</code></pre>\n  </li>\n</ul>',
    ],
  ] as const
  for (const [name, source, expected] of guards) {
    it(name, () => {
      expect(carveToHtml(source)).toBe(expected)
    })
  }
})
