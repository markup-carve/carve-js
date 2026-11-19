import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import * as api from '../public/index.ts'
import * as extensions from '../public/extensions.ts'
import { CarveOptionError, parse, render, renderWithDiagnostics } from '../public/index.ts'
import {
  autolink, externalLinks, headingLevelShift, headingNumbers, headingPermalinks, headingReference, linkPolicy,
  tableOfContents, tocPlacement, tocRenderers,
} from '../public/extensions.ts'

const DOC = '= Intro\n\nText.\n\n== Usage\n\n=== Deep\n\n== Next\n'

describe('the extensions entry', () => {
  it('exports the navigation extensions, which the core entry does not load', () => {
    expect(Object.keys(extensions)).toEqual(expect.arrayContaining([
      'autolink', 'externalLinks', 'headingLevelShift', 'headingNumbers', 'headingPermalinks', 'headingReference',
      'linkPolicy', 'tableOfContents', 'tocPlacement', 'tocRenderers',
    ]))
    expect(Object.keys(api)).not.toContain('tableOfContents')
  })

  it('runs the examples of its guide', async () => {
    const root = join(import.meta.dirname, '..')
    const guide = readFileSync(join(root, 'docs/extensions-navigation.md'), 'utf8')
    const examples = [...guide.matchAll(/^```ts\n([\s\S]*?)^```$/gmu)].map((match) => match[1]!)
    expect(examples.length).toBeGreaterThan(0)
    const dir = mkdtempSync(join(tmpdir(), 'carve-extensions-guide-'))
    for (const [index, example] of examples.entries()) {
      const file = join(dir, `example-${index}.ts`)
      writeFileSync(file, example
        .replaceAll("'@markup-carve/carve/extensions'", JSON.stringify(pathToFileURL(join(root, 'public/extensions.ts')).href))
        .replaceAll("'@markup-carve/carve'", JSON.stringify(pathToFileURL(join(root, 'public/index.ts')).href)))
      await import(pathToFileURL(file).href)
    }
  })

  it('refuses a document transform that is not a function', () => {
    const bad = { ...tableOfContents(), documentTransform: 'x' }
    expect(() => render('a', { extensions: [bad as never] })).toThrow(CarveOptionError)
  })

  it('leaves the authored tree and a render without them unchanged', () => {
    const tree = parse(DOC)
    const copy = structuredClone(tree)
    render(tree, { extensions: [tableOfContents(), headingNumbers(), headingPermalinks()], renderers: tocRenderers })
    expect(tree).toEqual(copy)
    expect(render(DOC)).not.toContain('toc')
  })
})

describe('tableOfContents', () => {
  const list = '<ul>\n  <li><a href="#Intro">Intro</a>\n    <ul>\n      <li><a href="#Usage">Usage</a>\n        <ul>\n' +
    '          <li><a href="#Deep">Deep</a></li>\n        </ul>\n      </li>\n      <li><a href="#Next">Next</a></li>\n' +
    '    </ul>\n  </li>\n</ul>'
  const indented = list.split('\n').map((line) => `  ${line}`).join('\n')

  it('writes a named nav of nested links at the top', () => {
    const html = render(DOC, { extensions: [tableOfContents()], renderers: tocRenderers })
    expect(html.startsWith(`<nav class="toc" aria-label="Table of contents">\n${indented}\n</nav>\n<section id="Intro">`)).toBe(true)
  })

  it('writes the same self-contained nav in static mode (C2-X-052)', () => {
    const options = { extensions: [tableOfContents()], renderers: tocRenderers }
    expect(render(DOC, { ...options, mode: 'static' })).toBe(render(DOC, options))
  })

  it('writes its fallback list without the renderer (C2-X-035)', () => {
    const result = renderWithDiagnostics(DOC, { extensions: [tableOfContents()] })
    expect(result.html.startsWith(`<div class="toc">\n${indented}\n</div>\n`)).toBe(true)
    expect(result.diagnostics.map((entry) => entry.code)).toEqual(['extension-fallback-rendered'])
  })

  it('takes the level window, list type, class, position and disclosure from its options', () => {
    const html = render(DOC, {
      extensions: [tableOfContents({ minLevel: 2, maxLevel: 2, listType: 'ol', cssClass: 'contents', position: 'bottom' })],
      renderers: tocRenderers,
    })
    // The 0.2 sections close at the end of the document, so the last section holds a table placed at the bottom.
    expect(html.endsWith('    <nav class="contents" aria-label="Table of contents">\n      <ol>\n' +
      '        <li><a href="#Usage">Usage</a></li>\n        <li><a href="#Next">Next</a></li>\n      </ol>\n    </nav>\n' +
      '  </section>\n</section>')).toBe(true)
    const details = render('= A\n', { extensions: [tableOfContents({ collapsible: true, open: true, summary: 'On <this> page' })],
      renderers: tocRenderers })
    expect(details.startsWith('<details class="toc" open>\n  <summary>On &lt;this&gt; page</summary>\n' +
      '  <ul>\n    <li><a href="#A">A</a></li>\n  </ul>\n</details>\n')).toBe(true)
  })

  it('names the nav from the tocNav label, and an empty label writes no name', () => {
    const named = render('= A\n', { extensions: [tableOfContents()], renderers: tocRenderers, labels: { tocNav: 'Contents' } })
    expect(named.startsWith('<nav class="toc" aria-label="Contents">')).toBe(true)
    const bare = render('= A\n', { extensions: [tableOfContents()], renderers: tocRenderers, labels: { tocNav: '' } })
    expect(bare.startsWith('<nav class="toc">')).toBe(true)
  })

  it('inserts nothing without headings', () => {
    expect(render('text\n', { extensions: [tableOfContents()], renderers: tocRenderers })).toBe('<p>text</p>')
  })

  it('lists authored ids and keeps notes and ids out of the entry text', () => {
    const html = render('{#start}\n= A [b]{#inner} c[^n]\n\n[^n]: note\n', { extensions: [tableOfContents()], renderers: tocRenderers })
    expect(html).toContain('<li><a href="#start">A <span>b</span> c</a></li>')
  })
})

