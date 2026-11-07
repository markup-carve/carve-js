import { expect, it } from 'vitest'
import { carveToHtml, parse } from '../src/index.js'

it('returns a marker-column description line to the enclosing item', () => {
  const source = '- Q\n  - Q\n    - a\n      :: t\n      : d\n    : z\n'
  const expected = `<ul>
  <li>Q
    <ul>
      <li>Q
        <ul>
          <li>a
            <dl>
              <dt>t</dt>
              <dd>d</dd>
            </dl>
          </li>
        </ul>
        : z
      </li>
    </ul>
  </li>
</ul>`
  for (const positions of [false, true]) {
    expect(parse(source, { positions }).children[0]).toMatchObject({ type: 'list' })
    expect(carveToHtml(source, { positions })).toBe(expected)
  }
})
