import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

it('counts a closer at the description body column for an over-indented opener', () => {
  expect(carveToHtml(':: t\n: a\n\t```\n  ```\n').trim()).toBe([
    '<dl>',
    '  <dt>t</dt>',
    '  <dd>',
    '    <p>a</p>',
    '    <pre><code></code></pre>',
    '  </dd>',
    '</dl>',
  ].join('\n'))
})

it('ends the description after a closer at its body column', () => {
  expect(carveToHtml(':: t\n: a\n    ```\n    x\n  ```\ntail\n').trim()).toBe([
    '<dl>',
    '  <dt>t</dt>',
    '  <dd>',
    '    <p>a</p>',
    '    <pre><code>x',
    '</code></pre>',
    '  </dd>',
    '</dl>',
    '<p>tail</p>',
  ].join('\n'))
})

it('keeps a shorter run as payload until a matching closer at the body column', () => {
  expect(carveToHtml(':: t\n: a\n      ````\n      x\n  ```\n  ````\n').trim()).toBe([
    '<dl>',
    '  <dt>t</dt>',
    '  <dd>',
    '    <p>a</p>',
    '    <pre><code>x',
    '```',
    '</code></pre>',
    '  </dd>',
    '</dl>',
  ].join('\n'))
})

it('does not use an outer description closer for a nested item fence', () => {
  expect(carveToHtml(':: t\n: - b\n    ```\n  ```\n').trim()).toBe([
    '<dl>',
    '  <dt>t</dt>',
    '  <dd>',
    '    <ul>',
    '      <li>b',
    '        <pre><code></code></pre>',
    '      </li>',
    '    </ul>',
    '    <pre><code></code></pre>',
    '  </dd>',
    '</dl>',
  ].join('\n'))
})
