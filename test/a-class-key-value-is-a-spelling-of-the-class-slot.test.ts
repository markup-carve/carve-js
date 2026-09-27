import { describe, expect, it } from 'vitest'

import { carveToHtml, parse, renderCarve, renderMarkdown, toAstJson, type Document, type InlineNode } from '../src/index.js'

/*
 * A `class` KEY-VALUE IS A SPELLING OF THE CLASS SLOT (CARVE-P4-007,
 * markup-carve/carve#2438, markup-carve/carve#2439, markup-carve/carve#2435).
 *
 * `class=VALUE` and `.VALUE` are the same attribute, so the parser appends the
 * value to `attrs.classes` in source order and writes nothing to `keyValues`.
 * Left in `keyValues` the two slots each rendered their own attribute, so
 * `{class=a .b}` produced `<div class="x b" class="a">` - two `class`
 * attributes on one element.
 *
 * The spellings are not interchangeable in SOURCE: `.` reads an
 * `explicit_identifier`, while `attribute_value` reaches past it, so `-col` and
 * `w-1/2` are classes only the key-value form can spell. The writer therefore
 * moves with the parser - a class outside the shorthand's shape is written
 * `class="..."`, quoted, because `unquoted_value` cannot hold `/`.
 */

const attrsOf = (source: string): unknown => {
  const doc = JSON.parse(JSON.stringify(toAstJson(parse(source)))) as {
    children: Array<{ attrs?: unknown; children?: Array<{ attrs?: unknown }> }>
  }
  const block = doc.children[0]!
  return block.attrs ?? block.children?.[0]?.attrs
}

