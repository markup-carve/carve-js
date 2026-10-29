import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

// A quoted note's open paragraph takes both lines lazily (carve#3885).
it('folds the lines below a quoted note into the note', () => {
  expect(carveToHtml('* k\n  > [^n]: note\n  q\n  - m\n\nr[^n]\n')).toContain('<p>note\nq\n- m<a href="#fnref1"')
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
  expect(html).toContain('    </blockquote>\n    q\n    <ul>')
  expect(html).toContain('      <li>m</li>')
  expect(html).not.toContain('q\n- m')
})
