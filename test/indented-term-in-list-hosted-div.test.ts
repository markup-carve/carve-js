import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

const expected = `<ul>
  <li>a
    <div class="box">
      <dl>
        <dt>sub</dt>
      </dl>
    </div>
  </li>
</ul>
<p>: def</p>`

describe('terms inside an unclosed list-hosted div', () => {
  it.each([
    '- a\n  ::: box\n   :: sub\n: def\n',
    '- a\n  ::: box\n    :: sub\n: def\n',
    '- a\n   ::: box\n     :: sub\n: def\n',
  ])('opens a term past the div opener and ends the host at the flush-left description', (source) => {
    expect(carveToHtml(source)).toBe(expected)
  })

  it('keeps a description at the term column inside the list', () => {
    expect(carveToHtml('- a\n  ::: box\n   :: sub\n   : def\n')).toContain('<dd>def</dd>')
  })
})
