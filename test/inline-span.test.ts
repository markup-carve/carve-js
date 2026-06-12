import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'

const h = (s: string) => carveToHtml(s)

/**
 * Inline span (grammar PART 9 §14): `[text]{attrs}` attaches the
 * attribute block to a <span>. Disambiguated from links by the char
 * after `]` (`(`=link, `[`=ref, `{`=span, else literal).
 */
describe('inline span [text]{attrs}', () => {
  it('wraps text in a span with id/class/key attributes', () => {
    expect(h('[some text]{.highlight #note key=val}')).toBe(
      '<p><span class="highlight" id="note" key="val">some text</span></p>',
    )
  })

  it('parses the content recursively', () => {
    expect(h('[a /b/ c]{.x}')).toBe('<p><span class="x">a <em>b</em> c</span></p>')
  })

  it('supports a class-only span', () => {
    expect(h('[hi]{.foo}')).toBe('<p><span class="foo">hi</span></p>')
  })

  it('supports an id-only span', () => {
    expect(h('[hi]{#bar}')).toBe('<p><span id="bar">hi</span></p>')
  })

  it('requires the attribute block to abut ] (space => literal)', () => {
    expect(h('[text] {.x}')).toBe('<p>[text] {.x}</p>')
  })

  it('forms an empty span from a valid empty attribute block', () => {
    // A bracket + a VALID (possibly empty) attribute block is a span, even
    // empty (`[x]{}` -> empty <span>, matching djot).
    expect(h('[text]{}')).toBe('<p><span>text</span></p>')
    expect(h('[text]{ }')).toBe('<p><span>text</span></p>')
  })

  it('lets an inline link win over a span', () => {
    expect(h('[t](u)')).toBe('<p><a href="u">t</a></p>')
  })

  it('lets a resolved reference link win over a span', () => {
    expect(h('[t][r]\n\n[r]: /url')).toContain('<a href="/url">t</a>')
  })

  it('renders a span inside other inline content', () => {
    expect(h('before [mid]{.m} after')).toBe(
      '<p>before <span class="m">mid</span> after</p>',
    )
  })

  it('contributes its text to a heading slug and renders inside the heading', () => {
    const html = h('# A [x]{.k} b')
    expect(html).toContain('<section id="a-x-b">')
    expect(html).toContain('<h1>A <span class="k">x</span> b</h1>')
  })

  it('escapes the span content', () => {
    expect(h('[a & b]{.x}')).toBe('<p><span class="x">a &amp; b</span></p>')
  })

  it('stays literal when the attribute block is INVALID', () => {
    // An empty/whitespace block is valid (forms a span); but content that
    // isn't attribute syntax (`{???}`) is not an attribute block, so the
    // bracketed run stays literal.
    expect(h('[text]{???}')).toBe('<p>[text]{???}</p>')
    expect(h('[text]{?y?}')).toBe('<p>[text]{?y?}</p>')
  })

  it('parses a span whose body contains nested brackets / a link', () => {
    // The bracketed run is matched by balance (matchBracket), so the close
    // `]` spans nested brackets and the body is parsed as inline — a span
    // body may hold a link/image/nested bracket (matches djot).
    expect(h('[see [x](/u)]{.note}')).toBe(
      '<p><span class="note">see <a href="/u">x</a></span></p>',
    )
  })

  it('allows a } inside a quoted attribute value', () => {
    // The close `}` is the first one OUTSIDE quotes (djot "don't mind
    // braces in quotes").
    expect(h('[x]{data-x="{y}"}')).toBe('<p><span data-x="{y}">x</span></p>')
  })

  it('rejects a digit-first attribute name (block stays literal)', () => {
    // An attribute name (id, class, key) is a grammar identifier and may not
    // start with a digit; the whole block is then not an attribute block and
    // stays literal (§14), stricter than djot.
    expect(h('[x]{.123}')).toBe('<p>[x]{.123}</p>')
    expect(h('[x]{123=v}')).toBe('<p>[x]{123=v}</p>')
    expect(h('[x]{.1a}')).toBe('<p>[x]{.1a}</p>')
  })

  it('still accepts a digit AFTER the first identifier character', () => {
    expect(h('[x]{.a1 #b2 k3=v}')).toBe(
      '<p><span class="a1" id="b2" k3="v">x</span></p>',
    )
  })
})
