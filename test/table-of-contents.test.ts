import { describe, expect, it } from 'vitest'

import { carveToHtml, tableOfContents } from '../src/index.js'

// The TOC HTML is a byte-faithful match of carve-php's TableOfContentsExtension:
// one tag per line, column 0. See src/table-of-contents.ts buildList().

describe('tableOfContents extension', () => {
  it('builds a nested TOC and inserts it at the top', () => {
    const src = '# Intro\n\ntext\n\n## Details\n\n# End'
    const html = carveToHtml(src, { extensions: [tableOfContents()] })
    expect(
      html.startsWith(
        '<nav class="toc">\n<ul>\n' +
          '<li><a href="#Intro">Intro</a>\n<ul>\n<li><a href="#Details">Details</a></li>\n</ul>\n</li>\n' +
          '<li><a href="#End">End</a></li>\n' +
          '</ul>\n</nav>',
      ),
    ).toBe(true)
    expect(html).toContain('<h1>Intro</h1>')
  })

  it('inserts after the content when position is bottom', () => {
    const html = carveToHtml('# A', { extensions: [tableOfContents({ position: 'bottom' })] })
    expect(html).toContain(
      '<h1>A</h1>\n<nav class="toc">\n<ul>\n<li><a href="#A">A</a></li>\n</ul>\n</nav>',
    )
    expect(html.indexOf('<nav')).toBeGreaterThan(html.indexOf('<h1>A</h1>'))
  })

  it('honors minLevel and maxLevel', () => {
    const src = '# One\n\n## Two\n\n### Three'
    const html = carveToHtml(src, { extensions: [tableOfContents({ minLevel: 2, maxLevel: 2 })] })
    expect(html).toContain('<nav class="toc">\n<ul>\n<li><a href="#Two">Two</a></li>\n</ul>\n</nav>')
    expect(html).not.toContain('href="#One"')
    expect(html).not.toContain('href="#Three"')
  })

  it('uses an ordered list when listType is ol', () => {
    const html = carveToHtml('# A', { extensions: [tableOfContents({ listType: 'ol' })] })
    expect(html).toContain('<nav class="toc">\n<ol>\n<li><a href="#A">A</a></li>\n</ol>\n</nav>')
  })

  it('honors a custom cssClass and escapes heading text', () => {
    const html = carveToHtml('# A & <B>', {
      extensions: [tableOfContents({ cssClass: 'contents' })],
    })
    expect(html).toContain('<nav class="contents">\n<ul>\n<li><a href="#A-B">A &amp; &lt;B&gt;</a>')
  })

  it('keeps a partially-restored level as a sibling in the same nested list', () => {
    // ## A, #### B, ### C: matching carve-php, B and C are siblings in one <ul>
    // nested under A (not two separate <ul>s).
    const html = carveToHtml('## A\n\n#### B\n\n### C', { extensions: [tableOfContents()] })
    const toc = html.slice(0, html.indexOf('</nav>') + '</nav>'.length)
    expect(toc).toBe(
      '<nav class="toc">\n<ul>\n' +
        '<li><a href="#A">A</a>\n<ul>\n' +
        '<li><a href="#B">B</a></li>\n<li><a href="#C">C</a></li>\n' +
        '</ul>\n</li>\n</ul>\n</nav>',
    )
  })

  it('keeps a shallower-than-first heading in one root list', () => {
    const html = carveToHtml('## A\n\n# B', { extensions: [tableOfContents()] })
    const toc = html.slice(0, html.indexOf('</nav>') + '</nav>'.length)
    expect(toc).toBe(
      '<nav class="toc">\n<ul>\n<li><a href="#A">A</a></li>\n<li><a href="#B">B</a></li>\n</ul>\n</nav>',
    )
  })

  it('coerces an unsafe listType to ul (no markup injection)', () => {
    const html = carveToHtml('# A', {
      // @ts-expect-error testing a runtime-supplied invalid value
      extensions: [tableOfContents({ listType: 'ul><script>x</script><ul' })],
    })
    expect(html).toContain('<nav class="toc">\n<ul>\n<li><a href="#A">A</a></li>\n</ul>\n</nav>')
    expect(html).not.toContain('<script>')
  })

  it('emits nothing when there are no headings', () => {
    const html = carveToHtml('just a paragraph', { extensions: [tableOfContents()] })
    expect(html).toBe('<p>just a paragraph</p>')
  })

  it('is inert without the extension', () => {
    expect(carveToHtml('# A')).toBe('<section id="A">\n  <h1>A</h1>\n</section>')
  })
})
