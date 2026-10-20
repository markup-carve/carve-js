import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

it('keeps an indented plus as nested description text', () => {
  expect(carveToHtml('- :: t\n  : d\n  +\n  > q')).toBe('<ul>\n  <li>\n    <dl>\n      <dt>t</dt>\n      <dd>d\n+</dd>\n    </dl>\n    <blockquote><p>q</p></blockquote>\n  </li>\n</ul>')
})

it('still attaches a quote that begins at document column zero', () => {
  expect(carveToHtml(':: t\n: d\n+\n> q')).toContain('<dd>\n    <p>d</p>\n    <blockquote><p>q</p></blockquote>\n  </dd>')
  expect(carveToHtml('- :: t\n  : d\n+\n> q')).toContain('<blockquote><p>q</p></blockquote>')
})
