import { describe, expect, it } from 'vitest'

import { carveToHtml } from '../src/index.js'
import { headingNumbers } from '../src/heading-numbers.js'

const h = (s: string, o = {}) => carveToHtml(s, { extensions: [headingNumbers(o)] }).trim()

describe('heading numbers: numbering', () => {
  it('numbers headings with a dotted per-level counter', () => {
    const out = h('# A\n\n## B\n\n## C\n\n### D')
    expect(out).toContain('<span class="section-number">1</span> A')
    expect(out).toContain('<span class="section-number">1.1</span> B')
    expect(out).toContain('<span class="section-number">1.2</span> C')
    expect(out).toContain('<span class="section-number">1.2.1</span> D')
  })

  it('minLevel starts numbering deeper (h1 is the doc title)', () => {
    const out = h('# Title\n\n## First\n\n### Sub\n\n## Second', { minLevel: 2 })
    expect(out).toContain('<h1>Title</h1>') // not numbered
    expect(out).toContain('<span class="section-number">1</span> First')
    expect(out).toContain('<span class="section-number">1.1</span> Sub')
    expect(out).toContain('<span class="section-number">2</span> Second')
  })

  it('resets deeper counters when a shallower heading appears', () => {
    const out = h('# A\n\n## A1\n\n# B\n\n## B1')
    expect(out).toContain('<span class="section-number">1.1</span> A1')
    expect(out).toContain('<span class="section-number">2</span> B')
    expect(out).toContain('<span class="section-number">2.1</span> B1')
  })

  it('numbers gap-free across skipped levels (no zero segments)', () => {
    const out = h('# A\n\n### C')
    expect(out).toContain('<span class="section-number">1</span> A')
    expect(out).toContain('<span class="section-number">1.1</span> C')
    expect(out).not.toContain('1.0')
  })

  it('first heading wins a duplicate id even when it is skipped', () => {
    const out = h('{#dup .unnumbered}\n# First\n\n{#dup}\n# Second\n\nSee </#dup>.')
    // </#dup> targets the first (unnumbered) heading; no number is asserted
    expect(out).not.toContain('Section 2 - Second')
    expect(out).not.toContain('Section 1 - Second')
  })

  it('skips a {.unnumbered} heading and does not advance the counter', () => {
    const out = h('# A\n\n{.unnumbered}\n# Preface\n\n# B')
    expect(out).toContain('<span class="section-number">1</span> A')
    expect(out).not.toMatch(/section-number">\d<\/span> Preface/)
    expect(out).toContain('<span class="section-number">2</span> B')
  })

  it('does not crash on a document containing a figure', () => {
    const out = h('# A\n\n![alt](/img.png)\n^ A caption.\n\n## B')
    expect(out).toContain('<span class="section-number">1</span> A')
    expect(out).toContain('<span class="section-number">1.1</span> B')
  })

  it('does not number headings inside a blockquote', () => {
    const out = h('# A\n\n> # Quoted')
    expect(out).toContain('<span class="section-number">1</span> A')
    expect(out).not.toContain('section-number">1.1')
    expect(out).not.toMatch(/section-number"[^>]*>[^<]*<\/span> Quoted/)
  })
})

describe('heading numbers: cross-references', () => {
  const doc = '# Parsing\n\nSee </#Parsing>.'

  it('rewrites an auto-filled crossref to "Section N - Title" by default', () => {
    expect(h(doc)).toContain('<a href="#Parsing">Section 1 - Parsing</a>')
  })

  it('crossref: "number" emits just the number', () => {
    expect(h(doc, { crossref: 'number' })).toContain('<a href="#Parsing">Section 1</a>')
  })

  it('crossref: "title" leaves references untouched (numbering only on headings)', () => {
    const out = h(doc, { crossref: 'title' })
    expect(out).toContain('<a href="#Parsing">Parsing</a>')
    expect(out).toContain('<span class="section-number">1</span> Parsing')
  })

  it('label is configurable', () => {
    expect(h(doc, { label: '§' })).toContain('<a href="#Parsing">§ 1 - Parsing</a>')
  })

  it('leaves an explicit-text link unchanged', () => {
    const out = h('# Parsing\n\n[my words](#Parsing).')
    expect(out).toContain('<a href="#Parsing">my words</a>')
  })

  it('leaves an explicit link whose text equals the title unchanged', () => {
    const out = h('# Parsing\n\n[Parsing](#Parsing).')
    expect(out).toContain('<a href="#Parsing">Parsing</a>')
    expect(out).not.toContain('Section 1 - Parsing')
  })

  it('leaves an implicit heading reference [label][] unchanged', () => {
    const out = h('# Parsing\n\nSee [Parsing][].')
    expect(out).toContain('>Parsing</a>')
    expect(out).not.toContain('Section 1 - Parsing')
  })

  it('uses the first heading for a duplicate explicit id (matches the resolver)', () => {
    const out = h('{#dup}\n# First\n\n{#dup}\n# Second\n\nSee </#dup>.')
    expect(out).toContain('Section 1 - First')
    expect(out).not.toContain('Section 2 - Second')
  })

  it('does not rewrite a link to an unnumbered heading', () => {
    const out = h('{.unnumbered}\n# Notes\n\n[Notes](#Notes).')
    expect(out).toContain('<a href="#Notes">Notes</a>')
  })
})

describe('heading numbers: idempotency', () => {
  it('does not stack spans when beforeRender runs twice on one document', () => {
    const ext = headingNumbers()
    const doc = { type: 'document', children: [{ type: 'heading', level: 1, children: [{ type: 'text', value: 'A' }], attrs: { id: 'A' } }] } as never
    ext.beforeRender!(doc)
    ext.beforeRender!(doc)
    const spans = JSON.stringify(doc).match(/section-number/g) ?? []
    expect(spans.length).toBe(1)
  })
})

describe('heading numbers: degradation', () => {
  it('without the extension, headings and crossrefs are unchanged', () => {
    const out = carveToHtml('# Parsing\n\nSee </#Parsing>.').trim()
    expect(out).not.toContain('section-number')
    expect(out).toContain('<a href="#Parsing">Parsing</a>')
  })
})
