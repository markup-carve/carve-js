import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

const cases = [
  {
    name: 'item in a description',
    source: ':: t\n: - ::: |\n    {.k}\nb\n',
    html: '<dl>\n  <dt>t</dt>\n  <dd>\n    <ul>\n      <li>\n        <div class="line-block">\n          <p>{.k}<br>\nb</p>\n        </div>\n      </li>\n    </ul>\n  </dd>\n</dl>',
  },
  {
    name: 'quoted item in a description',
    source: ':: t\n: > - ::: |\n  >   {#i}\nb\n',
    html: '<dl>\n  <dt>t</dt>\n  <dd>\n    <blockquote>\n      <ul>\n        <li>\n          <div class="line-block">\n            <p>{<span class="tag"><strong>#i</strong></span>}<br>\nb</p>\n          </div>\n        </li>\n      </ul>\n    </blockquote>\n  </dd>\n</dl>',
  },
  {
    name: 'nested item in a description',
    source: ':: t\n: - - ::: |\n      [x]: /u\nb\n',
    html: '<dl>\n  <dt>t</dt>\n  <dd>\n    <ul>\n      <li>\n        <ul>\n          <li>\n            <div class="line-block">\n              <p>[x]: /u<br>\nb</p>\n            </div>\n          </li>\n        </ul>\n      </li>\n    </ul>\n  </dd>\n</dl>',
  },
  {
    name: 'nested description',
    source: ':: t\n: :: u\n  : ::: |\n    [^1]: n\nb\n',
    html: '<dl>\n  <dt>t</dt>\n  <dd>\n    <dl>\n      <dt>u</dt>\n      <dd>\n        <div class="line-block">\n          <p>[^1]: n<br>\nb</p>\n        </div>\n      </dd>\n    </dl>\n  </dd>\n</dl>',
  },
] as const

for (const { name, source, html } of cases) {
  it(`keeps a lazy line after literal payload in ${name}`, () => {
    expect(carveToHtml(source)).toBe(html)
  })
}