describe('tocPlacement', () => {
  it('writes a nav at the directive with the window of its attributes', () => {
    const html = render(`${DOC}\n{depth=2 .side}\n::: toc\n:::\n`, { extensions: [tocPlacement()], renderers: tocRenderers })
    expect(html).toContain('    <nav class="toc side" aria-label="Table of contents">\n      <ul>\n' +
      '        <li><a href="#Intro">Intro</a>\n          <ul>\n            <li><a href="#Usage">Usage</a></li>\n' +
      '            <li><a href="#Next">Next</a></li>\n          </ul>\n        </li>\n      </ul>\n    </nav>')
    expect(html).not.toContain('depth=')
  })

  it('reads from and to, and names the nav by its title', () => {
    const html = render(`${DOC}\n{from=3 to=2}\n::: toc "On this page"\n:::\n`, { extensions: [tocPlacement()], renderers: tocRenderers })
    expect(html).toContain('<nav class="toc" aria-labelledby="toc-title-1">\n      <p class="admonition-title" id="toc-title-1">On this page</p>\n' +
      '      <ul>\n        <li><a href="#Usage">Usage</a>\n')
    expect(html).not.toContain('#Intro')
  })

  it('lists headings inside containers', () => {
    const html = render('::: note\n= Inside\n:::\n\n::: toc\n:::\n', { extensions: [tocPlacement()], renderers: tocRenderers })
    expect(html).toContain('<li><a href="#Inside">Inside</a></li>')
  })

  it('writes the directive with the list as its fallback, and the core div without the extension', () => {
    const fallback = render('= A\n\n::: toc\n:::\n', { extensions: [tocPlacement()] })
    expect(fallback).toContain('<div class="toc">\n    <ul>\n      <li><a href="#A">A</a></li>\n    </ul>\n  </div>')
    expect(fallback).not.toContain('<div class="toc">\n    <div')
    expect(render('= A\n\n::: toc\n:::\n')).toContain('<div class="toc">')
    expect(render('= A\n\n::: toc\n:::\n')).not.toContain('<ul>')
  })

  it('keeps blocks written inside the directive before the nav', () => {
    const html = render('= A\n\n::: toc\nIntro text.\n:::\n', { extensions: [tocPlacement()], renderers: tocRenderers })
    expect(html).toContain('  <p>Intro text.</p>\n  <nav class="toc"')
  })
})

