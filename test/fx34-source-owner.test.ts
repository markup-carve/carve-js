import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

it('keeps a nested quote plus as a paragraph when a missed-prefix line follows', () => {
  const html = carveToHtml('> > - > +\n> > - > +\n>  s\n')
  expect(html).toContain('<blockquote><p>+\ns</p></blockquote>')
})

it('opens an outer task term after the child term is released', () => {
  const html = carveToHtml('* [ ] - :: t\n      : a\n      :: sibling\n      tail\n')
  expect(html).toContain(': a\n    <dl>')
  expect(html).toMatch(/<dt>sibling\ntail<\/dt>/)
})

it('keeps a below-marker separator in the task child term', () => {
  const html = carveToHtml('* [ ] - :: t\n     : a\n     :: sibling\n     tail\n')
  expect(html.match(/<dt>/g)).toHaveLength(2)
  expect(html).toMatch(/<dt>t\n: a<\/dt>/)
})

it.each([[5, 6], [7, 6], [6, 7]])('lets a later term at the surviving task owner interrupt at columns %i/%i', (separator, later) => {
  const html = carveToHtml(`* [ ] - :: t\n${' '.repeat(separator)}: a\n${' '.repeat(later)}:: sibling\n${' '.repeat(later)}tail\n`)
  expect(html).toMatch(/<\/ul>\n\s+(?:: a\n\s+)?<dl>\n\s+<dt>sibling/)
})

it.each([[5, 6], [7, 7]])('lets a later heading at the surviving task owner interrupt at columns %i/%i', (separator, later) => {
  const html = carveToHtml(`* [ ] - :: t\n${' '.repeat(separator)}: a\n${' '.repeat(later)}# sibling\n${' '.repeat(later)}tail\n`)
  expect(html).toContain('<h1 id="sibling">sibling</h1>')
})

it('opens a past-column term in an unreleased nested term', () => {
  const html = carveToHtml('1. * :: t\n  : a\n      :: sibling\n      tail\n')
  expect(html.match(/<dt>/g)).toHaveLength(2)
  expect(html).toContain('<dt>sibling\ntail</dt>')
})

it('folds an item-column marker into a preceding footnote', () => {
  const html = carveToHtml('- outer\n  - see[^n]\n    [^n]: a\n    - li\nx\n')
  expect(html).toContain('<p>a\n- li\nx<a ')
})

it('folds a quoted item-column marker into a preceding footnote', () => {
  const html = carveToHtml('> - outer\n>   - see[^n]\n>     [^n]: a\n>     - li\nx\n')
  expect(html).toContain('<p>a\n- li\nx<a ')
})

it('restores a sibling item paragraph claim after a footnote', () => {
  const html = carveToHtml('- outer\n  - see[^n]\n    [^n]: a\n  - li\nx\n')
  expect(html).toContain('<li>li\nx</li>')
})
