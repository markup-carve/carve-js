import { describe, expect, it } from 'vitest'

import {
  Profile,
  carveToAstJson,
  carveToHtml,
  fromAstJson,
  renderHtml,
  tableOfContents,
  toAstJson,
} from '../src/index.js'

// The TOC HTML is a byte-faithful match of carve-php's TableOfContentsExtension:
// one tag per line, column 0. See src/table-of-contents.ts buildList().

describe('tableOfContents extension', () => {
  it('builds a nested TOC and inserts it at the top', () => {
    const src = '# Intro\n\ntext\n\n## Details\n\n# End'
    const html = carveToHtml(src, { extensions: [tableOfContents()] })
    expect(
      html.startsWith(
        '<nav class="toc" aria-label="Table of contents">\n<ul>\n' +
          '<li><a href="#Intro">Intro</a>\n<ul>\n<li><a href="#Details">Details</a></li>\n</ul>\n</li>\n' +
          '<li><a href="#End">End</a></li>\n' +
          '</ul>\n</nav>',
      ),
    ).toBe(true)
    expect(html).toContain('<h1>Intro</h1>')
  })

  it('inserts after the last section when position is bottom', () => {
    // THE WHOLE DOCUMENT, not a substring. The assertion here used to be
    // `'<h1>A</h1>\n<nav class="toc" aria-label="Table of contents">'`, which matched whether the nav sat
    // inside the heading's `<section>` or after it - so a test written to pin
    // cross-impl parity could not see the one thing it differed on
    // (markup-carve/carve-js#728). A fragment that spans the `</section>` is
    // what makes the placement falsifiable.
    //
    // Byte-identical to carve-php's TableOfContentsExtension for this input.
    expect(carveToHtml('# A', { extensions: [tableOfContents({ position: 'bottom' })] })).toBe(
      '<section id="A">\n' +
        '  <h1>A</h1>\n' +
        '</section>\n' +
        '<nav class="toc" aria-label="Table of contents">\n<ul>\n<li><a href="#A">A</a></li>\n</ul>\n</nav>',
    )
  })

  it('escapes the INNERMOST section when headings nest', () => {
    // The fourth placement the ticket's re-measurement found: appended to the
    // block list, the nav landed two levels deep, so the option's output was
    // not merely wrong but unpredictable from reading the document.
    expect(
      carveToHtml('# A\n\n## B\n', { extensions: [tableOfContents({ position: 'bottom' })] }),
    ).toBe(
      '<section id="A">\n' +
        '  <h1>A</h1>\n' +
        '  <section id="B">\n' +
        '    <h2>B</h2>\n' +
        '  </section>\n' +
        '</section>\n' +
        '<nav class="toc" aria-label="Table of contents">\n<ul>\n<li><a href="#A">A</a>\n<ul>\n' +
        '<li><a href="#B">B</a></li>\n</ul>\n</li>\n</ul>\n</nav>',
    )
  })

  it('sits after the endnotes, which are a section too', () => {
    // "After the last section" includes `<section role="doc-endnotes">`.
    // carve-php arrives at the same place from the other end: its TOC is a
    // render listener appending to the FINISHED html string, so the nav is the
    // last thing in the output whatever the document contains.
    const html = carveToHtml('# A\n\nbody[^f]\n\n[^f]: note\n', {
      extensions: [tableOfContents({ position: 'bottom' })],
    })

    expect(html.indexOf('<nav class="toc" aria-label="Table of contents">')).toBeGreaterThan(html.indexOf('role="doc-endnotes"'))
    expect(html.endsWith('</ul>\n</nav>')).toBe(true)
  })

  it('CONTROL: position top is unchanged, and never had the problem', () => {
    // Nothing has opened a section yet when a top TOC is inserted, which is the
    // accidental reason it was already at document level. No mutation of the
    // trailer path can move this row.
    expect(carveToHtml('# A', { extensions: [tableOfContents({ position: 'top' })] })).toBe(
      '<nav class="toc" aria-label="Table of contents">\n<ul>\n<li><a href="#A">A</a></li>\n</ul>\n</nav>\n' +
        '<section id="A">\n' +
        '  <h1>A</h1>\n' +
        '</section>',
    )
  })

  it('CONTROL: a document with no headings puts the nav nowhere new', () => {
    // No headings means no entries and no nav at all - the placement question
    // does not arise. Here so the "four placements" table is closed rather than
    // left with an untested row.
    expect(carveToHtml('body\n', { extensions: [tableOfContents({ position: 'bottom' })] })).toBe(
      '<p>body</p>',
    )
  })

  it('honors minLevel and maxLevel', () => {
    const src = '# One\n\n## Two\n\n### Three'
    const html = carveToHtml(src, { extensions: [tableOfContents({ minLevel: 2, maxLevel: 2 })] })
    expect(html).toContain('<nav class="toc" aria-label="Table of contents">\n<ul>\n<li><a href="#Two">Two</a></li>\n</ul>\n</nav>')
    expect(html).not.toContain('href="#One"')
    expect(html).not.toContain('href="#Three"')
  })

  it('uses an ordered list when listType is ol', () => {
    const html = carveToHtml('# A', { extensions: [tableOfContents({ listType: 'ol' })] })
    expect(html).toContain('<nav class="toc" aria-label="Table of contents">\n<ol>\n<li><a href="#A">A</a></li>\n</ol>\n</nav>')
  })

  it('honors a custom cssClass and escapes heading text', () => {
    const html = carveToHtml('# A & <B>', {
      extensions: [tableOfContents({ cssClass: 'contents' })],
    })
    expect(html).toContain('<nav class="contents" aria-label="Table of contents">\n<ul>\n<li><a href="#A-B">A &amp; &lt;B&gt;</a>')
  })

  it('keeps a partially-restored level as a sibling in the same nested list', () => {
    // ## A, #### B, ### C: matching carve-php, B and C are siblings in one <ul>
    // nested under A (not two separate <ul>s).
    const html = carveToHtml('## A\n\n#### B\n\n### C', { extensions: [tableOfContents()] })
    const toc = html.slice(0, html.indexOf('</nav>') + '</nav>'.length)
    expect(toc).toBe(
      '<nav class="toc" aria-label="Table of contents">\n<ul>\n' +
        '<li><a href="#A">A</a>\n<ul>\n' +
        '<li><a href="#B">B</a></li>\n<li><a href="#C">C</a></li>\n' +
        '</ul>\n</li>\n</ul>\n</nav>',
    )
  })

  it('keeps a shallower-than-first heading in one root list', () => {
    const html = carveToHtml('## A\n\n# B', { extensions: [tableOfContents()] })
    const toc = html.slice(0, html.indexOf('</nav>') + '</nav>'.length)
    expect(toc).toBe(
      '<nav class="toc" aria-label="Table of contents">\n<ul>\n<li><a href="#A">A</a></li>\n<li><a href="#B">B</a></li>\n</ul>\n</nav>',
    )
  })

  it('coerces an unsafe listType to ul (no markup injection)', () => {
    const html = carveToHtml('# A', {
      // @ts-expect-error testing a runtime-supplied invalid value
      extensions: [tableOfContents({ listType: 'ul><script>x</script><ul' })],
    })
    expect(html).toContain('<nav class="toc" aria-label="Table of contents">\n<ul>\n<li><a href="#A">A</a></li>\n</ul>\n</nav>')
    expect(html).not.toContain('<script>')
  })

  it('emits nothing when there are no headings', () => {
    const html = carveToHtml('just a paragraph', { extensions: [tableOfContents()] })
    expect(html).toBe('<p>just a paragraph</p>')
  })

  it('is inert without the extension', () => {
    expect(carveToHtml('# A')).toBe('<section id="A">\n  <h1>A</h1>\n</section>')
  })

  it('wraps the TOC in a closed <details> when collapsible', () => {
    const src = '# One\n\n## Two'
    const html = carveToHtml(src, { extensions: [tableOfContents({ collapsible: true })] })
    // Closed by default, list directly inside <details>, no <nav>.
    expect(
      html.startsWith(
        '<details class="toc">\n<summary>Table of Contents</summary>\n<ul>\n' +
          '<li><a href="#One">One</a>\n<ul>\n<li><a href="#Two">Two</a></li>\n</ul>\n</li>\n' +
          '</ul>\n</details>',
      ),
    ).toBe(true)
    expect(html).not.toContain('<nav')
    expect(html).not.toContain('<details class="toc" open')
  })

  it('honors open and a custom summary when collapsible', () => {
    const html = carveToHtml('# One', {
      extensions: [tableOfContents({ collapsible: true, summary: 'Contents', open: true })],
    })
    expect(html.startsWith('<details class="toc" open>\n<summary>Contents</summary>')).toBe(true)
  })

  it('escapes the collapsible summary', () => {
    const html = carveToHtml('# One', {
      extensions: [tableOfContents({ collapsible: true, summary: 'A & <b>B</b>' })],
    })
    expect(html).toContain('<summary>A &amp; &lt;b&gt;B&lt;/b&gt;</summary>')
    expect(html).not.toContain('<b>B</b>')
  })

  it('leaves the plain nav unchanged when not collapsible', () => {
    const html = carveToHtml('# One', { extensions: [tableOfContents()] })
    expect(html.startsWith('<nav class="toc" aria-label="Table of contents">')).toBe(true)
    expect(html).not.toContain('<details')
  })
})

