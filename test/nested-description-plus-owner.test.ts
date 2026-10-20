import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

it('attaches a quote at the nested description marker column', () => {
  expect(carveToHtml('- :: t\n  : d\n  +\n  > q')).toBe('<ul>\n  <li>\n    <dl>\n      <dt>t</dt>\n      <dd>\n        <p>d</p>\n        <blockquote><p>q</p></blockquote>\n      </dd>\n    </dl>\n  </li>\n</ul>')
})

it('still attaches a quote that begins at document column zero', () => {
  expect(carveToHtml(':: t\n: d\n+\n> q')).toContain('<dd>\n    <p>d</p>\n    <blockquote><p>q</p></blockquote>\n  </dd>')
  expect(carveToHtml('- :: t\n  : d\n+\n> q')).toContain('<blockquote><p>q</p></blockquote>')
})
