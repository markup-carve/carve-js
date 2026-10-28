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

it('keeps a below-column link definition as note paragraph text', () => {
  const html = carveToHtml('[^n]: note\n [r]: /u\n\nsee[^n] and [t][r]\n')
  expect(html).not.toContain('<p>[r]: /u</p>')
  expect(html).toContain('note\n[r]: /u')
})

it('keeps a refused plus as text in an open note paragraph', () => {
  const html = carveToHtml('[^n]: intro\n+\n more\n\nsee[^n]\n')
  expect(html).toContain('intro\n+\nmore')
})

it('lets a nested note take a marker below its own body column', () => {
  const html = carveToHtml('- body\n\n  [^g]: n\n   - item\n\nafter\n')
  expect(html).not.toContain('<li>item</li>')
  expect(html).toContain('<li>body</li>')
})

it('loosens a list when a note after a blank keeps a prose follower', () => {
  const html = carveToHtml('- body\n\n  [^g]: n\n   prose\n\nafter\n')
  expect(html).toContain('<li><p>body</p></li>')
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
