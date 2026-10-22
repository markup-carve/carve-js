import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

const normalized = (html: string): string => html.trim().split('\n').map(line => line.trim()).filter(Boolean).join('\n')

it('keeps an unmarked table row and tail in a quote-led item', () => {
  expect(normalized(carveToHtml('- > para\n    more\n    | a |\ntail\n'))).toBe(normalized(
    '<ul>\n<li>\n<blockquote><p>para\nmore\n| a |\ntail</p></blockquote>\n</li>\n</ul>',
  ))
})

it('ends a description note before an authored heading and document tail', () => {
  expect(normalized(carveToHtml('[^c]\n\n:: t\n: [^c]: para\n   # H\ntail\n'))).toBe(normalized(
    '<p><a id="fnref1" href="#fn1" role="doc-noteref"><sup>1</sup></a></p>\n<dl>\n<dt>t</dt>\n<dd>\n<h1 id="H">H</h1>\n</dd>\n</dl>\n<p>tail</p>\n<section role="doc-endnotes" aria-label="Footnotes">\n<hr>\n<ol>\n<li id="fn1">\n<p>para<a href="#fnref1" role="doc-backlink" aria-label="Back to reference">↩</a></p>\n</li>\n</ol>\n</section>',
  ))
})
