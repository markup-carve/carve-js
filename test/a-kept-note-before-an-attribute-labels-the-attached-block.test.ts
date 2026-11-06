import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

it('floats an attribute past a kept note to a list attachment', () => {
  expect(carveToHtml('- a\n+\n  [^n]: x\n  {x}\n```\n\n```\n').trim()).toBe(`<ul>
  <li>a
    <pre x=""><code>
</code></pre>
  </li>
</ul>`)
})

it('keeps the attachment after an unreferenced note inside its note host', () => {
  expect(carveToHtml('[^m]: +\n  [^n]: x\n  {x}\n```\n\n```\n').trim()).toBe('')
})

it('floats the attribute through a kept note in a description', () => {
  expect(carveToHtml(':: t\n: +\n  [^n]: x\n  {x}\n```\n\n```\n').trim()).toBe(`<dl>
  <dt>t</dt>
  <dd>
    <pre x=""><code>
</code></pre>
  </dd>
</dl>`)
})