/*
 * The trailer mark has to survive the PROFILE, which runs between the extension
 * that sets it and the render that reads it.
 *
 * The mark is object IDENTITY - `Document.trailerBlocks` holds references to
 * nodes in `children` - and a profile that denies raw HTML REPLACES the node
 * with a paragraph of escaped text. A new object, so the mark pointed at a node
 * no longer in the tree and the nav went straight back inside the last section:
 * markup-carve/carve-js#728 all over again, reachable only under a profile and
 * invisible to every test that renders without one.
 */
describe('a bottom TOC stays at document level under a profile', () => {
  const src = '# A\n'
  const bottom = [tableOfContents({ position: 'bottom' })]

  it('places the DEGRADED text after the section, not inside it', () => {
    // `article` denies `raw_block`, so what is emitted is the escaped source of
    // the nav rather than the nav. Where it sits is still this ticket's
    // question, and the answer must not depend on whether raw HTML was allowed.
    expect(carveToHtml(src, { extensions: bottom, profile: Profile.article() })).toBe(
      '<section id="A">\n' +
        '  <h1>A</h1>\n' +
        '</section>\n' +
        '<p>&lt;nav class="toc" aria-label="Table of contents"&gt;<br>\n' +
        '&lt;ul&gt;<br>\n' +
        '&lt;li&gt;&lt;a href="#A"&gt;A&lt;/a&gt;&lt;/li&gt;<br>\n' +
        '&lt;/ul&gt;<br>\n' +
        '&lt;/nav&gt;</p>',
    )
  })

  it('emits nothing extra when the profile STRIPS the node instead', () => {
    // The other action on the same denial. A stripped trailer must leave no
    // trace: a mark pointing at a node that is no longer a child of the document
    // is stale, and rendering it anyway would resurrect content the profile
    // removed - the one outcome worse than misplacing it.
    expect(
      carveToHtml(src, {
        extensions: bottom,
        profile: Profile.article().onDisallowed(Profile.ACTION_STRIP),
      }),
    ).toBe('<section id="A">\n  <h1>A</h1>\n</section>')
  })

  it('CONTROL: a profile that allows raw HTML is the unprofiled answer', () => {
    // `full` denies nothing, so the node is never replaced and the mark is
    // never remapped. Green whether or not the remap exists.
    expect(carveToHtml(src, { extensions: bottom, profile: Profile.full() })).toBe(
      carveToHtml(src, { extensions: bottom }),
    )
  })
})

