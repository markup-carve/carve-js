import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

// Expected HTML from the reference checker at carve 911aa9c5.
const cases = [
  {
    name: 'heading',
    source: '- a\n  %%%\n   # heading\n',
    html: '<ul><li>a\n    <h1 id="heading">heading</h1></li></ul>',
  },
  {
    name: 'heading after a marker-line term',
    source: '- :: term\n  %%%\n   # heading\n',
    html: '<ul><li><dl><dt>term</dt></dl><h1 id="heading">heading</h1></li></ul>',
  },
  {
    name: 'quoted heading after a marker-line term',
    source: '> - :: term\n>   %%%\n>    # heading\n',
    html: '<blockquote><ul><li><dl><dt>term</dt></dl><h1 id="heading">heading</h1></li></ul></blockquote>',
  },
  {
    name: 'thematic break after a four-percent fence',
    source: '- a\n  %%%%\n   ---\n',
    html: '<ul><li>a\n    <hr></li></ul>',
  },
  {
    name: 'code fence',
    source: '- a\n  %%%\n   ```\n   code\n   ```\n',
    html: '<ul><li>a\n    <pre><code>code\n</code></pre></li></ul>',
  },
  {
    name: 'matched comment pair hides its payload',
    source: '- a\n  %%%\n   # heading\n  %%%\n',
    html: '<ul><li>a</li></ul>',
  },
]

const normalize = (html: string) => html.replace(/>\s+</g, '><').trim()

describe('an unmatched comment fence in an item leaves the next block open', () => {
  for (const { name, source, html } of cases) {
    it(name, () => {
      expect(normalize(carveToHtml(source))).toBe(normalize(html))
    })
  }
})
