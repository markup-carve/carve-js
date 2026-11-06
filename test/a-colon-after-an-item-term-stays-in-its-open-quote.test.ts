import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

it('folds a colon line after an item term into its open quote', () => {
  expect(carveToHtml('- a\n  :: t\n  > prose\n: z\n').trim()).toBe(`<ul>
  <li>a
    <dl>
      <dt>t</dt>
    </dl>
    <blockquote><p>prose
: z</p></blockquote>
  </li>
</ul>`)
})

it('ends the quote at a blank before the colon line', () => {
  expect(carveToHtml('- a\n  :: t\n  > prose\n\n: z\n').trim()).toBe(`<ul>
  <li>a
    <dl>
      <dt>t</dt>
    </dl>
    <blockquote><p>prose</p></blockquote>
  </li>
</ul>
<p>: z</p>`)
})

it('ends the quote after a heading before the colon line', () => {
  expect(carveToHtml('- a\n  :: t\n  > # heading\n: z\n').trim()).toBe(`<ul>
  <li>a
    <dl>
      <dt>t</dt>
    </dl>
    <blockquote>
      <h1 id="heading">heading</h1>
    </blockquote>
  </li>
</ul>
<p>: z</p>`)
})
