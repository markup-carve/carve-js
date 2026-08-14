import { describe, it, expect } from 'vitest'
import { markdownToCarve, type MarkdownDialect } from '../src/markdown-migrate.js'
import { carveToHtml } from '../src/index.js'

/*
 * A Markdown construct reaches Carve two ways. Some the converter REWRITES
 * (`^x^` to `{^x^}`), and those are covered in markdown-migrate.test.ts. The
 * rest need no rewrite because Carve happens to spell them the way the source
 * does, so LEAVING THE SOURCE ALONE is itself the conversion - and a document
 * that CommonMark and GFM read as plain text grew markup its author never saw.
 *
 * Every expectation here was measured against `commonmark` 0.31.2 and `marked`
 * 18.0.9 rather than reasoned from memory, and the assertions are on the exact
 * bytes of the emitted Carve plus the HTML those bytes render to, because a
 * containment assertion passes on text that is merely glued together.
 */

const conv = (md: string, dialect?: MarkdownDialect) => markdownToCarve(md, dialect)
const html = (md: string, dialect?: MarkdownDialect) => carveToHtml(markdownToCarve(md, dialect))

describe('markdownToCarve — Carve syntax no Markdown flavour spells', () => {
  // Nothing in CommonMark, GFM, Pandoc, kramdown or Obsidian gives these
  // spellings a meaning, so there is no dialect to opt into: they are escaped
  // whatever the caller asks for.
  it.each<[string, string, string]>([
    ['a $`x+y` c', 'a \\$`x+y` c', '<p>a $<code>x+y</code> c</p>'],
    ['a $$`x+y` c', 'a \\$\\$`x+y` c', '<p>a $$<code>x+y</code> c</p>'],
    ['a !`x` c', 'a \\!`x` c', '<p>a !<code>x</code> c</p>'],
    ['a :term[x] c', 'a \\:term[x] c', '<p>a :term[x] c</p>'],
    // An extension opener needs no left boundary, so a word in front of it is
    // no protection: `foo:term[x]` is a call, and a rule that asked for one
    // would have left every mid-word occurrence live.
    ['foo:term[x]', 'foo\\:term[x]', '<p>foo:term[x]</p>'],
  ])('keeps %j literal', (md, carve, rendered) => {
    expect(conv(md)).toBe(carve)
    expect(html(md)).toBe(rendered)
  })

  it('keeps a caption line literal, so the text stays where the author put it', () => {
    // `^ x` binds to the block above it, so after a quote it left the flow of
    // the document entirely and came back as the quote's `<footer>`.
    expect(conv('> q\n\n^ attribution')).toBe('> q\n\n\\^ attribution')
    expect(html('> q\n\n^ attribution')).toBe(
      '<blockquote><p>q</p></blockquote>\n<p>^ attribution</p>',
    )
  })

  it('escapes every dollar of a run, not just the first', () => {
    // `\$$`x`` is a literal dollar followed by an INLINE math span - the second
    // dollar opens it - so a run needs one backslash per character.
    expect(carveToHtml('a \\$$`x+y` c')).toContain('math inline')
    expect(html('a $$`x+y` c')).not.toContain('math')
  })
})

