import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

it('keeps a nested quote plus as a paragraph when a missed-prefix line follows', () => {
  const html = carveToHtml('> > - > +\n> > - > +\n>  s\n')
  expect(html).toContain('<blockquote><p>+\ns</p></blockquote>')
})

it('opens an outer task term after the child term is released', () => {
  const html = carveToHtml('* [ ] - :: t\n      : a\n      :: sibling\n      tail\n')
  expect(html).toContain(': a\n    <dl>')
  expect(html).toMatch(/<dt>sibling\n\s+tail<\/dt>/)
})

it('keeps a below-marker separator in the task child term', () => {
  const html = carveToHtml('* [ ] - :: t\n     : a\n     :: sibling\n     tail\n')
  expect(html.match(/<dt>/g)).toHaveLength(1)
  expect(html).toMatch(/<dt>t\n: a\n:: sibling\ntail<\/dt>/)
})

it.each([[5, 6], [7, 6], [6, 7]])('lets a later term at the surviving task owner interrupt at columns %i/%i', (separator, later) => {
  const html = carveToHtml(`* [ ] - :: t\n${' '.repeat(separator)}: a\n${' '.repeat(later)}:: sibling\n${' '.repeat(later)}tail\n`)
  expect(html).toMatch(/<\/ul>\n\s+(?:: a\n\s+)?<dl>\n\s+<dt>sibling/)
})

it.each([[5, 6], [7, 7]])('lets a later heading at the surviving task owner interrupt at columns %i/%i', (separator, later) => {
  const html = carveToHtml(`* [ ] - :: t\n${' '.repeat(separator)}: a\n${' '.repeat(later)}# sibling\n${' '.repeat(later)}tail\n`)
  expect(html).toContain('<h1 id="sibling">sibling</h1>')
})

it('keeps past-column openers as text in an unreleased nested term', () => {
  const html = carveToHtml('1. * :: t\n  : a\n      :: sibling\n      tail\n')
  expect(html.match(/<dt>/g)).toHaveLength(1)
  expect(html).toContain(':: sibling\n tail</dt>')
})

it('lets an item-column marker leave a preceding footnote', () => {
  const html = carveToHtml('- outer\n  - see[^n]\n    [^n]: a\n    - li\nx\n')
  expect(html).toContain('<li>li\nx</li>')
  expect(html).toMatch(/<p>a<a href="#fnref1"/)
})

it('lets a quoted item-column marker leave a preceding footnote', () => {
  const html = carveToHtml('> - outer\n>   - see[^n]\n>     [^n]: a\n>     - li\nx\n')
  expect(html).toContain('<li>li\nx</li>')
})

it('restores a sibling item paragraph claim after a footnote', () => {
  const html = carveToHtml('- outer\n  - see[^n]\n    [^n]: a\n  - li\nx\n')
  expect(html).toContain('<li>li\nx</li>')
})
