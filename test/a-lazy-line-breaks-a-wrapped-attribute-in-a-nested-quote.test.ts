import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

// A lazy line carries no `>`, so a later quoted `}` closes no attribute opened above it (pack case lazy-10bd0503f93b).
describe('a lazy line breaks a wrapped attribute in a nested quote', () => {
  it.each([
    ['> > {.k\ntail\n> > x}\ntail\n', '<blockquote>\n  <blockquote><p>{.k\ntail\nx}\ntail</p></blockquote>\n</blockquote>'],
    ['> > > {k\ntail\n> > > x}\nmore\n', '<blockquote>\n  <blockquote>\n    <blockquote><p>{k\ntail\nx}\nmore</p></blockquote>\n  </blockquote>\n</blockquote>'],
    ['- b\n  > > {.k\n  tail\n  > > x}\n  more\n', '<ul>\n  <li>b\n    <blockquote>\n      <blockquote><p>{.k\ntail\nx}\nmore</p></blockquote>\n    </blockquote>\n  </li>\n</ul>'],
    ['  - b\n    > q\n> > q\n> > {.k\ntail\n> > #x}\ntail\n  lazy\n', '<ul>\n  <li>b\n    <blockquote><p>q</p></blockquote>\n  </li>\n</ul>\n<blockquote>\n  <blockquote><p>q\n{.k\ntail\n<span class="tag"><strong>#x</strong></span>}\ntail\nlazy</p></blockquote>\n</blockquote>'],
    ['> > {.k\n> > x}\ntail\n', '<blockquote>\n  <blockquote>\n\n  </blockquote>\n</blockquote>\n<p>tail</p>'],
  ])('renders %j as the spec model', (source, html) => {
    expect(carveToHtml(source)).toBe(html)
  })
})
