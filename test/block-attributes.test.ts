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

  it('merges adjacent attribute blocks on one block-attribute line', () => {
    expect(h('{.c}{#i}\n# H')).toBe(
      '<section id="i">\n  <h1 class="c">H</h1>\n</section>',
    )
    expect(h('{.a}{.b}\n# H')).toBe(
      '<section id="H">\n  <h1 class="a b">H</h1>\n</section>',
    )
    expect(h('{#i}{.c}\n# H')).toBe(
      '<section id="i">\n  <h1 class="c">H</h1>\n</section>',
    )
  })

  it('accumulates classes, deduping repeats (§15, matches carve-php)', () => {
    expect(h('{.a .b}\n{.b .c}\nText')).toBe('<p class="a b c">Text</p>')
    expect(h('[x]{.a .a}')).toBe('<p><span class="a">x</span></p>')
  })

  it('floats across a blank line to the next block', () => {
    expect(h('{.note}\n\nText')).toBe('<p class="note">Text</p>')
  })

  it('drops a dangling run with no following block', () => {
    expect(h('Text\n\n{.note}')).toBe('<p>Text</p>')
  })

  describe('A2a: an invisible construct is not the next block (carve#529)', () => {
    // `pending` floats PAST anything that renders nothing and attaches to the
    // next VISIBLE block. The attribute is the author's instruction about a
    // rendered element, and attaching it to a construct that emits nothing
    // silently discards it - which A4 reserves for the one case where there is
    // genuinely nothing left, end of document.
    //
    // One case per kind, because no engine was self-consistent across the five:
    // carve-js dropped the attribute over all of them, carve-rs over the
    // abbreviation definition only, carve-php over the two reference kinds.

    it('floats past a reference definition', () => {
      expect(h('{.note}\n[ref]: /u\n\nText')).toBe('<p class="note">Text</p>')
    })

    it('floats past a footnote definition', () => {
      expect(h('{#i}\n[^f]: note\n\ne')).toBe('<p id="i">e</p>')
    })

    it('floats past an abbreviation definition', () => {
      expect(h('{#i}\n*[A]: alpha\n\ne')).toBe('<p id="i">e</p>')
    })

    it('floats past a line comment', () => {
      expect(h('{#i}\n%% aside\n\ne')).toBe('<p id="i">e</p>')
    })

    it('floats past a comment block', () => {
      expect(h('{#i}\n%%%\naside\n%%%\n\ne')).toBe('<p id="i">e</p>')
    })

    it('floats past several in a row', () => {
      expect(h('{#i}\n[ref]: /u\n%% aside\n*[A]: alpha\n\ne')).toBe('<p id="i">e</p>')
    })

    it('is still dropped when only invisible constructs follow (A4)', () => {
      expect(h('{#i}\n[ref]: /u\n')).toBe('')
    })
  })

  it('parses a multi-line attribute block', () => {
    expect(h('{.foo\n .bar}\nText')).toBe('<p class="foo bar">Text</p>')
  })

  it('a bare word is a boolean (value-less) attribute', () => {
    expect(h('{foo}\nText')).toBe('<p foo="">Text</p>')
  })

  it('a {...} line with trailing text is not a block-attribute line', () => {
    expect(h('{.x} text')).toBe('<p>{.x} text</p>')
  })

  it('keeps a valid token alongside a boolean attribute (no drop)', () => {
    // `{.note junk}` applies the class AND the boolean `junk` -- a bare word is
    // a value-less attribute, not "junk" that invalidates the block.
    expect(h('{.note junk}\nText')).toBe('<p class="note" junk="">Text</p>')
  })

  it('still rejects a digit-first bare word (not a valid attribute name)', () => {
    expect(h('{2bad}\nText')).toBe('<p>{2bad}\nText</p>')
  })

  it('attaches a class to a heading section body', () => {
    // The id (auto or explicit) lives on <section>; a leading class
    // attaches to the <h*>.
    expect(h('{.big}\n# Title')).toBe(
      '<section id="Title">\n  <h1 class="big">Title</h1>\n</section>',
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

  it('hoists an explicit id to the section while other attrs stay on the h*', () => {
    // Strict djot: all heading attributes come from the preceding block-
    // attribute line. The explicit `#x` hoists to the <section>; the class
    // stays on the <h1>.
    const html = h('{.lead #x}\n# H')
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
