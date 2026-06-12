import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'

const h = (s: string) => carveToHtml(s)

/**
 * Leading block-attribute lines (grammar PART 9 §15): a `{...}` line on
 * its own attaches to the next block; consecutive blocks merge (id/key
 * last-wins, classes accumulate); they float across blank lines; a
 * dangling run is dropped; a single block may span multiple lines.
 */
describe('block attribute lines (§15)', () => {
  it('attaches a single attribute line to the next block', () => {
    expect(h('{.note}\nText')).toBe('<p class="note">Text</p>')
  })

  it('accumulates classes across consecutive lines', () => {
    expect(h('{.a}\n{.b}\nText')).toBe('<p class="a b">Text</p>')
  })

  it('accumulates classes with no de-duplication', () => {
    expect(h('{.a .b}\n{.b .c}\nText')).toBe('<p class="a b b c">Text</p>')
  })

  it('floats across a blank line to the next block', () => {
    expect(h('{.note}\n\nText')).toBe('<p class="note">Text</p>')
  })

  it('drops a dangling run with no following block', () => {
    expect(h('Text\n\n{.note}')).toBe('<p>Text</p>')
  })

  it('does not leak attributes past a reference definition', () => {
    // The attr line attaches to the (non-rendering) link definition and
    // is dropped — it does NOT float onto the following paragraph.
    // Matches djot and carve-php.
    expect(h('{.note}\n[ref]: /u\nText')).toBe('<p>Text</p>')
  })

  it('parses a multi-line attribute block', () => {
    expect(h('{.foo\n .bar}\nText')).toBe('<p class="foo bar">Text</p>')
  })

  it('treats a non-attribute brace line as literal text', () => {
    expect(h('{foo}\nText')).toBe('<p>{foo}\nText</p>')
  })

  it('a {...} line with trailing text is not a block-attribute line', () => {
    expect(h('{.x} text')).toBe('<p>{.x} text</p>')
  })

  it('rejects a brace line with junk after a valid token (no silent drop)', () => {
    // `{.note junk}` must not hoist `.note` and drop `junk`; the whole
    // payload must be valid attribute syntax or the line is literal.
    expect(h('{.note junk}\nText')).toBe('<p>{.note junk}\nText</p>')
  })

  it('attaches a class to a heading section body', () => {
    // The id (auto or explicit) lives on <section>; a leading class
    // attaches to the <h*>.
    expect(h('{.big}\n# Title')).toBe(
      '<section id="title">\n  <h1 class="big">Title</h1>\n</section>',
    )
  })

  it('a leading {#id} becomes the heading section id', () => {
    expect(h('{#custom}\n# Title')).toContain('<section id="custom">')
  })

  it('attaches attributes to a list', () => {
    expect(h('{.todo}\n- a\n- b')).toBe(
      '<ul class="todo">\n  <li>a</li>\n  <li>b</li>\n</ul>',
    )
  })

  it('merges a leading class with the block’s own trailing id', () => {
    // Leading `.lead` + heading’s own `{#x}`: class on h1, id on section.
    const html = h('{.lead}\n# H {#x}')
    expect(html).toContain('<section id="x">')
    expect(html).toContain('<h1 class="lead">H</h1>')
  })

  it('attaches attributes to a thematic break', () => {
    expect(h('{#sep}\n---')).toBe('<hr id="sep">')
  })

  it('attaches attributes to a blockquote', () => {
    expect(h('{.q}\n> hi')).toBe('<blockquote class="q"><p>hi</p></blockquote>')
  })

  it('attaches attributes to a code block (on the <pre>)', () => {
    expect(h('{#snip}\n```\ncode\n```')).toBe(
      '<pre id="snip"><code>code\n</code></pre>',
    )
  })

  it('merges a leading class into an admonition wrapper class', () => {
    expect(h('{.x}\n::: note\nB\n:::')).toBe(
      '<aside class="admonition note x">\n  <p>B</p>\n</aside>',
    )
  })

  it('attaches attributes to a figure', () => {
    expect(h('{#f}\n> q\n^ cap')).toBe(
      '<figure id="f">\n  <blockquote><p>q</p></blockquote>\n  <figcaption>cap</figcaption>\n</figure>',
    )
  })

  it('preserves a paragraph attribute inside a single-paragraph blockquote', () => {
    expect(h('> {.lead}\n> text')).toBe(
      '<blockquote><p class="lead">text</p></blockquote>',
    )
  })

  it('keeps the <p> for a tight list-item paragraph that carries attributes', () => {
    expect(h('- {.x}\n  text')).toBe(
      '<ul>\n  <li><p class="x">text</p></li>\n</ul>',
    )
  })

  // A `{...}` line that directly trails paragraph content (no blank line) is a
  // block-attribute line: it interrupts the paragraph and floats forward like
  // any other (§15), rather than folding into the paragraph as literal text.
  it('a trailing block-attribute line interrupts and is dropped when nothing follows', () => {
    expect(h('Para\n{.class}')).toBe('<p>Para</p>')
  })

  it('a trailing block-attribute line floats forward to the next block', () => {
    expect(h('Para\n{.class}\n\nNext')).toBe(
      '<p>Para</p>\n<p class="class">Next</p>',
    )
  })

  it('a trailing block-attribute line after a multi-line paragraph is dropped', () => {
    expect(h('a\nb\n{.c}')).toBe('<p>a\nb</p>')
  })

  it('an inline {...} on the same line as content stays literal', () => {
    expect(h('text {.x} y')).toBe('<p>text {.x} y</p>')
  })
})
