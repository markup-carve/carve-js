import { expect, it } from 'vitest'
import { carveToHtml, decisionTrace } from '../src/index.js'

it('traces a marker-column colon line as lazy after its description closes', () => {
  const source = '- a\n  :: t\n  : u\n\n  p\n: c\n'
  expect(carveToHtml(source)).toBe(`<ul>
  <li><p>a</p>
    <dl>
      <dt>t</dt>
      <dd>u</dd>
    </dl>
    <p>p
: c</p>
  </li>
</ul>`)
  expect(decisionTrace(source).find((record) => record.line === 6)).toEqual({
    line: 6, step: 'S4', owner: 'doc/item:1', rule: 'CARVE-P0-006', form: 'lazy', reached: 'doc',
  })
})
