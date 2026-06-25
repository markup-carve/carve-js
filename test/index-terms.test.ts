import { describe, expect, it } from 'vitest'

import { carveToHtml } from '../src/index.js'
import { index } from '../src/index-terms.js'

const h = (s: string) => carveToHtml(s, { extensions: [index()] }).trim()

describe('index terms', () => {
  it('emits an invisible anchor per :index marker', () => {
    const out = h('A :index[parser] here.\n\n::: index\n:::')
    expect(out).toContain('<span id="idx-parser-1" class="index-term"></span>')
    // invisible: no visible "parser" text leaks from the marker itself
    expect(out).toContain('<p>A <span id="idx-parser-1" class="index-term"></span> here.</p>')
  })

  it('collects markers into a sorted ::: index list with back-links', () => {
    const out = h('A :index[parser] and :index[lexer], then :index[parser].\n\n::: index\n:::')
    expect(out).toContain('<ul class="index">')
    // sorted: lexer before parser
    expect(out.indexOf('>lexer ')).toBeLessThan(out.indexOf('>parser '))
    expect(out).toContain(
      '<li>parser <a href="#idx-parser-1" class="index-backref">↩</a> ' +
        '<a href="#idx-parser-2" class="index-backref">↩</a></li>',
    )
    expect(out).toContain('<li>lexer <a href="#idx-lexer-1" class="index-backref">↩</a></li>')
  })

  it('numbers occurrences per slug in document order', () => {
    const out = h(':index[a] :index[a] :index[a].\n\n::: index\n:::')
    expect(out).toContain('id="idx-a-1"')
    expect(out).toContain('id="idx-a-2"')
    expect(out).toContain('id="idx-a-3"')
  })

  it('leaves ::: index a plain div when there are no markers', () => {
    const out = h('No terms.\n\n::: index\n:::')
    expect(out).toContain('<div class="index">')
    expect(out).not.toContain('<ul class="index">')
  })

  it('degrades to the generic fallback when the extension is off', () => {
    const out = carveToHtml('A :index[parser] here.').trim()
    expect(out).toContain('<span class="ext-index">parser</span>')
  })

  it('preserves authored content inside ::: index before the list', () => {
    const out = h('A :index[parser].\n\n::: index\nGenerated below.\n:::')
    expect(out).toContain('Generated below.')
    expect(out).toContain('<ul class="index">')
    expect(out.indexOf('Generated below.')).toBeLessThan(out.indexOf('<ul class="index">'))
  })

  it('preserves authored attributes on the <ul>', () => {
    const out = h('A :index[parser].\n\n{#book-index .two-col}\n::: index\n:::')
    expect(out).toContain('<ul id="book-index" class="index two-col">')
  })

  it('marker inside a link label does not nest an <a> (uses a span)', () => {
    const out = h('[see :index[parser]](/x).\n\n::: index\n:::')
    expect(out).toContain('<span id="idx-parser-1" class="index-term"></span>')
    expect(out).not.toContain('</a></a>')
  })

  it('indexes only body markers; a footnote-def marker is inert (no dangling)', () => {
    const out = h('Body :index[x].[^a]\n\n[^a]: Note :index[x].\n\n::: index\n:::')
    // body occurrence indexed once; no second id, no collision
    expect(out.match(/id="idx-x-/g)?.length).toBe(1)
    expect(out).toContain('id="idx-x-1"')
    expect(out).not.toContain('id="idx-x-2"')
    // the footnote marker is inert, and the index has no dangling back-link
    expect(out).toContain('<span class="index-term"></span>')
    expect(out).not.toContain('href="#idx-x-2"')
  })

  it('renders a ::: index nested inside a blockquote', () => {
    const out = h('A :index[parser].\n\n> ::: index\n> :::')
    expect(out).toContain('<ul class="index">')
    expect(out).toContain('<li>parser <a href="#idx-parser-1" class="index-backref">↩</a></li>')
  })
})
