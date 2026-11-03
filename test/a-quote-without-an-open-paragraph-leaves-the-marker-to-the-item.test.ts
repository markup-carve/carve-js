import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

// A quoted note's open paragraph takes the prose lazily (carve#3885); the marker opens the item's list (carve#4860).
it('folds prose below a quoted note into the note and leaves the marker to the item', () => {
  const html = carveToHtml('* k\n  > [^n]: note\n  q\n  - m\n\nr[^n]\n')
  expect(html).toContain('<p>note\nq<a href="#fnref1"')
  expect(html).toContain('<li>m</li>')
})

it.each([
  '* k\n  > [n]: /u\n  q\n  - m\n',
  '* k\n\n\n  > [n]:\n\tq\n  - m\n',
  '* k\n  > {.x}\n  q\n  - m\n',
  '* k\n  > %% comment\n  q\n  - m\n',
  '* k\n  > # heading\n  q\n  - m\n',
  '* k\n  > | cell |\n  q\n  - m\n',
  '* k\n  > ```\n  > code\n  > ```\n  q\n  - m\n',
])('leaves a marker to the item after a quote with no open paragraph', (source) => {
  const html = carveToHtml(source)
  expect(html).toContain(source.includes('\n\n\n')
    ? '    </blockquote>\n    <p>q</p>\n    <ul>'
    : '    </blockquote>\n    q\n    <ul>')
  expect(html).toContain('      <li>m</li>')
  expect(html).not.toContain('q\n- m')
})
