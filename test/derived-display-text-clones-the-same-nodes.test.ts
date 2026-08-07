import { describe, it, expect } from 'vitest'
import { carveToHtml, headingNumbers, index, tableOfContents, tocPlacement } from '../src/index.js'

/**
 * PART 9R R4, DERIVED DISPLAY TEXT CLONES THE SAME NODES -- NORMATIVE
 * (markup-carve/carve#957).
 *
 * WHAT IS CLONED IS THE HEADING'S INLINE NODES (markup-carve/carve#915) binds
 * every consumer that derives display text from a heading, not the crossref
 * alone. Wherever anything builds visible text from a heading - a numbered
 * cross-reference label, an index term's display, a table-of-contents entry - it
 * clones the same inline NODES. Flattening to a string at the derivation site
 * destroys the source run exactly as flattening at the index site does, and no
 * renderer downstream can recover it: the label was materialized in the wrong
 * subsystem.
 *
 * NUMBERING, PREFIXING AND JOINING REMAIN THE EXTENSION'S OWN BUSINESS. R4
 * governs what the TITLE part is made of, not the label word, not the number,
 * and not the separator around them.
 */

const MARKUP = '{#h}\n# *bold* `code()` heading\n'

describe('derived display text clones the same nodes', () => {
  it('a numbered cross-reference label carries the title NODES', () => {
    // The clause's own consumer. This published `Section 1 - bold code()
    // heading`, with the emphasis and the code span gone, because the title was
    // captured as a rendered string.
    expect(
      carveToHtml(MARKUP + '\nSee </#h>.\n', { extensions: [headingNumbers()] }),
    ).toContain(
      'See <a href="#h">Section 1 - <strong>bold</strong> <code>code()</code> heading</a>.',
    )
  })

  it('THE LABEL IS TAKEN BEFORE ANY RENDER-STAGE INJECTION', () => {
    // The `section-number` span is a render-stage addition, not part of the
    // authored label, so it never appears in derived text. This engine resolves
    // cross-references BEFORE the numbering transform runs, which is why the
    // clause names the side rather than the ordering: an engine that resolves
    // after it must clone from the PRISTINE heading.
    const out = carveToHtml(MARKUP + '\nSee </#h>.\n', { extensions: [headingNumbers()] })
    expect(out).toContain('<h1><span class="section-number">1</span>')
    expect(out.split('See <a')[1]).not.toContain('section-number')
    // Twice-numbered would be the other failure: `Section 1 - 1 bold …`.
    expect(out).not.toContain('Section 1 - 1')
  })

  it('CONTROL the number-only label is untouched', () => {
    // Numbering, prefixing and joining stay the extension's business, so the
    // form that carries no title part has no nodes to clone.
    expect(
      carveToHtml(MARKUP + '\nSee </#h>.\n', {
        extensions: [headingNumbers({ crossref: 'number' })],
      }),
    ).toContain('See <a href="#h">Section 1</a>.')
  })

  it('a table-of-contents entry carries the heading NODES', () => {
    expect(carveToHtml(MARKUP, { extensions: [tableOfContents()] })).toContain(
      '<li><a href="#h"><strong>bold</strong> <code>code()</code> heading</a></li>',
    )
  })

  it('the ::: toc placement entry carries them too', () => {
    // Two producers build entries in this module and both had to move; a fix
    // wired to the injected nav alone leaves the placement directive flattening.
    expect(carveToHtml('::: toc\n:::\n\n' + MARKUP, { extensions: [tocPlacement()] })).toContain(
      '<li><a href="#h"><strong>bold</strong> <code>code()</code> heading</a></li>',
    )
  })

  it('an index term display carries its authored NODES', () => {
    expect(carveToHtml('::: index\n:::\n\n:index[*bold* term]\n', { extensions: [index()] })).toContain(
      '<li><strong>bold</strong> term ',
    )
  })

  it('a nested anchor is unwrapped rather than published', () => {
    // A heading may hold a link, and every derived label lands inside an <a>.
    // The core resolver already unwraps one it clones into a crossref; the three
    // consumers here call the SAME helper rather than each answering it again.
    const src = '{#h}\n# [a](/u) and <https://e.com>\n'
    const nests = (html: string) => /<a [^>]*>(?:(?!<\/a>)[\s\S])*<a /.test(html)
    expect(nests(carveToHtml(src, { extensions: [tableOfContents()] }))).toBe(false)
    expect(nests(carveToHtml(src + '\nSee </#h>.\n', { extensions: [headingNumbers()] }))).toBe(
      false,
    )
    expect(carveToHtml(src, { extensions: [tableOfContents()] })).toContain(
      '<li><a href="#h">a and https://e.com</a></li>',
    )
  })

  it('CONTROL the TOC entry still escapes and still strips bidi controls', () => {
    // Rendering nodes instead of a string moves the escaping to the core
    // renderer. If it had been dropped, this row publishes a live `<b>` inside
    // the nav, and the section 26 spoofing guard would be gone with it.
    expect(carveToHtml('# a <b> & "c"', { extensions: [tableOfContents()] })).toContain(
      '<li><a href="#a-b-c">a &lt;b&gt; &amp; “c”</a></li>',
    )
    expect(carveToHtml('# ‮reversed', { extensions: [tableOfContents()] })).toContain(
      '<li><a href="#reversed">reversed</a></li>',
    )
  })

  it('CONTROL the TOC entry still drops the section-number span and its space', () => {
    // The span is filtered and the run is then trimmed. Trimming a STRING was
    // the old spelling; on nodes it has to reach the first and last text node,
    // and without it the entry keeps the space the removed span left behind.
    expect(
      carveToHtml(MARKUP, { extensions: [tableOfContents(), headingNumbers()] }),
    ).toContain('<li><a href="#h"><strong>bold</strong> <code>code()</code> heading</a></li>')
  })

  it('CONTROL a plain heading renders byte-identically everywhere', () => {
    // A heading with no markup produces the same bytes it always did, in all
    // three consumers. The rows above only prove markup survives.
    expect(carveToHtml('{#h}\n# Plain', { extensions: [tableOfContents()] })).toContain(
      '<li><a href="#h">Plain</a></li>',
    )
    expect(
      carveToHtml('{#h}\n# Plain\n\nSee </#h>.\n', { extensions: [headingNumbers()] }),
    ).toContain('See <a href="#h">Section 1 - Plain</a>.')
    expect(carveToHtml('::: index\n:::\n\n:index[plain]\n', { extensions: [index()] })).toContain(
      '<li>plain ',
    )
  })

  it('a resolved crossref inside a heading does not nest an anchor in the entry', () => {
    // Raised by codex review. The first spelling rendered the cloned run through
    // a synthetic one-paragraph document, which renders OUTSIDE a link - so a
    // `heading_ref`, which the unwrap deliberately KEEPS as a node for the
    // renderers to suppress, emitted its own anchor inside the entry's anchor.
    // The run is rendered in the LINK context instead.
    const out = carveToHtml('{#intro}\n# Intro\n\n{#h}\n# See </#intro>\n', {
      extensions: [tableOfContents()],
    })
    expect(out).toContain('<li><a href="#h">See Intro</a></li>')
    expect(/<a [^>]*>(?:(?!<\/a>)[\s\S])*<a /.test(out.split('</nav>')[0]!)).toBe(false)
  })

  it('a footnote in a heading contributes nothing to derived text', () => {
    // Raised by codex review, in its second half: a DOCUMENT render emits
    // document-level output, so an inline footnote dragged a whole endnotes
    // section into the nav. The link-context inline renderer removes that, and
    // the apparatus itself is dropped from the derived run for a reason of its
    // own - a footnote reference is a pointer into the endnotes, and rendering
    // one in a second place emits a second anchor carrying the same `fn` id.
    //
    // It is also what the flatten this replaces already did: a footnote
    // reference contributes nothing to a heading's INDEX key either.
    const toc = carveToHtml('{#h}\n# H ^[note]\n', { extensions: [tableOfContents()] })
    expect(toc).toContain('<li><a href="#h">H</a></li>')
    expect(toc.split('</nav>')[0]).not.toContain('doc-endnotes')
    expect(toc.split('</nav>')[0]).not.toContain('doc-noteref')
    // The referenced form too, which reaches the run by a different node type.
    expect(
      carveToHtml('{#h}\n# H[^x]\n\n[^x]: n\n\nu[^x]\n', { extensions: [tableOfContents()] }),
    ).toContain('<li><a href="#h">H</a></li>')
  })

  it('an abbreviation is taken back to what the author wrote', () => {
    // Raised by codex review. An `abbreviation` node is a PART 9R R3 resolution
    // result, not authored content: the author wrote `HT` and the resolver
    // split the text node and attached the expansion. Cloning that into a label
    // publishes the full `<abbr title="...">` once per derived site, which is an
    // output amplification the body renderer bounds with a budget this path
    // cannot reach - it builds its nav in `beforeRender`, before that budget
    // exists.
    //
    // Taking the author's `abbr` back out is both the bounded answer and the
    // correct one, and it is byte-identical to what the flatten produced.
    const src = '*[HT]: ' + 'x'.repeat(50) + '\n\n{#h}\n# HT heading\n'
    const nav = carveToHtml(src, { extensions: [tableOfContents()] }).split('</nav>')[0]!
    expect(nav).toContain('<li><a href="#h">HT heading</a></li>')
    expect(nav).not.toContain('<abbr')
    expect(carveToHtml(src + '\nSee </#h>.\n', { extensions: [headingNumbers()] })).toContain(
      'See <a href="#h">Section 1 - HT heading</a>.',
    )
    // CONTROL: the heading itself still expands it, which is where the
    // expansion belongs.
    expect(carveToHtml(src, { extensions: [tableOfContents()] })).toContain('<h1><abbr title=')
  })

  it('the trim reaches the RUN\'s edges, not the first text node it finds', () => {
    // Raised by codex review, via a symbol. `# :ok: h` clones as
    // [symbol, text(" h")], and trimming the first TEXT NODE found anywhere ate
    // the separator, so the entry came out `:ok:h`. The trim is about the run's
    // own edges.
    expect(
      carveToHtml('{#h}\n# :ok: h', { symbols: { ok: 'OK' }, extensions: [tableOfContents()] }),
    ).toContain('<li><a href="#h">:ok: h</a></li>')
  })

  it('KNOWN LIMITATION the injected nav renders without the caller render options', () => {
    // Also raised by codex review. `tableOfContents()` builds its nav in
    // `beforeRender`, which this package's extension contract hands the document
    // and nothing else, so the inline render there cannot see a `symbols` map or
    // any other render option. The entry therefore shows the AUTHORED `:ok:`
    // where the heading shows the mapped glyph.
    //
    // Pinned rather than left to be discovered, and NOT introduced here: before
    // this clause the same document dropped the symbol from the entry entirely.
    // Threading render options into `beforeRender` is a public-API change with
    // its own ticket (markup-carve/carve-js#871); the day it lands, this row
    // moves with it.
    const out = carveToHtml('{#h}\n# :ok: h', {
      symbols: { ok: 'OK' },
      extensions: [tableOfContents()],
    })
    expect(out).toContain('<h1>OK h</h1>')
    expect(out.split('</nav>')[0]).toContain(':ok: h')
    // CONTROL the `::: toc` placement directive renders DURING the render, so
    // it picks the option up and agrees with the heading. That is the whole
    // difference between the two paths, and it is why the limitation is scoped
    // to the injected nav rather than to the module.
    expect(
      carveToHtml('::: toc\n:::\n\n{#h}\n# :ok: h', {
        symbols: { ok: 'OK' },
        extensions: [tocPlacement()],
      }).split('</nav>')[0],
    ).toContain('<li><a href="#h">OK h</a></li>')
  })

  it('a placed TOC label honors allowRawHtml', () => {
    // Raised by codex review, at P1. A heading holding raw inline HTML renders
    // escaped under `allowRawHtml: false`, and the entry built from the same
    // nodes emitted it LIVE, because the label render used default options. A
    // label rendered with defaults is not a cosmetic difference; it is the
    // caller's hardening bypassed at one seam.
    const src = '::: toc\n:::\n\n{#h}\n# H `<b>raw</b>`{=html} x\n'
    const nav = (o: Record<string, unknown>) =>
      carveToHtml(src, { extensions: [tocPlacement()], ...o }).split('</nav>')[0]!
    expect(nav({ allowRawHtml: false })).toContain('<li><a href="#h">H &lt;b&gt;raw&lt;/b&gt; x</a></li>')
    // CONTROL: with raw HTML allowed, the entry passes it through, matching the
    // heading. Without this row the fix could be a blanket escape.
    expect(nav({})).toContain('<li><a href="#h">H <b>raw</b> x</a></li>')
  })

  it('an invisible index marker contributes nothing', () => {
    // Raised by codex review. PART 9 section 8.1: an `:index[term]` marker emits
    // no visible text, so it feeds no heading slug and no derived text - the
    // flatten carried that carve-out in as many words and the node form has to
    // carry it too. Left in, the nav rendered the term VISIBLY where the heading
    // renders an empty anchor target.
    const nav = carveToHtml('{#h}\n# H :index[term] x\n', {
      extensions: [index(), tableOfContents()],
    }).split('</nav>')[0]!
    expect(nav).not.toContain('term')
    expect(nav).toContain('<a href="#h">H  x</a>')
  })

  it('an index display keeps an authored link, because the item is not an anchor', () => {
    // Raised by codex review. The link context is the CALLER's, not a property
    // of being derived: a crossref label and a TOC entry render inside an `<a>`
    // and unwrap; an index list item is not an anchor - only the backrefs after
    // the display are - so an authored link in the term survives.
    expect(
      carveToHtml('::: index\n:::\n\n:index[<https://e.com> term]\n', { extensions: [index()] }),
    ).toContain('<li><a href="https://e.com">https://e.com</a> term ')
    // CONTROL the two consumers that DO render inside an anchor still unwrap.
    const nests = (html: string) => /<a [^>]*>(?:(?!<\/a>)[\s\S])*<a /.test(html)
    expect(
      nests(carveToHtml('{#h}\n# <https://e.com> h', { extensions: [tableOfContents()] })),
    ).toBe(false)
  })
})
