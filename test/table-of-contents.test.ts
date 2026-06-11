import { describe, expect, it } from 'vitest'

import { carveToHtml, tableOfContents } from '../src/index.js'

describe('tableOfContents extension', () => {
  it('builds a nested TOC and inserts it at the top', () => {
    const src = '# Intro\n\ntext\n\n## Details\n\n# End'
    const html = carveToHtml(src, { extensions: [tableOfContents()] })
    expect(html.startsWith(
      '<nav class="toc"><ul>' +
        '<li><a href="#intro">Intro</a><ul><li><a href="#details">Details</a></li></ul></li>' +
        '<li><a href="#end">End</a></li>' +
        '</ul></nav>',
    )).toBe(true)
    // The document content still follows.
    expect(html).toContain('<h1>Intro</h1>')
  })

  it('inserts after the content when position is bottom', () => {
    // Section-wrapping keeps the last section open to EOF, so a bottom TOC
    // renders after the heading content (inside that trailing section).
    const html = carveToHtml('# A', { extensions: [tableOfContents({ position: 'bottom' })] })
    expect(html).toContain('<h1>A</h1>\n<nav class="toc"><ul><li><a href="#a">A</a></li></ul></nav>')
    expect(html.indexOf('<nav')).toBeGreaterThan(html.indexOf('<h1>A</h1>'))
  })

  it('honors minLevel and maxLevel', () => {
    const src = '# One\n\n## Two\n\n### Three'
    const html = carveToHtml(src, { extensions: [tableOfContents({ minLevel: 2, maxLevel: 2 })] })
    expect(html).toContain('<nav class="toc"><ul><li><a href="#two">Two</a></li></ul></nav>')
    expect(html).not.toContain('href="#one"')
    expect(html).not.toContain('href="#three"')
  })

  it('uses an ordered list when listType is ol', () => {
    const html = carveToHtml('# A', { extensions: [tableOfContents({ listType: 'ol' })] })
    expect(html).toContain('<nav class="toc"><ol><li><a href="#a">A</a></li></ol></nav>')
  })

  it('honors a custom cssClass and escapes heading text', () => {
    const html = carveToHtml('# A & <B>', {
      extensions: [tableOfContents({ cssClass: 'contents' })],
    })
    expect(html).toContain('<nav class="contents"><ul><li><a href="#a-b">A &amp; &lt;B&gt;</a>')
  })

  it('keeps a partially-restored level nested under its ancestor', () => {
    // ## A, #### B, ### C: C is shallower than B but deeper than A, so it must
    // stay nested under A, not become a top-level sibling.
    const html = carveToHtml('## A\n\n#### B\n\n### C', { extensions: [tableOfContents()] })
    const toc = html.slice(0, html.indexOf('</nav>'))
    // A is the only top-level <li>; B and C both sit under it.
    expect(toc).toContain('<a href="#a">A</a>')
    expect(toc.match(/<li><a href="#a"/g)?.length).toBe(1)
    expect(toc.indexOf('#c')).toBeGreaterThan(toc.indexOf('#a'))
    // The only top-level list item is A (C is not promoted to top level).
    expect(toc).toBe(
      '<nav class="toc"><ul><li><a href="#a">A</a>' +
        '<ul><li><a href="#b">B</a></li></ul>' +
        '<ul><li><a href="#c">C</a></li></ul>' +
        '</li></ul>',
    )
  })

  it('keeps a shallower-than-first heading in one root list', () => {
    // ## A then # B: B is shallower than the first heading, but must remain a
    // sibling <li> in a single root list (not open a second root <ul>).
    const html = carveToHtml('## A\n\n# B', { extensions: [tableOfContents()] })
    const toc = html.slice(0, html.indexOf('</nav>') + '</nav>'.length)
    expect(toc).toBe(
      '<nav class="toc"><ul><li><a href="#a">A</a></li><li><a href="#b">B</a></li></ul></nav>',
    )
  })

  it('coerces an unsafe listType to ul (no markup injection)', () => {
    const html = carveToHtml('# A', {
      // @ts-expect-error testing a runtime-supplied invalid value
      extensions: [tableOfContents({ listType: 'ul><script>x</script><ul' })],
    })
    expect(html).toContain('<nav class="toc"><ul><li><a href="#a">A</a></li></ul></nav>')
    expect(html).not.toContain('<script>')
  })

  it('emits nothing when there are no headings', () => {
    const html = carveToHtml('just a paragraph', { extensions: [tableOfContents()] })
    expect(html).toBe('<p>just a paragraph</p>')
  })

  it('is inert without the extension', () => {
    expect(carveToHtml('# A')).toBe('<section id="a">\n  <h1>A</h1>\n</section>')
  })
})
