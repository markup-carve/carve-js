import { describe, expect, it } from 'vitest'
import {
  carveToAstJson,
  carveToCarve,
  htmlToCarve,
  parse,
  renderCarve,
  SourceUnspellableError,
  type Document,
} from '../src/index.js'

// An empty code span is an open backtick run, which ends only at the end of a
// block or at a braced closer. Anywhere else the writer refuses the tree and the
// HTML importer drops the span (carve-js#1789, markup-carve/carve-php#2055).

// No Carve source builds these trees, so each empties a `Q` placeholder span.
const emptied = (template: string): Document => {
  const doc = parse(template)
  let found = 0
  const walk = (node: unknown): void => {
    if (node === null || typeof node !== 'object') return
    const typed = node as { type?: string; value?: string }
    if (typed.type === 'code' && typed.value === 'Q') {
      typed.value = ''
      found++
    }
    for (const value of Object.values(node)) walk(value)
  }
  walk(doc)
  expect(found).toBe(1)
  return doc
}

const tree = (value: unknown) =>
  JSON.stringify(value, (key, v) => (['pos', 'srcByteLength', 'footnoteDefPos'].includes(key) ? undefined : v))

describe('the writer and an empty code span', () => {
  it.each([
    ['text after it in a strike', '~`Q` y~\n'],
    ['text after it in a paragraph', 'x`Q`y\n'],
    ['attributes at the end of a strike', '~x `Q`{.c}~\n'],
    ['attributes at the end of a paragraph', 'x `Q`{.c}\n'],
    ['a soft break after it', 'x `Q`\ny\n'],
    ['the end of a link label', '[x `Q`](u)\n'],
    ['a braced closer inside a link label', '[{~x `Q`~}](u)\n'],
    ['the end of a middle table cell', '| a | x `Q` | c |\n'],
    ['a braced closer inside a middle table cell', '| a | {~x `Q`~} | c |\n'],
  ])('refuses %s', (_, template) => {
    const doc = emptied(template)
    expect(() => renderCarve(doc)).toThrow(SourceUnspellableError)
  })

  it.each([
    ['the end of a paragraph', 'x `Q`\n'],
    ['the end of a strike', '~x `Q`~\n'],
    ['a strike with text after it', '{~x `Q`~}y\n'],
    ['the end of a superscript', '{^x `Q`^}\n'],
    ['the end of an insertion', '{+x `Q`+}\n'],
    ['a braced strike inside a strong', '*~x `Q`~ y*\n'],
    ['the end of the last table cell', '| a | x `Q` |\n'],
    ['a braced strike with text after it in the last table cell', '| a | {~x `Q`~}y |\n'],
    ['the end of a heading', '# x `Q`\n'],
  ])('writes %s as a source that reads back as the tree', (_, template) => {
    const doc = emptied(template)
    expect(tree(parse(renderCarve(doc)))).toBe(tree(doc))
  })

  // The parser never builds a refused tree, so `carve fmt` cannot throw.
  const sources = [
    ['text after it in a strike', '~`` y~\n'],
    ['text after it in a paragraph', 'x``y\n'],
    ['attributes after it', 'x ``{.c}\n'],
    ['a soft break after it', 'x ``\ny\n'],
    ['a link label', '[x ``](u)\n'],
    ['a braced closer inside a link label', '[{~x ``~}](u)\n'],
    ['a middle table cell', '| a | x `` | c |\n'],
    ['a braced strike', '{~x ``~}y\n'],
    ['the end of a paragraph', 'x ``\n'],
    ['the end of the last table cell', '| a | x `` |\n'],
  ]

  it.each(sources)('formats %s keeping its tree', (_, source) => {
    expect(tree(carveToAstJson(carveToCarve(source)))).toBe(tree(carveToAstJson(source)))
  })

  it.each(sources)('formats %s idempotently', (_, source) => {
    const formatted = carveToCarve(source)
    expect(carveToCarve(formatted)).toBe(formatted)
  })
})

describe('the HTML importer and an empty code span', () => {
  const codes = (html: string) => htmlToCarve(html).report.diagnostics.map((d) => d.code)

  const written = [
    ['<p><s><code></code></s></p>', '{~``~}\n'],
    ['<p><em><code></code></em></p>', '{/``/}\n'],
    ['<p><sup><code></code></sup></p>', '{^``^}\n'],
    ['<p><s><em><code></code></em></s></p>', '~{/``/}~\n'],
    ['<p><s>x<code></code></s></p>', '{~x``~}\n'],
    ['<p>x<code></code></p>', 'x``\n'],
    ['<h1><code></code></h1>', '# ``\n'],
    ['<ul><li><code></code></li></ul>', '- ``\n'],
    ['<p><s><code></code></s>y</p>', '{~``~}y\n'],
    ['<table><tr><td>a</td><td>x<code></code></td></tr></table>', '| a | x`` |\n'],
  ]

  it.each(written)('writes %s', (html, carve) => {
    expect(htmlToCarve(html).value).toBe(carve)
  })

  it.each(written)('does not report %s as lost', (html) => {
    expect(codes(html)).not.toContain('structure-unspellable')
  })

  const dropped = [
    ['<p><s><code></code>y</s></p>', '~y~\n'],
    ['<p>x<code></code>y</p>', 'xy\n'],
    ['<p><s><code></code><b>y</b></s></p>', '~*y*~\n'],
    ['<p><a href="u">z<code></code></a></p>', '[z](u)\n'],
    ['<p><cite>z<code></code></cite></p>', '[z]{cite}\n'],
    ['<h1>x<code></code>y</h1>', '# xy\n'],
    ['<p><span class="k"><code></code></span></p>', '[]{.k}\n'],
    ['<table><tr><td>x<code></code></td><td>c</td></tr></table>', '| x | c |\n'],
  ]

  it.each(dropped)('drops the span from %s', (html, carve) => {
    expect(htmlToCarve(html).value).toBe(carve)
  })

  it.each(dropped)('reports the span dropped from %s', (html) => {
    expect(codes(html)).toContain('structure-unspellable')
  })

  it('writes only the last of two empty spans', () => {
    expect(htmlToCarve('<p><s><code></code><code></code></s></p>').value).toBe('{~``~}\n')
    expect(codes('<p><s><code></code><code></code></s></p>')).toEqual(['structure-unspellable'])
  })

  it('drops the attributes of an empty span it writes, and reports them', () => {
    expect(htmlToCarve('<p><s><code class="c"></code></s></p>').value).toBe('{~``~}\n')
    expect(codes('<p><s><code class="c"></code></s></p>')).toEqual(['attribute-dropped'])
  })

  it('keeps the attributes of a span with content', () => {
    expect(htmlToCarve('<p><code class="c">a</code></p>').value).toBe('`a`{.c}\n')
  })
})
