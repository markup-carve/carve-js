import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

it('keeps ordinary lazy text with an open footnote paragraph', () => {
  const html = carveToHtml('see[^n]\n\n[^n]: note\ntail\n')
  expect(html).not.toContain('<p>tail</p>')
  expect(html).toContain('<p>note\ntail<a href="#fnref1"')
})

it('ends a footnote paragraph at an interrupting block', () => {
  const html = carveToHtml('see[^n]\n\n[^n]: note\n# Heading\n')
  expect(html).toContain('<h1>Heading</h1>')
})

it('collects a below-column link definition after a note', () => {
  const html = carveToHtml('[^n]: note\n [r]: /u\n\nsee[^n] and [t][r]\n')
  expect(html).not.toContain('<p>[r]: /u</p>')
  expect(html).toContain('<a href="/u">t</a>')
})

it('keeps a refused plus as text in an open note paragraph', () => {
  const html = carveToHtml('[^n]: intro\n+\n more\n\nsee[^n]\n')
  expect(html).toContain('intro\n+\nmore')
})

it('folds a marker below the note body column into the note (corpus 454-4)', () => {
  const html = carveToHtml('- body\n\n  [^g]: n\n   - item\n\nafter\n')
  expect(html).not.toContain('<li>item</li>')
  expect(html).toContain('<li>body</li>')
})

it('keeps a list tight when a note after a blank keeps a prose follower', () => {
  const html = carveToHtml('- body\n\n  [^g]: n\n   prose\n\nafter\n')
  expect(html).toContain('<li>body</li>')
})

it('lets a description-hosted note keep a follower below its column', () => {
  const html = carveToHtml(':: t\n:  [^f]: note\n     - nested\n   tail\n')
  expect(html).not.toContain('<dd>tail</dd>')
  expect(html).toContain('<dd></dd>')
})

it('keeps a refused first-block list outside the note', () => {
  const html = carveToHtml('[^a]: +\n- a list\n\nsee[^a]\n')
  expect(html).toContain('<li>a list</li>')
  expect(html).not.toContain('+\n- a list')
})