/*
 * The mark does NOT cross the wire, and that is a stated limitation rather than
 * an oversight.
 *
 * `Document.trailerBlocks` is runtime-only, like `footnoteDefPos`, so a caller
 * that serializes a tree an extension has already transformed and renders the
 * result gets the nav back inside the last section. Carrying it would mean new
 * PART 12 vocabulary - the spec's to name and all three engines' to implement -
 * and the ruling on markup-carve/carve-js#728 authorized the placement, not an
 * addition to the format.
 *
 * Written as two assertions rather than one so the boundary is visible: §6 is
 * UNAFFECTED, because a field that was never serialized cannot make a round trip
 * lossy. When the spec does name a trailer, this block is what to delete.
 */
describe('the trailer mark is runtime-only', () => {
  const src = '# A\n'
  const bottom = [tableOfContents({ position: 'bottom' })]

  it('leaves the §6 round trip an identity', () => {
    const wire = carveToAstJson(src, { extensions: bottom })

    expect(JSON.stringify(toAstJson(fromAstJson(JSON.parse(JSON.stringify(wire)))))).toBe(
      JSON.stringify(wire),
    )
  })

  it('but a render THROUGH the wire loses the placement', () => {
    // The render-after-ingest family, not a serializer defect. Asserted as the
    // whole fragment so the day this stops being true is a failure here rather
    // than a silent improvement nobody notices.
    const wire = carveToAstJson(src, { extensions: bottom })

    expect(renderHtml(fromAstJson(JSON.parse(JSON.stringify(wire))))).toBe(
      '<section id="A">\n' +
        '  <h1>A</h1>\n' +
        '  <nav class="toc" aria-label="Table of contents">\n<ul>\n<li><a href="#A">A</a></li>\n</ul>\n</nav>\n' +
        '</section>',
    )
    expect(renderHtml(fromAstJson(JSON.parse(JSON.stringify(wire))))).not.toBe(
      carveToHtml(src, { extensions: bottom }),
    )
  })
})
