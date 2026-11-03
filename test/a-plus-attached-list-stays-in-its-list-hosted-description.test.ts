import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

// A list a description's `+` attached is the description's, up to the next blank (§17 L3).
const tight = (html: string): string => html.replace(/>\s+</g, '><').trim()

it.each([
  ['- :: t\n  : a\n  +\n  - x\n',
    '<ul><li><dl><dt>t</dt><dd><p>a</p><ul><li>x</li></ul></dd></dl></li></ul>'],
  ['- :: t\n  : a\n  +\n  - x\n  - y\n',
    '<ul><li><dl><dt>t</dt><dd><p>a</p><ul><li>x</li><li>y</li></ul></dd></dl></li></ul>'],
  ['1. :: t\n   : a\n   +\n   1. x\n',
    '<ol><li><dl><dt>t</dt><dd><p>a</p><ol><li>x</li></ol></dd></dl></li></ol>'],
  ['> - :: t\n>   : a\n>   +\n>   - x\n',
    '<blockquote><ul><li><dl><dt>t</dt><dd><p>a</p><ul><li>x</li></ul></dd></dl></li></ul></blockquote>'],
  ['- :: t\n  : a\n  +\n  - x\n    - y\n  - z\n',
    '<ul><li><dl><dt>t</dt><dd><p>a</p><ul><li>x\n            <ul><li>y</li></ul></li><li>z</li></ul></dd></dl></li></ul>'],
  ['- :: t\n  : a\n  +\n  - x\n\n  - y\n',
    '<ul><li><dl><dt>t</dt><dd><p>a</p><ul><li>x</li></ul></dd></dl><ul><li>y</li></ul></li></ul>'],
  ['- [^n]: a\n  +\n  - x\n  - y\n\nsee[^n]\n',
    '<ul><li></li></ul><p>see<a id="fnref1" href="#fn1" role="doc-noteref"><sup>1</sup></a></p><section role="doc-endnotes" aria-label="Footnotes"><hr><ol><li id="fn1"><p>a</p><ul><li>x</li><li>y</li></ul><p><a href="#fnref1" role="doc-backlink" aria-label="Back to reference">↩</a></p></li></ol></section>'],
])('a plus-attached list stays in its list-hosted body: %j', (source, html) => {
  expect(tight(carveToHtml(source))).toBe(html)
})