describe('markdownToCarve — flavour constructs Carve spells the same way', () => {
  // Each of these is real syntax in a named flavour, so it gets a flag, and
  // each is plain text in CommonMark and GFM, so the flag is off by default.
  const cases: Array<{
    name: string
    md: string
    off: string
    offHtml: string
    dialect: MarkdownDialect
    onHtml: string
  }> = [
    {
      name: 'an inline footnote (Pandoc)',
      md: 'a ^[note] b',
      off: 'a \\^[note] b',
      offHtml: '<p>a ^[note] b</p>',
      dialect: { inlineFootnotes: true },
      onHtml: 'doc-noteref',
    },
    {
      name: 'an abbreviation definition (PHP Markdown Extra)',
      md: '*[HTML]: HyperText\n\nHTML here',
      off: '\\*[HTML]: HyperText\n\nHTML here',
      offHtml: '<p>*[HTML]: HyperText</p>\n<p>HTML here</p>',
      dialect: { abbreviations: true },
      onHtml: '<abbr title="HyperText">HTML</abbr>',
    },
    {
      name: 'a fenced div (Pandoc, Quarto)',
      md: 'x\n\n::: note\nbody\n:::',
      off: 'x\n\n\\::: note\nbody\n\\:::',
      offHtml: '<p>x</p>\n<p>::: note\nbody\n:::</p>',
      dialect: { fencedDivs: true },
      onHtml: '<aside class="admonition note">',
    },
    {
      name: 'an attributed span (Pandoc, kramdown)',
      md: 'a [t]{.c} b',
      off: 'a [t]\\{.c} b',
      offHtml: '<p>a [t]{.c} b</p>',
      dialect: { attributes: true },
      onHtml: '<span class="c">t</span>',
    },
    {
      name: "a block's attributes (Pandoc, kramdown)",
      md: '{.cls}\ntext',
      off: '\\{.cls}\ntext',
      offHtml: '<p>{.cls}\ntext</p>',
      dialect: { attributes: true },
      onHtml: '<p class="cls">text</p>',
    },
  ]

  it.each(cases)('leaves $name literal by default', ({ md, off, offHtml }) => {
    expect(conv(md)).toBe(off)
    expect(html(md)).toBe(offHtml)
  })

  it.each(cases)('converts $name when asked', ({ md, dialect, onHtml }) => {
    // The opt-in path is the OLD behavior, byte for byte: the flag turns the
    // escape off, and the source reaches Carve exactly as it was written.
    expect(conv(md, dialect)).toBe(md)
    expect(html(md, dialect)).toContain(onHtml)
  })

  // An attribute list attaches to whatever construct precedes it, and the
  // bare `[t]{.c}` span is the least common of the nine ways that happens. The
  // rest only become visible after the delimiter rewrites have run: `*x*{.c}`
  // is `/x/{.c}` by then, and a link, image, code span or autolink is a
  // placeholder.
  it.each<[string, string, string]>([
    ['a [t](u){.c} b', 'a [t](u)\\{.c} b', '<p>a <a href="u">t</a>{.c} b</p>'],
    ['a ![alt](u){.c} b', 'a ![alt](u)\\{.c} b', '<p>a <img src="u" alt="alt">{.c} b</p>'],
    ['a [t][r]{.c} b', 'a [t][r]\\{.c} b', '<p>a [t][r]{.c} b</p>'],
    ['a `x`{.c} b', 'a `x`\\{.c} b', '<p>a <code>x</code>{.c} b</p>'],
    [
      'a <https://e.com/>{.c} b',
      'a <https://e.com/>\\{.c} b',
      '<p>a <a href="https://e.com/">https://e.com/</a>{.c} b</p>',
    ],
    ['a *x*{.c} b', 'a /x/\\{.c} b', '<p>a <em>x</em>{.c} b</p>'],
    ['a _x_{.c} b', 'a /x/\\{.c} b', '<p>a <em>x</em>{.c} b</p>'],
    ['a **x**{.c} b', 'a *x*\\{.c} b', '<p>a <strong>x</strong>{.c} b</p>'],
    ['a ~~s~~{.c} b', 'a ~s~\\{.c} b', '<p>a <s>s</s>{.c} b</p>'],
    ['<sup>y</sup>{.c}', '{^y^}\\{.c}', '<p><sup>y</sup>{.c}</p>'],
  ])('keeps the attribute list on %j from attaching', (md, carve, rendered) => {
    expect(conv(md)).toBe(carve)
    expect(html(md)).toBe(rendered)
  })

  it.each<[string, string]>([
    ['a [t](u){.c} b', '<a href="u" class="c">t</a>'],
    ['a `x`{.c} b', '<code class="c">x</code>'],
    ['a *x*{.c} b', '<em class="c">x</em>'],
  ])('attaches the attribute list on %j when asked', (md, rendered) => {
    expect(html(md, { attributes: true })).toContain(rendered)
  })

  it.each<[string, string, string]>([
    ['a [t]{#id} b', 'a [t]\\{\\#id} b', '<p>a [t]{#id} b</p>'],
    ['{#id .cls}\ntext', '\\{\\#id .cls}\ntext', '<p>{#id .cls}\ntext</p>'],
    ['a `x`{#id} b', 'a `x`\\{\\#id} b', '<p>a <code>x</code>{#id} b</p>'],
  ])('escapes the tag a %j payload opens with', (md, carve, rendered) => {
    // Escaping only the brace left the payload live: the general tag rule
    // skips a `#` behind an unescaped `{`, on the premise that the braced form
    // owns it, and escaping the brace is exactly what retires that premise.
    expect(conv(md)).toBe(carve)
    expect(html(md)).toBe(rendered)
  })

  it('does not escape a payload tag the general rule already escaped', () => {
    // `{.a #b}` has its `#` escaped before the brace is, so escaping it again
    // would print the backslash instead of hiding it.
    expect(conv('a [t]{.a #b} c')).toBe('a [t]\\{.a \\#b} c')
    expect(html('a [t]{.a #b} c')).toBe('<p>a [t]{.a #b} c</p>')
  })

  it('does not read a braced delimiter pair as an attribute list', () => {
    // Carve reads `{,x,}` as a subscript wherever it stands - alone on a line
    // and directly after another construct alike - and this converter emits
    // that very form for `<sub>x</sub>`, so escaping it as an attribute list
    // would have turned the converter's own output into text.
    expect(conv('<sub>x</sub>')).toBe('{,x,}')
    expect(html('<sub>x</sub>')).toBe('<p><sub>x</sub></p>')
    expect(conv('<ins>x</ins>')).toBe('{+x+}')
    expect(html('<ins>x</ins>')).toBe('<p><ins>x</ins></p>')
  })

  it('leaves the other constructs alone when one flag is on', () => {
    // The flags are independent: opting into fenced divs must not also opt into
    // attributes, which is what a single shared switch would have done.
    expect(conv('a [t]{.c} b', { fencedDivs: true })).toBe('a [t]\\{.c} b')
    expect(conv('x\n\n::: n\nb\n:::', { attributes: true })).toBe('x\n\n\\::: n\nb\n\\:::')
  })
})

