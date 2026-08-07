import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'

/**
 * `quoted_value` excludes a newline in BOTH of its alternatives
 * (markup-carve/carve#888, markup-carve/carve-js#838).
 *
 * An attribute value in quotes ends at the closing quote ON THE SAME LINE. A
 * line break inside the quotes is not content - it ends the production, and the
 * whole attribute block is unrecognized.
 *
 * This is settled the executable spec's way because the alternative falsifies a
 * sentence the grammar already states. An INLINE attribute block cannot span
 * lines (markup-carve/carve#897), and since markup-carve/carve#906 its padding
 * takes `space` and its separator `space+`, neither of which admits a break.
 * The quoted value was the last way through.
 *
 * `block_attributes` reads the SAME `quoted_value`, so a break inside a quoted
 * value ends that block too - the half with a cost. A block attribute may still
 * span lines: `continuation` is where a newline is admitted and it sits BETWEEN
 * two tokens, never inside one.
 *
 * All three engines accepted the block-line row and did not agree on what it
 * meant: this engine kept the break in the value, carve-php and carve-rs
 * collapsed it to a space. Collapsing a newline to a space is not something any
 * production describes, in either normative file, which is what makes this a
 * defect rather than one of two defensible readings.
 */

describe('a quoted attribute value stops at the newline', () => {
  it('an INLINE block with a break inside a double-quoted value is literal', () => {
    expect(carveToHtml('*x*{k="a\nb"}\n')).toBe('<p><strong>x</strong>{k=“a\nb”}</p>')
  })

  it('an INLINE block with a break inside a single-quoted value is literal', () => {
    // BOTH alternatives, not just the double-quoted one.
    expect(carveToHtml("*x*{k='a\nb'}\n")).toBe('<p><strong>x</strong>{k=‘a\nb’}</p>')
  })

  it('CONTROL the same value on ONE line is an ordinary attribute', () => {
    // The rule is about the line break, not about the quotes.
    expect(carveToHtml('*x*{k="a b"}\n')).toBe('<p><strong k="a b">x</strong></p>')
    expect(carveToHtml("*x*{k='a b'}\n")).toBe('<p><strong k="a b">x</strong></p>')
  })

  it('a BLOCK-ATTRIBUTE LINE with a break inside a quoted value is literal', () => {
    expect(carveToHtml('{k="a\nb"}\n\nparagraph\n')).toBe(
      '<p>{k=“a\nb”}</p>\n<p>paragraph</p>',
    )
    expect(carveToHtml("{k='a\nb'}\n\nparagraph\n")).toBe(
      '<p>{k=‘a\nb’}</p>\n<p>paragraph</p>',
    )
  })

  it('a break anywhere in the run ends it, not only the first one', () => {
    expect(carveToHtml('{k="a\nb\nc"}\n\nparagraph\n')).toBe(
      '<p>{k=“a\nb\nc”}</p>\n<p>paragraph</p>',
    )
  })

  it('tests EVERY quoted run, not only the first', () => {
    // A payload whose FIRST value is well-formed and whose SECOND spans lines.
    // A check that answers on the first run it finds accepts this.
    expect(carveToHtml('*x*{k="a" j="b\nc"}\n')).toBe(
      '<p><strong>x</strong>{k=\u201ca\u201d j=\u201cb\nc\u201d}</p>',
    )
    expect(carveToHtml('{k="a" j="b\nc"}\n\nparagraph\n')).toBe(
      '<p>{k=\u201ca\u201d j=\u201cb\nc\u201d}</p>\n<p>paragraph</p>',
    )
    // CONTROL: the same two values on one line still attach.
    expect(carveToHtml('*x*{k="a" j="b c"}\n')).toBe('<p><strong k="a" j="b c">x</strong></p>')
  })

  it('CONTROL a block attribute may still span lines through its CONTINUATION', () => {
    // `continuation` sits BETWEEN two tokens, never inside one, so this is
    // still a single block. A fix that keyed on "the payload contains a
    // newline" instead of on the quoted RUN breaks exactly here.
    expect(carveToHtml('{.a\n.b}\n\nparagraph\n')).toBe('<p class="a b">paragraph</p>')
  })

  it('CONTROL a completed quoted value may be followed by a continuation', () => {
    // The value ends on its own line; the break after it is the separator.
    expect(carveToHtml('{k="a"\n.b}\n\nparagraph\n')).toBe('<p k="a" class="b">paragraph</p>')
  })

  it('CONTROL a BLANK line still ends the block rather than padding it', () => {
    expect(carveToHtml('{.a\n\n.b}\n\nparagraph\n')).toBe(
      '<p>{.a</p>\n<p>.b}</p>\n<p>paragraph</p>',
    )
  })

  it('holds on every surface that carries an attribute payload', () => {
    // The report showed two rows. Eleven surfaces let the break through.
    const surfaces: Record<string, (v: string) => string> = {
      emphasis: (v) => '*x*{k=' + v + '}\n',
      span: (v) => '[x]{k=' + v + '}\n',
      'code span': (v) => '`x`{k=' + v + '}\n',
      'inline link': (v) => '[t](/u){k=' + v + '}\n',
      'reference link': (v) => '[t][r]{k=' + v + '}\n\n[r]: /u\n',
      image: (v) => '![a](/i){k=' + v + '}\n',
      'image reference': (v) => '![a][r]{k=' + v + '}\n\n[r]: /i\n',
      autolink: (v) => '<https://e.com/>{k=' + v + '}\n',
      'footnote reference': (v) => 'x[^f]{k=' + v + '}\n\n[^f]: n\n',
      'inline extension': (v) => ':qr[hi]{k=' + v + '}\n',
      'block-attribute line': (v) => '{k=' + v + '}\n\nparagraph\n',
    }
    const leaking: string[] = []
    const controlBroken: string[] = []
    for (const [name, mk] of Object.entries(surfaces)) {
      if (/\sk="/.test(carveToHtml(mk('"a\nb"')))) leaking.push(name)
      // The control on every row: the one-line form must still attach, or the
      // row above passes for a surface that takes no attributes at all.
      if (!/\sk="a b"/.test(carveToHtml(mk('"a b"')))) controlBroken.push(name)
    }
    expect(leaking).toEqual([])
    expect(controlBroken).toEqual([])
  })

  it('the INLINE EXTENSION reaches the shared gate at all now', () => {
    // It was the one inline attribute surface with no validity check: its
    // payload went straight to `parseAttrs`. So it let the break through, it
    // let a TAB separate two attributes after markup-carve/carve#906 narrowed
    // every sibling, and it turned `{#1a}` into a bogus `a=""` where §14 makes
    // it literal everywhere else. An invalid payload is no longer consumed.
    expect(carveToHtml(':qr[hi]{.a\t.b}\n')).toBe(
      '<p><span class="ext-qr">hi</span>{.a\t.b}</p>',
    )
    expect(carveToHtml(':qr[hi]{#1a}\n')).not.toContain('a=""')
    // CONTROL: a valid payload still attaches, and is still consumed.
    expect(carveToHtml(':qr[hi]{#ok}\n')).toBe('<p><span class="ext-qr" id="ok">hi</span></p>')
    expect(carveToHtml(':qr[hi]{.a .b}\n')).toBe('<p><span class="ext-qr a b">hi</span></p>')
  })
})
