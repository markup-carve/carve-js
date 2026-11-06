import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

it('keeps a later outer fence open until a closer below its item', () => {
  const source = ['- - +', '  ```', '  ```', '  ```', '', '  payload', '```'].join('\n')
  expect(carveToHtml(source)).toBe([
    '<ul>', '  <li>', '    <ul>', '      <li>',
    '        <pre><code></code></pre>', '      </li>', '    </ul>',
    '    <pre><code>\npayload\n</code></pre>', '  </li>', '</ul>',
    '<pre><code></code></pre>',
  ].join('\n'))
})

it('keeps a continuation marker literal in the later fence payload', () => {
  const source = ['- - +', '  ```', '  ```', '  ```', '', '  payload', '  +', '    later'].join('\n')
  expect(carveToHtml(source)).toBe([
    '<ul>', '  <li>', '    <ul>', '      <li>',
    '        <pre><code></code></pre>', '      </li>', '    </ul>',
    '    <pre><code>\npayload\n+\n  later</code></pre>',
    '  </li>', '</ul>',
  ].join('\n'))
})
