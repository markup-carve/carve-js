import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

// A term at the open description's body column nests in that body, so a block below its list stays in the outer `dd` (#3922).
describe('a nested term in an item-hosted description is not a sibling entry', () => {
  const wrap = (after: string): string =>
    '<ul>\n  <li>a\n    <dl>\n      <dt>outer</dt>\n      <dd>\n        <p>detail</p>\n        <dl>\n          <dt>inner</dt>\n          <dd>tail</dd>\n        </dl>\n' +
    `        ${after}\n      </dd>\n    </dl>\n  </li>\n</ul>`

  it.each([
    ['- a\n  :: outer\n  :  detail\n       :: inner\n      :  tail\n      # H\n', wrap('<h1 id="H">H</h1>')],
    ['- a\n  :: outer\n  :  detail\n     :: inner\n     :  tail\n     ```\n     c\n     ```\n', wrap('<pre><code>c\n</code></pre>')],
    ['- a\n  :: outer\n  :  detail\n       :: inner\n      :  tail\n      > q\n', wrap('<blockquote><p>q</p></blockquote>')],
  ])('renders %j as the spec model', (source, html) => {
    expect(carveToHtml(source)).toBe(html)
  })
})