describe('markdownToCarve — shapes that must stay bare', () => {
  // Over-escaping is its own defect: a backslash in front of a character the
  // author typed as itself is as wrong as the markup it prevents. These are
  // the near misses of each rule above.
  it.each([
    'k {a=b} v',
    'c {.cls} d',
    'note: see [x] below',
    '5 !important',
    'costs $5 today',
    'a[^1] b',
    'para\n^ x',
    '*[A]:x',
    // The name of an extension call starts with a letter and reaches the
    // bracket without a break, so neither of these is one.
    'note:[see below]',
    'at 10:30[x]',
  ])('does not escape %j', (md) => {
    expect(conv(md)).toBe(md)
  })

  it('escapes an inline footnote a brace happens to precede', () => {
    // Carve reads the note in `a {^[body] b` as readily as in `a ^[body] b`,
    // so a rule that excluded a preceding brace left this one converting.
    expect(conv('a {^[note] b')).toBe('a {\\^[note] b')
    expect(html('a {^[note] b')).toBe('<p>a {^[note] b</p>')
  })

  it('does not escape a colon fence opener that Carve does not read as one', () => {
    // Carve wants a space or a line end after the colons, so `:::note` is
    // already literal and needs no help. The lone `:::` below it is a fence
    // opener in its own right, which is why it does get escaped.
    expect(conv('x\n\n:::note\nbody\n:::')).toBe('x\n\n:::note\nbody\n\\:::')
  })
})