describe('headingPermalinks', () => {
  it('appends an anchor to its own id and keeps the id', () => {
    expect(render('= My Heading\n', { extensions: [headingPermalinks()] })).toBe(
      '<section id="My-Heading">\n  <h1>My Heading <a href="#My-Heading" class="permalink" aria-label="Permalink">¶</a></h1>\n</section>')
  })

  it('takes the symbol, class, label, levels, position, hover and copy hook from its options', () => {
    const html = render('= A\n\n== B\n', { extensions: [headingPermalinks({ symbol: '#', cssClass: 'p', ariaLabel: 'Link',
      levels: [2], prepend: true, showOnHover: true, copyToClipboard: true })] })
    expect(html).toContain('<h1>A</h1>')
    expect(html).toContain('<h2><span class="permalink-wrapper permalink-hover"><a href="#B" class="p" aria-label="Link" ' +
      'data-permalink-copy="">#</a></span> B</h2>')
  })

  it('keeps references to the heading resolved', () => {
    const html = render('= A\n\nSee [A][] and </#A>.\n', { extensions: [headingPermalinks()] })
    expect(html).toContain('<p>See <a href="#A">A</a> and <a href="#A">A</a>.</p>')
  })
})

describe('headingNumbers', () => {
  it('numbers the sections and writes cross-references with the number', () => {
    const html = render(`${DOC}\nSee </#Deep>.\n`, { extensions: [headingNumbers()] })
    expect(html).toContain('<h1><span class="section-number">1</span> Intro</h1>')
    expect(html).toContain('<h3><span class="section-number">1.1.1</span> Deep</h3>')
    expect(html).toContain('<h2><span class="section-number">1.2</span> Next</h2>')
    expect(html).toContain('<section id="Deep">')
    expect(html).toContain('<p>See <a href="#Deep">Section 1.1.1 - Deep</a>.</p>')
  })

  it('skips quoted, unnumbered and higher headings, and reads the label and crossref options', () => {
    const src = '= Title\n\n== A\n\n{.unnumbered}\n== B\n\n> = Quoted\n\n== C\n\nSee </#C> and </#B>.\n'
    const html = render(src, { extensions: [headingNumbers({ minLevel: 2, label: '§', crossref: 'number' })] })
    expect(html).toContain('<h1>Title</h1>')
    expect(html).toContain('<h2><span class="section-number">1</span> A</h2>')
    expect(html).toContain('<h2 class="unnumbered">B</h2>')
    expect(html).toContain('<h1 id="Quoted">Quoted</h1>')
    expect(html).toContain('<h2><span class="section-number">2</span> C</h2>')
    expect(html).toContain('See <a href="#C">§ 2</a> and <a href="#B">B</a>.')
    expect(render(src, { extensions: [headingNumbers({ crossref: 'title' })] })).toContain('See <a href="#C">C</a>')
  })

  it('leaves a reference with an explicit display mode other than title to the core renderer', () => {
    const tree = parse('== C\n\nSee </#C>.\n')
    const para = tree.children.find((n) => n.type === 'paragraph') as { children: { type: string, display?: string }[] }
    const xref = para.children.find((n) => n.type === 'xref')!
    xref.display = 'page'
    const html = render(tree, { extensions: [headingNumbers()] })
    expect(html).not.toContain('Section 1 - C')
  })

  it('keeps the number out of a table of contents', () => {
    const html = render('= A\n', { extensions: [headingNumbers(), tableOfContents()], renderers: tocRenderers })
    expect(html).toContain('<li><a href="#A">A</a></li>')
  })
})

describe('headingLevelShift', () => {
  it('moves headings down, to at most level 6', () => {
    expect(render('= A\n\n====== F\n', { extensions: [headingLevelShift()] })).toBe(
      '<section id="A">\n  <h2>A</h2>\n  <section id="F">\n    <h6>F</h6>\n  </section>\n</section>')
    expect(render('= A\n', { extensions: [headingLevelShift({ shift: 9 })] })).toContain('<h6>A</h6>')
    expect(render('= A\n', { extensions: [headingLevelShift({ shift: -2 })] })).toContain('<h1>A</h1>')
  })
})

describe('headingReference', () => {
  it('gives a class to references a heading resolves, not to those a definition resolves', () => {
    const html = render('= Setup\n\n[Setup][] [here][Setup] [Doc][]\n\n[Doc]: https://x.org\n', { extensions: [headingReference()] })
    expect(html).toContain('<a href="#Setup" class="heading-ref">Setup</a> <a href="#Setup" class="heading-ref">here</a> ' +
      '<a href="https://x.org">Doc</a>')
  })

  it('still finds the references after a transform that edits the headings', () => {
    const html = render('= Setup\n\n[Setup][]\n', { extensions: [headingNumbers(), headingReference({ cssClass: 'a b' })] })
    expect(html).toContain('<a href="#Setup" class="a b">Setup</a>')
  })
})

