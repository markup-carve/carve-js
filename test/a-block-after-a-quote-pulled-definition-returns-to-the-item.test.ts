import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

it('opens a second quote after a blank ends a quote-pulled definition list', () => {
  const source = '- a\n  > +\n  :: t\n  : u\n\n    > r\n'
  expect(carveToHtml(source)).toBe(`<ul>
  <li><p>a</p>
    <blockquote>
      <dl>
        <dt>t</dt>
        <dd>u</dd>
      </dl>
    </blockquote>
    <blockquote><p>r</p></blockquote>
  </li>
</ul>`)
})

it('keeps an ordinary definition body as the owner of its later quote', () => {
  const source = '- a\n  :: t\n  : u\n\n    > r\n'
  expect(carveToHtml(source)).toContain('<dd>\n        <p>u</p>\n        <blockquote><p>r</p></blockquote>\n      </dd>')
})

it('does not treat a later definition as pulled by an earlier quote', () => {
  const source = '- a\n  > +\n  p\n  :: t\n  : u\n\n    > r\n'
  expect(carveToHtml(source)).toContain('<dd>\n        <p>u</p>\n        <blockquote><p>r</p></blockquote>\n      </dd>')
})

it('keeps a pulled description through its continuation text', () => {
  const source = '- a\n  > +\n  :: t\n  : u\n  more\n\n    > r\n'
  expect(carveToHtml(source)).toContain('<dd>u\nmore</dd>\n      </dl>\n    </blockquote>\n    <blockquote><p>r</p></blockquote>')
})

it('does not attach a later definition after colon paragraph text', () => {
  const source = '- a\n  > +\n  : u\n  : v\n  :: t\n  : u\n\n    > r\n'
  expect(carveToHtml(source)).toContain('<dd>\n        <p>u</p>\n        <blockquote><p>r</p></blockquote>\n      </dd>')
})
