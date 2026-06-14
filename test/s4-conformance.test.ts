import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'

// Cross-impl conformance fixes (S4): each case is a single-impl outlier where
// js diverged from carve-php / carve-rs; the fix brings js to the shared,
// grammar-aligned behavior.
describe('S4 cross-impl conformance', () => {
  it('id=value reuses the id slot, last-wins (§15) — no duplicate id attribute', () => {
    // Was `<span id="i" id="j">` (invalid HTML); php emits a single last-wins id.
    expect(carveToHtml('[x]{#i id=j}').trim()).toBe('<p><span id="j">x</span></p>')
  })

  it('renders an explicit empty id and lets id="" win over #id (last-wins §15)', () => {
    expect(carveToHtml('[x]{id=""}').trim()).toBe('<p><span id="">x</span></p>')
    expect(carveToHtml('[x]{#old id=""}').trim()).toBe('<p><span id="">x</span></p>')
    // last-wins also across CHAINED attribute blocks (mergeAttrs).
    expect(carveToHtml('[x]{#old}{id=""}').trim()).toBe('<p><span id="">x</span></p>')
  })

  it('only strips a BOM at the document start, not in nested content', () => {
    expect(carveToHtml('> ﻿# T').trim())
      .toBe('<blockquote><p>﻿# T</p></blockquote>')
  })

  it('escapes a quoted id= value (no attribute injection)', () => {
    expect(carveToHtml('[x]{id="a\\" onclick=\\"alert(1)"}').trim())
      .toBe('<p><span id="a&quot; onclick=&quot;alert(1)">x</span></p>')
  })

  it('an attribute block after a space does not attach to an autolink', () => {
    // The `{...}` must be glued; a separating space makes it literal text.
    expect(carveToHtml('<https://e.com> {.x}').trim())
      .toBe('<p><a href="https://e.com">https://e.com</a> {.x}</p>')
  })

  it('parses a CriticMarkup span nesting a different-type span', () => {
    // `{-b-}`'s `}` must not abort the outer `{+ … +}` match.
    expect(carveToHtml('{+a {-b-} c+}').trim())
      .toBe('<p><ins>a <del>b</del> c</ins></p>')
  })

  it('a comment block inside a list item leaves no stray whitespace', () => {
    const src = '- a\n\n  %%%\n  hidden\n  %%%\n\n- b'
    expect(carveToHtml(src).trim())
      .toBe('<ul>\n  <li><p>a</p></li>\n  <li><p>b</p></li>\n</ul>')
  })

  it('strips a leading UTF-8 BOM so the first line still parses', () => {
    expect(carveToHtml('﻿# T').trim())
      .toBe('<section id="t">\n  <h1>T</h1>\n</section>')
  })
})

describe('S4 decided fixes', () => {
  it('an explicit empty id on a heading wins over the auto-slug', () => {
    expect(carveToHtml('{id=""}\n# T').trim())
      .toBe('<section id="">\n  <h1>T</h1>\n</section>')
    // a heading without an explicit id still auto-slugs.
    expect(carveToHtml('# T').trim())
      .toBe('<section id="t">\n  <h1>T</h1>\n</section>')
  })

  it('replaces a NUL byte with the U+FFFD replacement character', () => {
    expect(carveToHtml('a\0b').trim()).toBe('<p>a�b</p>')
  })
})
