import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

it('keeps a later outer fence open through its blank and payload', () => {
  const source = ['- - +', '  ```', '  ```', '  ```', '', '  payload', '  ```', '- sibling'].join('\n')
  expect(carveToHtml(source)).toBe([
    '<ul>', '  <li>', '    <ul>', '      <li>',
    '        <pre><code></code></pre>', '      </li>', '    </ul>',
    '    <pre><code>\npayload\n</code></pre>', '  </li>',
    '  <li>sibling</li>', '</ul>',
  ].join('\n'))
})

it('leaves a flush-left fence outside a task item quote', () => {
  const source = ['- [ ] > +', '      ```', '      k', '```'].join('\n')
  expect(carveToHtml(source)).toBe([
    '<ul class="task-list">', '  <li><input type="checkbox" disabled> ',
    '    <blockquote>', '      <pre><code>k\n</code></pre>',
    '    </blockquote>', '  </li>', '</ul>', '<pre><code></code></pre>',
  ].join('\n'))
})