const countClassAttrs = (html: string): number => html.match(/class="/g)?.length ?? 0

describe('a class key-value is a spelling of the class slot', () => {
  it('folds a class key-value into the class slot, in source order', () => {
    expect(attrsOf('{class=a .b}\npara')).toEqual({ classes: ['a', 'b'], order: ['.class'] })
  })

  it('appends behind a shorthand class written first', () => {
    expect(attrsOf('{.b class=a}\npara')).toEqual({ classes: ['b', 'a'], order: ['.class'] })
  })

  it('writes nothing to keyValues', () => {
    expect((attrsOf('{class=a .b}\npara') as { keyValues?: unknown }).keyValues).toBeUndefined()
  })

  it('appends a repeated class key-value rather than overwriting it', () => {
    // `.a .b` appends, and one concept has one behavior: the key-value form is
    // not last-wins the way the `id` slot is, because a class slot HOLDS many.
    expect(attrsOf('{class=a class=b}\npara')).toEqual({ classes: ['a', 'b'], order: ['.class'] })
  })

  it('gives the two spellings of one document the same tree', () => {
    expect(attrsOf('{class=foo}\npara')).toEqual(attrsOf('{.foo}\npara'))
  })

  it('folds a bare boolean class, whose value PART 4 makes empty', () => {
    expect(attrsOf('{class}\npara')).toEqual({ classes: [''], order: ['.class'] })
  })

  it('gives a bare class and an empty quoted value the same tree', () => {
    expect(attrsOf('{class}\npara')).toEqual(attrsOf('{class=""}\npara'))
  })

  it('keeps the id and other key-values in their own slots', () => {
    expect(attrsOf('{#i class=-col .b k=v}\npara')).toEqual({
      id: 'i',
      classes: ['-col', 'b'],
      keyValues: { k: 'v' },
      order: ['#id', '.class', 'k'],
    })
  })

  it('folds on the inline path too', () => {
    expect(attrsOf('[t]{class=a .b}')).toEqual({ classes: ['a', 'b'], order: ['.class'] })
  })
})

describe('one element renders ONE class attribute', () => {
  // Driven one shape per case: a suite stops at the first failing assertion, so
  // a loop would never evaluate the shapes behind the first regression.
  const shapes: Array<[string, string]> = [
    ['{class=a .b}\npara', '<p class="a b">para</p>'],
    ['{.b class=a}\npara', '<p class="b a">para</p>'],
    ['{class=-col}\npara', '<p class="-col">para</p>'],
    ['{class=a class=b}\npara', '<p class="a b">para</p>'],
    ['{class}\npara', '<p class="">para</p>'],
    ['{class=""}\npara', '<p class="">para</p>'],
    ['{.a .b}\npara', '<p class="a b">para</p>'],
    ['{#i class=-col .b k=v}\npara', '<p id="i" class="-col b" k="v">para</p>'],
    ['{class="w-1/2" .grid}\npara', '<p class="w-1/2 grid">para</p>'],
    ['[t]{class=a .b}', '<p><span class="a b">t</span></p>'],
    ['[t]{class=-col}', '<p><span class="-col">t</span></p>'],
    ['{class=a class}\n:::\ny\n:::', '<div class="a">\n  <p>y</p>\n</div>'],
    ['{class .b}\n:::\ny\n:::', '<div class="b">\n  <p>y</p>\n</div>'],
    ['{class class=a}\n:::\ny\n:::', '<div class="a">\n  <p>y</p>\n</div>'],
    ['{class="javascript:alert(1)"}\n:::\ny\n:::', '<div class="">\n  <p>y</p>\n</div>'],
    ['{class="javascript:alert(1)" .b}\n:::\ny\n:::', '<div class="b">\n  <p>y</p>\n</div>'],
    ['{class}\n:::\ny\n:::', '<div class="">\n  <p>y</p>\n</div>'],
    ['{class="" class="javascript:alert(1)" class}\n:::\ny\n:::', '<div class="">\n  <p>y</p>\n</div>'],
    ['{class="a:b"}\n:::\ny\n:::', '<div class="a:b">\n  <p>y</p>\n</div>'],
    ['{class="" .b class=b class=a .b}\n:::\ny\n:::', '<div class="b a">\n  <p>y</p>\n</div>'],
    ['[t]{class .b}', '<p><span class="b">t</span></p>'],
    ['[t]{class="javascript:alert(1)" class}', '<p><span class="">t</span></p>'],
    ['{class .b}\n::: note\ny\n:::', '<aside class="admonition note b" aria-label="Note">\n  <p>y</p>\n</aside>'],
    ['{class="javascript:alert(1)" .b .b}\n::: note\ny\n:::', '<aside class="admonition note b" aria-label="Note">\n  <p>y</p>\n</aside>'],
  ]

  for (const [source, html] of shapes) {
    it(`renders ${JSON.stringify(source)} with one class attribute`, () => {
      expect(countClassAttrs(carveToHtml(source))).toBe(1)
      expect(carveToHtml(source)).toBe(html)
    })
  }
})

describe('the writer spells a class the shorthand cannot', () => {
  it('writes a leading-hyphen class as a quoted key-value', () => {
    expect(renderCarve(parse('{class=-col}\npara'))).toBe('{class="-col"}\npara\n')
  })

  it('quotes a value unquoted_value cannot hold', () => {
    // `unquoted_value` is `(letter | digit | '-' | '_' | '.' | ':')+`.
    expect(renderCarve(parse('{class="w-1/2" .grid}\npara'))).toBe('{class="w-1/2" .grid}\npara\n')
  })

  it('keeps the shorthand for a class that has one', () => {
    expect(renderCarve(parse('{class=a .b}\npara'))).toBe('{.a .b}\npara\n')
  })

  it('writes an empty class value, which has no bare spelling in the class slot', () => {
    expect(renderCarve(parse('{class}\npara'))).toBe('{class=""}\npara\n')
  })

  for (const source of [
    '{class=a .b}\npara',
    '{.b class=a}\npara',
    '{class=-col}\npara',
    '{class=a class=b}\npara',
    '{class}\npara',
    '{class=""}\npara',
    '{.a .b}\npara',
    '{#i class=-col .b k=v}\npara',
    '{class="w-1/2" .grid}\npara',
    '[t]{class=a .b}',
    '[t]{class=-col}',
  ]) {
    it(`round-trips ${JSON.stringify(source)}`, () => {
      const written = renderCarve(parse(source))
      expect(carveToHtml(written)).toBe(carveToHtml(source))
    })

    it(`is a formatter fixed point for ${JSON.stringify(source)}`, () => {
      const written = renderCarve(parse(source))
      expect(renderCarve(parse(written))).toBe(written)
    })
  }
})

/*
 * The Markdown target reaches the same class slot through its raw-HTML escape
 * hatch, which only `ruby` and `small_caps` open. No source spells either, so
 * the tree is built here.
 */
describe('the Markdown target filters the same class slot', () => {
  const paragraph = (node: InlineNode): Document => ({
    type: 'document',
    children: [{ type: 'paragraph', children: [node] }],
  })
  const ruby = (classes: string[]): InlineNode => ({
    type: 'ruby',
    attrs: { classes },
    pairs: [{ base: [{ type: 'text', value: 'x' }], annotation: [{ type: 'text', value: 'y' }] }],
  })
  const smallCaps = (classes: string[]): InlineNode => ({
    type: 'small_caps',
    attrs: { classes },
    children: [{ type: 'text', value: 'x' }],
  })

  it('drops an empty and a refused value and dedups the rest', () => {
    const classes = ['', 'javascript:alert(1)', 'b', 'b', 'a:b']
    expect(renderMarkdown(paragraph(ruby(classes)))).toBe(
      '<ruby class="b a:b">x<rp>(</rp><rt>y</rt><rp>)</rp></ruby>\n',
    )
    expect(renderMarkdown(paragraph(smallCaps(classes)))).toBe('<span class="smallcaps b a:b">x</span>\n')
  })

  it('keeps the slot when nothing survives', () => {
    const classes = ['', 'javascript:alert(1)']
    expect(renderMarkdown(paragraph(ruby(classes)))).toBe(
      '<ruby class="">x<rp>(</rp><rt>y</rt><rp>)</rp></ruby>\n',
    )
    expect(renderMarkdown(paragraph(smallCaps(classes)))).toBe('<span class="smallcaps">x</span>\n')
  })
})
