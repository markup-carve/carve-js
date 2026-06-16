import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'

const h = (s: string) => carveToHtml(s)

/**
 * Heading section wrapping (grammar PART 9 §13): every top-level heading
 * emits <section id="{slug}"> around itself and the content up to the
 * next same-or-shallower heading. The id lives on the <section>, not the
 * <h*>. Sections nest by heading level. Matches djot.
 */
describe('heading <section> wrapping', () => {
  it('wraps a single heading and its body', () => {
    expect(h('# Intro\n\nText.')).toBe(
      '<section id="Intro">\n  <h1>Intro</h1>\n  <p>Text.</p>\n</section>',
    )
  })

  it('nests a deeper heading inside the shallower section', () => {
    expect(h('# A\n\n## B')).toBe(
      '<section id="A">\n  <h1>A</h1>\n  <section id="B">\n    <h2>B</h2>\n  </section>\n</section>',
    )
  })

  it('produces sibling sections for same-level headings', () => {
    expect(h('# A\n\n# B')).toBe(
      '<section id="A">\n  <h1>A</h1>\n</section>\n<section id="B">\n  <h1>B</h1>\n</section>',
    )
  })

  it('closes a deeper section when a shallower heading follows', () => {
    const html = h('# A\n\n## B\n\n# C')
    expect(html).toBe(
      [
        '<section id="A">',
        '  <h1>A</h1>',
        '  <section id="B">',
        '    <h2>B</h2>',
        '  </section>',
        '</section>',
        '<section id="C">',
        '  <h1>C</h1>',
        '</section>',
      ].join('\n'),
    )
  })

  it('nests by level number across a skipped level', () => {
    expect(h('# H1\n\n### H3')).toBe(
      '<section id="H1">\n  <h1>H1</h1>\n  <section id="H3">\n    <h3>H3</h3>\n  </section>\n</section>',
    )
  })

  it('puts an explicit {#id} on the section, other attrs on the heading', () => {
    // Strict djot: heading attributes come from the PRECEDING block-attribute
    // line; the explicit id still hoists to the <section>, the rest stay on h*.
    expect(h('{.large #intro}\n# Title\n\nP.')).toBe(
      '<section id="intro">\n  <h1 class="large">Title</h1>\n  <p>P.</p>\n</section>',
    )
  })

  it('emits no <section> for a document without headings', () => {
    expect(h('Just a paragraph.')).toBe('<p>Just a paragraph.</p>')
  })

  it('emits no <section> for an empty document', () => {
    expect(h('')).toBe('')
  })

  it('closes all open sections at end of document', () => {
    const html = h('# A\n\n## B\n\n### C')
    // Three nested opens; closes are innermost-first and indented to
    // each section's own depth.
    expect(html).toBe(
      [
        '<section id="A">',
        '  <h1>A</h1>',
        '  <section id="B">',
        '    <h2>B</h2>',
        '    <section id="C">',
        '      <h3>C</h3>',
        '    </section>',
        '  </section>',
        '</section>',
      ].join('\n'),
    )
  })

  it('keeps the fragment target resolvable via crossref', () => {
    const html = h('# Getting Started\n\nSee </#getting-started>.')
    expect(html).toContain('<section id="Getting-Started">')
    expect(html).toContain('<h1>Getting Started</h1>')
    expect(html).toContain('<a href="#Getting-Started">Getting Started</a>')
  })

  it('does not wrap a heading nested inside a blockquote', () => {
    // A nested heading carries its slug id on the <h*> (carve-php parity) but
    // gets NO <section> wrapper -- the section pass is a top-level-only concern.
    const html = h('> # Sub\n')
    expect(html).not.toContain('<section')
    expect(html).toContain('<h1 id="Sub">Sub</h1>')
  })
})
