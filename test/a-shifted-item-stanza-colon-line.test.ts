import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

it('removes item indentation from a lazy colon line in a stanza', () => {
  expect(carveToHtml('  - a\n    :: t\n    ::: |\n      x\n   : z\n').trim()).toBe(`<ul>
  <li>a
    <dl>
      <dt>t</dt>
    </dl>
    <div class="line-block">
      <p>&nbsp;&nbsp;x<br>
: z</p>
    </div>
  </li>
</ul>`)
})
