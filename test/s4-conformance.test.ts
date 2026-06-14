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

describe('bare boolean id', () => {
  it('a bare `id` feeds the id slot (single, last-wins) — no duplicate id', () => {
    expect(carveToHtml('[x]{id id=j}').trim()).toBe('<p><span id="j">x</span></p>')
    expect(carveToHtml('[x]{id=j id}').trim()).toBe('<p><span id="">x</span></p>')
    expect(carveToHtml('[x]{id}').trim()).toBe('<p><span id="">x</span></p>')
    // other boolean attributes are unaffected
    expect(carveToHtml('[x]{disabled}').trim()).toBe('<p><span disabled="">x</span></p>')
  })
})

describe('glued cell attributes', () => {
  const td = (s: string) => carveToHtml(s).split('\n')[1]
  it('a {…} glued to the opening pipe is the cell attribute block', () => {
    expect(td('|{.x} hi | b |\n|---|---|\n| c | d |'))
      .toBe('  <thead><tr><th class="x">hi</th><th>b</th></tr></thead>')
    // multiple attrs, source order
    expect(td('|{#id .a key=v} hi | b |\n|---|---|\n| c | d |'))
      .toBe('  <thead><tr><th id="id" class="a" key="v">hi</th><th>b</th></tr></thead>')
  })
  it('a SPACE before the brace is ordinary content, not attributes', () => {
    expect(td('| {.x} hi | b |\n|---|---|\n| c | d |'))
      .toBe('  <thead><tr><th>{.x} hi</th><th>b</th></tr></thead>')
  })
  it('computed span wins over an author-supplied rowspan (no duplicate attr)', () => {
    const html = carveToHtml('|{rowspan=9} a | b |\n|---|---|\n| ^ | d |')
    expect(html).toContain('<th rowspan="2">a</th>')
    expect(html).not.toContain('rowspan="9"')
  })
  it('strips a structural author key case-insensitively', () => {
    const html = carveToHtml('|{ROWSPAN=9} a | b |\n|---|---|\n| ^ | d |')
    expect(html).toContain('<th rowspan="2">a</th>')
    expect(html.toLowerCase()).not.toContain('rowspan="9"')
  })
  it('keeps an author style when no alignment is computed', () => {
    expect(td('|{style="color:red"} a | b |\n|---|---|\n| c | d |'))
      .toBe('  <thead><tr><th style="color:red">a</th><th>b</th></tr></thead>')
  })
  it('an attributed dash row is not a GFM header delimiter', () => {
    const html = carveToHtml('| h | i |\n|{.x} --- | --- |\n| c | d |')
    expect(html).not.toContain('<thead>')
    expect(html).toContain('class="x"')
  })
  it('handles a quoted brace in a cell attribute value', () => {
    expect(td('|{key="{y}"} hi | b |\n|---|---|\n| c | d |'))
      .toBe('  <thead><tr><th key="{y}">hi</th><th>b</th></tr></thead>')
  })
  it('a partially-invalid attribute payload stays literal', () => {
    expect(td('|{.x 1bad} hi | b |\n|---|---|\n| c | d |'))
      .toBe('  <thead><tr><th>{.x 1bad} hi</th><th>b</th></tr></thead>')
  })
  it('an attributed cell is not a bare span marker (content stays literal)', () => {
    expect(td('|{.x} < | b |\n|---|---|\n| c | d |'))
      .toBe('  <thead><tr><th class="x">&lt;</th><th>b</th></tr></thead>')
  })
})
