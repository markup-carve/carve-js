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
  expect(html).toBe("<p>more</p>\n<p>see<a id=\"fnref1\" href=\"#fn1\" role=\"doc-noteref\"><sup>1</sup></a></p>\n<section role=\"doc-endnotes\" aria-label=\"Footnotes\">\n  <hr>\n  <ol>\n    <li id=\"fn1\">\n      <p>intro<a href=\"#fnref1\" role=\"doc-backlink\" aria-label=\"Back to reference\">↩</a></p>\n    </li>\n  </ol>\n</section>")
})

// A marker below the note body column closes the note and opens the item's list (PART 0 S3, carve#4860).
it('closes the note at a marker below its body column (corpus 454-4)', () => {
  const html = carveToHtml('- body\n\n  [^g]: n\n   - item\n\nafter\n')
  expect(html).toContain('<li><p>body</p>\n    <ul>\n      <li>item</li>')
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