describe('externalLinks', () => {
  it('sets target and rel on links and autolinks to http and https', () => {
    const html = render('[a](https://x.org) <http://y.org> [b](/local) [c](#top)\n', { extensions: [externalLinks()] })
    expect(html).toBe('<p><a href="https://x.org" rel="noopener noreferrer" target="_blank">a</a> ' +
      '<a href="http://y.org" rel="noopener noreferrer" target="_blank">http://y.org</a> <a href="/local">b</a> <a href="#top">c</a></p>')
  })

  it('replaces an authored target and reads its options', () => {
    const html = render('[a](https://x.org){TARGET=self}\n', { extensions: [externalLinks({ target: '', rel: 'noopener', nofollow: true })] })
    expect(html).toBe('<p><a href="https://x.org" rel="noopener nofollow">a</a></p>')
  })
})

describe('linkPolicy', () => {
  it('writes a refused link, autolink or image as its text and adds rel to the others', () => {
    const src = '[a](https://bad.org/x) <https://sub.bad.org> ![pic](https://bad.org/i.png) [b](https://ok.org)\n'
    const html = render(src, { extensions: [linkPolicy({ deniedDomains: ['bad.org'], rel: ['nofollow', 'ugc'] })] })
    expect(html).toBe('<p>a https://sub.bad.org pic <a href="https://ok.org" rel="nofollow ugc">b</a></p>')
  })

  it('allows only internal links against the base host', () => {
    const src = '[a](https://me.org/x) [b](https://you.org) [c](/p) [d](//you.org/x)\n'
    const html = render(src, { extensions: [linkPolicy({ allowExternal: false, baseHost: 'ME.org.' })] })
    expect(html).toBe('<p><a href="https://me.org/x">a</a> b <a href="/p">c</a> d</p>')
    expect(render('[c](/p) [e](#x)\n', { extensions: [linkPolicy({ allowInternal: false })] })).toBe('<p>c e</p>')
  })

  it('reads a host as a browser does, and treats a bare relative path as internal', () => {
    const numeric = render('[a](http://2130706433/) [b](http://0x7f.0.0.1/x) [c](https://ok.org)\n',
      { extensions: [linkPolicy({ deniedDomains: ['127.0.0.1'] })] })
    expect(numeric).toBe('<p>a b <a href="https://ok.org">c</a></p>')
    expect(render('[x](doc/page) [y](a/b:c)\n', { extensions: [linkPolicy({ allowInternal: false })] })).toBe('<p>x y</p>')
  })

  it('reads the allowed domains and schemes', () => {
    const src = '[a](https://docs.ok.org) [b](https://other.org) [m](mailto:x@ok.org)\n'
    expect(render(src, { extensions: [linkPolicy({ allowedDomains: ['ok.org'] })] })).toBe(
      '<p><a href="https://docs.ok.org">a</a> b <a href="mailto:x@ok.org">m</a></p>')
    expect(render(src, { extensions: [linkPolicy({ allowedSchemes: ['https'] })] })).toBe(
      '<p><a href="https://docs.ok.org">a</a> <a href="https://other.org">b</a> m</p>')
  })
})

describe('autolink', () => {
  it('links bare URLs and email addresses, leaving trailing punctuation outside', () => {
    expect(render('Visit https://x.org/a. Mail a@b.co, or mailto:c@d.org!\n', { extensions: [autolink()] })).toBe(
      '<p>Visit <a href="https://x.org/a">https://x.org/a</a>. Mail <a href="mailto:a@b.co">a@b.co</a>, or ' +
      '<a href="mailto:c@d.org">mailto:c@d.org</a>!</p>')
  })

  it('leaves code, links and words that only contain a scheme alone', () => {
    const src = '`https://x.org` [https://y.org](/p) xhttps://z.org\n'
    expect(render(src, { extensions: [autolink()] })).toBe(render(src))
  })

  it('reads the allowed schemes', () => {
    expect(render('http://x.org https://y.org a@b.co\n', { extensions: [autolink({ allowedSchemes: ['https'] })] })).toBe(
      '<p>http://x.org <a href="https://y.org">https://y.org</a> a@b.co</p>')
  })
})
