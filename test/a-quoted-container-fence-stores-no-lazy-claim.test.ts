import { it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'

const cases = [
  [
    "514-a-fence-a-container-inside-a-quote-holds-open-stores-no-claim-10",
    "> - a\n>\n>   ```\n>   x\n> after\nflush\n",
    "<blockquote>\n  <ul>\n    <li>a\n      <pre><code>x\n</code></pre>\n    </li>\n  </ul>\n  <p>after\nflush</p>\n</blockquote>\n"
  ],
  [
    "514-a-fence-a-container-inside-a-quote-holds-open-stores-no-claim-11",
    "> :  a\n>\n>    ```\n>    x\nflush\n",
    "<blockquote>\n  <p>:  a</p>\n  <p><code>\nx\nflush</code></p>\n</blockquote>\n"
  ],
  [
    "514-a-fence-a-container-inside-a-quote-holds-open-stores-no-claim-12",
    "> :: t\n> :  d\n>    - ```\n>      x\nflush\n",
    "<blockquote>\n  <dl>\n    <dt>t</dt>\n    <dd>d\n- <code>\nx\nflush</code></dd>\n  </dl>\n</blockquote>\n"
  ],
  [
    "514-a-fence-a-container-inside-a-quote-holds-open-stores-no-claim-2",
    "> - a\n>   - b\n>\n>     ```\n>     x\nflush\n",
    "<blockquote>\n  <ul>\n    <li>a\n      <ul>\n        <li>b\n          <pre><code>x\n</code></pre>\n        </li>\n      </ul>\n    </li>\n  </ul>\n</blockquote>\n<p>flush</p>\n"
  ],
  [
    "514-a-fence-a-container-inside-a-quote-holds-open-stores-no-claim-3",
    "> - a\n>\n>   ```\n>   x\n>   ```\nflush\n",
    "<blockquote>\n  <ul>\n    <li>a\n      <pre><code>x\n</code></pre>\n    </li>\n  </ul>\n</blockquote>\n<p>flush</p>\n"
  ],
  [
    "514-a-fence-a-container-inside-a-quote-holds-open-stores-no-claim-4",
    "> - a\n>   - b\n>\n>     ```\n>     x\n>     ```\nflush\n",
    "<blockquote>\n  <ul>\n    <li>a\n      <ul>\n        <li>b\n          <pre><code>x\n</code></pre>\n        </li>\n      </ul>\n    </li>\n  </ul>\n</blockquote>\n<p>flush</p>\n"
  ],
  [
    "514-a-fence-a-container-inside-a-quote-holds-open-stores-no-claim-5",
    "> - ```\n>   x\nflush\n",
    "<blockquote>\n  <ul>\n    <li>\n      <pre><code>x\n</code></pre>\n    </li>\n  </ul>\n</blockquote>\n<p>flush</p>\n"
  ],
  [
    "514-a-fence-a-container-inside-a-quote-holds-open-stores-no-claim-6",
    "> [^f]: t\n>\n>   ```\n>   x\nflush\n",
    "<blockquote>\n\n</blockquote>\n<p>flush</p>\n"
  ],
  [
    "514-a-fence-a-container-inside-a-quote-holds-open-stores-no-claim-7",
    "> - a\n>\n>   ```\n>   x\n>   ```\n>\n>   z\nflush\n",
    "<blockquote>\n  <ul>\n    <li><p>a</p>\n      <pre><code>x\n</code></pre>\n      <p>z\nflush</p>\n    </li>\n  </ul>\n</blockquote>\n"
  ],
  [
    "514-a-fence-a-container-inside-a-quote-holds-open-stores-no-claim-8",
    "> > - a\n> >\n> >   ```\n> >   x\nflush\n",
    "<blockquote>\n  <blockquote>\n    <ul>\n      <li>a\n        <pre><code>x\n</code></pre>\n      </li>\n    </ul>\n  </blockquote>\n</blockquote>\n<p>flush</p>\n"
  ],
  [
    "514-a-fence-a-container-inside-a-quote-holds-open-stores-no-claim-9",
    "> - a\n> - ```\n>   x\nflush\n",
    "<blockquote>\n  <ul>\n    <li>a</li>\n    <li>\n      <pre><code>x\n</code></pre>\n    </li>\n  </ul>\n</blockquote>\n<p>flush</p>\n"
  ],
  [
    "514-a-fence-a-container-inside-a-quote-holds-open-stores-no-claim",
    "> - a\n>\n>   ```\n>   x\nflush\n",
    "<blockquote>\n  <ul>\n    <li>a\n      <pre><code>x\n</code></pre>\n    </li>\n  </ul>\n</blockquote>\n<p>flush</p>\n"
  ],
  [
    "a lazy line preserves the item column",
    "> - a\nb\n>\n>   ```\n>   x\nflush\n",
    "<blockquote>\n  <ul>\n    <li>a\nb\n      <pre><code>x\n</code></pre>\n    </li>\n  </ul>\n</blockquote>\n<p>flush</p>"
  ],
  [
    "a lazy line before a closed fence",
    "> - a\nb\n>\n>   ```\n>   x\n>   ```\nflush\n",
    "<blockquote>\n  <ul>\n    <li>a\nb\n      <pre><code>x\n</code></pre>\n    </li>\n  </ul>\n</blockquote>\n<p>flush</p>"
  ],
  [
    "a lazy line preserves nested item columns",
    "> - a\n>   - b\nc\n>\n>     ```\n>     x\nflush\n",
    "<blockquote>\n  <ul>\n    <li>a\n      <ul>\n        <li>b\nc\n          <pre><code>x\n</code></pre>\n        </li>\n      </ul>\n    </li>\n  </ul>\n</blockquote>\n<p>flush</p>"
  ],
  [
    "an invalid info string leaves no closer",
    "> - a\n>   ```bad`\n>\n>   ```\n>   x\nflush\n",
    "<blockquote>\n  <ul>\n    <li>a\n<code>bad`</code>\n      <pre><code>x\n</code></pre>\n    </li>\n  </ul>\n</blockquote>\n<p>flush</p>"
  ],
  [
    "over-indented runs pair",
    "> - a\n>     ~~~\n>     x\n>     ~~~\n>\n>   ~~~\n>   x\nflush\n",
    "<blockquote>\n  <ul>\n    <li>a\n      <pre><code>x\n</code></pre>\n      <pre><code>x\n</code></pre>\n    </li>\n  </ul>\n</blockquote>\n<p>flush</p>"
  ],
  [
    "an over-indented opener consumes its closer",
    "> - a\n>     ```\n>\n>   ```\n>   a\nflush\n",
    "<blockquote>\n  <ul>\n    <li>a\n      <pre><code>\n</code></pre>\n      a\nflush\n    </li>\n  </ul>\n</blockquote>"
  ],
  [
    "a fence without a closer stays inline",
    "> - a\n>   ```\n>   x\nflush\n",
    "<blockquote>\n  <ul>\n    <li>a\n<code>\nx\nflush</code></li>\n  </ul>\n</blockquote>"
  ]
]

it.each(cases)('%s', (_name, source, expected) => {
  expect(carveToHtml(source)).toBe(expected.trimEnd())
})

it('tracks code and raw fences across quote depths and marker widths', () => {
  for (const depth of [1, 2, 3]) for (const fence of ['```', '~~~', '```=html']) {
    for (const [marker, column] of [['- ', 2], ['1. ', 3], ['- [x] ', 2], ['-{.x} ', 2]] as const) {
      for (const closed of [false, true]) {
        const quote = '> '.repeat(depth)
        const pad = ' '.repeat(column)
        const closer = fence.startsWith('~') ? '~~~' : '```'
        const source = `${quote}${marker}a\n${quote.trimEnd()}\n${quote}${pad}${fence}\n${quote}${pad}x\n${closed ? `${quote}${pad}${closer}\n` : ''}flush\n`
        expect(carveToHtml(source), source).toMatch(/<\/blockquote>\n<p>flush<\/p>$/)
      }
    }
  }
})
