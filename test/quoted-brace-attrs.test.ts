import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'

const h = (s: string) => carveToHtml(s).trim()

/**
 * Attribute blocks accept a `}` inside a quoted value across every
 * construct that carries one — not just inline spans (grammar PART 10
 * §1, djot "don't mind braces in quotes"). The close `}` is the first
 * one OUTSIDE quotes, so `{k="{y}"}` keeps the literal `{y}` as the value
 * instead of stopping at the inner `}` and leaking the remainder.
 */
describe('} inside a quoted attribute value', () => {
  it('link', () => {
    expect(h('[t](u){k="{y}"}')).toBe('<p><a href="u" k="{y}">t</a></p>')
  })

  it('image', () => {
    expect(h('![a](u){k="{y}"}')).toBe('<img src="u" alt="a" k="{y}">')
  })

  it('inline extension', () => {
    expect(h(':kbd[x]{k="{y}"}')).toBe('<p><kbd k="{y}">x</kbd></p>')
  })

  it('heading', () => {
    expect(h('# H {k="{y}"}')).toBe('<section id="h">\n  <h1 k="{y}">H</h1>\n</section>')
  })

  it('generic div', () => {
    expect(h(':::{k="{y}"}\nbody\n:::')).toBe('<div k="{y}">\n  <p>body</p>\n</div>')
  })

  it('reference link', () => {
    expect(h('[t][r]{k="{y}"}\n\n[r]: /url')).toContain('<a href="/url" k="{y}">t</a>')
  })

  it('single-quoted value (grammar quoted_value supports both quote forms)', () => {
    expect(h(`[x]{k='{y}'}`)).toBe('<p><span k="{y}">x</span></p>')
    expect(h(`:kbd[x]{k='{y}'}`)).toBe('<p><kbd k="{y}">x</kbd></p>')
  })
})

/**
 * Key/value attribute values may be double-quoted, single-quoted, or a
 * bare run (grammar `quoted_value = '"' … '"' | "'" … "'"`). Both quote
 * forms strip their delimiters, matching the carve-php reference impl.
 */
describe('single-quoted attribute values', () => {
  it('strips single quotes like double quotes', () => {
    expect(h(`[x]{k='v'}`)).toBe('<p><span k="v">x</span></p>')
  })

  it('invalidates the block on an unbalanced single quote (matches carve-php)', () => {
    // A lone `'` opens a quoted value that never closes, so the attribute
    // block is not valid and the run stays literal (the apostrophe is then
    // smart-typographed). carve-php produces the same.
    expect(h(`[x]{k=don't}`)).toBe('<p>[x]{k=don’t}</p>')
  })
})

/**
 * Author attributes on an inline extension (grammar §415,
 * `extension_inline = … [attributes]`) attach to its rendered element,
 * matching the inline-span / link behaviour and the carve-php reference
 * impl. A semantic shorthand emits the attrs on its own tag; an unknown
 * extension emits them on the `ext-<name>` span.
 */
describe('inline extension attributes', () => {
  it('applies a class to a semantic-tag extension', () => {
    expect(h(':kbd[x]{.foo}')).toBe('<p><kbd class="foo">x</kbd></p>')
  })

  it('applies an id to a semantic-tag extension', () => {
    expect(h(':kbd[x]{#bar}')).toBe('<p><kbd id="bar">x</kbd></p>')
  })

  it('applies a key/value to a semantic-tag extension', () => {
    expect(h(':kbd[x]{k=v}')).toBe('<p><kbd k="v">x</kbd></p>')
  })

  it('keeps the base ext- class ahead of author classes on an unknown extension', () => {
    expect(h(':widget[x]{.foo}')).toBe('<p><span class="ext-widget foo">x</span></p>')
  })

  it('renders an unknown extension with no attrs as a bare ext- span', () => {
    expect(h(':widget[x]')).toBe('<p><span class="ext-widget">x</span></p>')
  })
})

/**
 * A backslash escapes ASCII punctuation inside a quoted attribute value
 * (matching the inline text-escape rule and the carve-php reference), so the
 * value can contain a literal quote.
 */
describe('escaped quotes in attribute values', () => {
  it('unescapes a quote in a span value', () => {
    expect(h('[x]{title="a\\"b"}')).toBe('<p><span title="a&quot;b">x</span></p>')
  })

  it('unescapes a quote in a heading value', () => {
    expect(h('# H {title="a\\"b"}')).toBe(
      '<section id="h">\n  <h1 title="a&quot;b">H</h1>\n</section>',
    )
  })

  it('keeps a backslash before a non-punctuation char literal', () => {
    expect(h('[x]{title="a\\nb"}')).toBe('<p><span title="a\\nb">x</span></p>')
  })

  it('accepts an escaped quote in a standalone block-attribute line', () => {
    expect(h('{title="a\\"b"}\nText')).toBe('<p title="a&quot;b">Text</p>')
  })
})

/**
 * An attribute block that yields no valid attribute is not a heading
 * attribute block (grammar `attribute_list` needs >= 1 attribute); it stays
 * part of the heading text rather than being dropped.
 */
describe('heading attribute-less brace block stays literal', () => {
  it('keeps a no-attribute brace block in the heading text', () => {
    expect(h('# H {???}')).toBe('<section id="h">\n  <h1>H {???}</h1>\n</section>')
  })

  it('still applies a valid heading attribute block', () => {
    expect(h('# H {.cls}')).toBe('<section id="h">\n  <h1 class="cls">H</h1>\n</section>')
  })
})
