import { describe, expect, it } from 'vitest'
import { migrateMarkdown } from '../src/index.js'

// carve#6014: the construct assessment models a dropped destination as what the
// import writes, so an emptied paragraph is no block and a denied image is its
// plain alt text, and the report keeps the ruled rows instead of falling back.

const rows = (markdown: string) => migrateMarkdown(markdown).report.diagnostics
  .map((row) => [row.code, row.severity, row.fidelity, row.confidence, row.path])

describe('a dropped destination in the construct assessment', () => {
  it.each([
    ['an empty image', '![](data:x)\n'],
    ['an empty link', '[](javascript:x)\n'],
  ])('writes no paragraph for %s that is the whole paragraph', (_name, markdown) => {
    expect(rows(markdown)).toEqual([
      ['attribute-dropped', 'warning', 'dropped', 'exact', 'line:1'],
    ])
  })

  it('reports each drop of a paragraph emptied by two', () => {
    expect(rows('![](data:x) ![](data:x)\n')).toEqual([
      ['attribute-dropped', 'warning', 'dropped', 'exact', 'line:1'],
      ['attribute-dropped', 'warning', 'dropped', 'exact', 'line:1'],
    ])
  })

  it('keeps the blocks around an emptied paragraph', () => {
    expect(rows('a\n\n![](data:x)\n\nb\n')).toEqual([
      ['markdown-paragraph', 'info', 'preserved', 'exact', 'line:1'],
      ['attribute-dropped', 'warning', 'dropped', 'exact', 'line:3'],
      ['markdown-paragraph', 'info', 'preserved', 'exact', 'line:5'],
    ])
  })

  it('keeps a quote whose paragraph was emptied', () => {
    expect(rows('> ![](data:x)\n')).toEqual([
      ['markdown-block-quote', 'info', 'preserved', 'exact', 'line:1'],
      ['attribute-dropped', 'warning', 'dropped', 'exact', 'line:1'],
    ])
  })

  it.each([
    ['emphasis', 'x ![a *b*](data:x) y\n'],
    ['strong and code', 'x ![a `c` **b**](data:x) y\n'],
    ['an entity', 'x ![a &amp; b](data:x) y\n'],
    ['a literal underscore', 'x ![a_b](data:x) y\n'],
    ['a literal backtick', 'x ![a`b](data:x) y\n'],
    ['raw HTML', 'x ![<b>a</b>](data:x) y\n'],
  ])('models alt text with %s as its plain text', (_name, markdown) => {
    expect(rows(markdown)).toEqual([
      ['markdown-paragraph', 'info', 'preserved', 'exact', 'line:1'],
      ['attribute-dropped', 'warning', 'dropped', 'exact', 'line:1'],
    ])
  })

  it('models a reference image with formatted alt text as its plain text', () => {
    expect(rows('![*a*][r]\n\n[r]: data:x\n')).toEqual([
      ['markdown-paragraph', 'info', 'preserved', 'exact', 'line:1'],
      ['attribute-dropped', 'warning', 'dropped', 'exact', 'line:3'],
    ])
  })
})
