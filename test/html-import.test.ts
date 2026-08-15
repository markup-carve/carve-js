import { describe, expect, it } from 'vitest'
import { HtmlImportLimitError, carveToHtml, htmlToAst, htmlToCarve, semanticSpan } from '../src/index.js'

describe('HTML import', () => {
  it('builds the AST and delegates source generation to the canonical writer', () => {
    const result = htmlToCarve('<h1>Hello <em>world</em></h1><p>A <a href="https://example.com">link</a>.</p>')
    expect(result.value).toBe('# Hello /world/\n\nA [link](https://example.com).\n')
    expect(result.report.diagnostics).toEqual([])
  })

  it('reads a footer in a blockquote as an ordinary quoted block', () => {
    const result = htmlToCarve('<blockquote><p>To be</p><footer>Hamlet</footer></blockquote>')
    expect(result.value).toBe('> To be\n>\n> Hamlet\n')
  })

  it('reads a figure wrapping a quote as a captioned figure', () => {
    const result = htmlToAst('<figure><blockquote><p>To be</p></blockquote><figcaption>Hamlet</figcaption></figure>')
    expect(result.value.children).toMatchObject([
      {
        type: 'figure',
        target: { type: 'block_quote', children: [{ type: 'paragraph' }] },
        caption: [{ type: 'text', value: 'Hamlet' }],
      },
    ])
  })

  it('drops active content and reports every lossy decision', () => {
    const result = htmlToAst('<p onclick="evil()">safe<script>alert(1)</script><span title="lost"> text</span></p>')
    expect(result.value.children).toMatchObject([{ type: 'paragraph', children: [{ type: 'text', value: 'safe' }, { type: 'span' }] }])
    expect(result.report.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      'attribute-dropped', 'element-dropped',
    ])
  })

  it('keeps portable attributes in semantic mode', () => {
    const result = htmlToCarve('<p id="lead" class="intro" data-x="1">Text</p>', { mode: 'semantic' })
    expect(result.value).toContain('{#lead .intro data-x=1}')
  })

  it('preserves unsupported trusted inline markup only in roundtrip mode', () => {
    // `<ruby>`, not `<kbd>`: the seven semantic elements stopped being
    // unsupported in carve#1140 and are spelled in every mode now, so using one
    // here would test the mapping rather than the raw-HTML fallback.
    const result = htmlToAst('<p><ruby>x</ruby></p>', { mode: 'roundtrip' })
    expect(result.value.children[0]).toMatchObject({ children: [{ type: 'raw_inline', format: 'html', content: '<ruby>x</ruby>' }] })
    expect(result.report.diagnostics[0]?.code).toBe('raw-preserved')
  })

  it('enforces resource limits with a typed error', () => {
    expect(() => htmlToAst('<p>x</p>', { maxNodes: 1 })).toThrow(HtmlImportLimitError)
    expect(() => htmlToAst('<p onclick="x()">x</p>', { maxDiagnostics: 0 })).toThrow(HtmlImportLimitError)
  })
})

/*
 * The seven elements PART 9 §9 and §10 spell as a span attribute (carve#1140).
 * Each one used to unwrap to its text, so `<kbd>Tab</kbd>` came back as `Tab`
 * and an `<abbr title="…">` lost the expansion with the tag.
 *
 * Asserted on the EXACT emitted source rather than on containment: a mapping
 * that merely glues the text together passes a `toContain` and fails the claim.
 */
describe('semantic elements on import', () => {
  const carve = (html: string) => htmlToCarve(html).value.trim()
  const codes = (html: string) => htmlToCarve(html).report.diagnostics.map((d) => d.code)

  it('spells the three core names as the compact span attribute', () => {
    expect(carve('<p>Press <kbd>Tab</kbd></p>')).toBe('Press [Tab]{kbd}')
    expect(carve('<p><abbr title="HyperText">HTML</abbr></p>')).toBe('[HTML]{abbr=HyperText}')
    expect(carve('<p><time datetime="2026-01-01">today</time></p>')).toBe('[today]{time=2026-01-01}')
  })

  it('spells the four the SemanticSpan extension adds', () => {
    expect(carve('<p><samp>out</samp></p>')).toBe('[out]{samp}')
    expect(carve('<p><var>v</var></p>')).toBe('[v]{var}')
    expect(carve('<p><cite>C</cite></p>')).toBe('[C]{cite}')
    expect(carve('<p><dfn title="Cascading Style Sheets">CSS</dfn></p>')).toBe('[CSS]{dfn="Cascading Style Sheets"}')
  })

  it('takes the value from the attribute each name carries it in', () => {
    // `title` for `abbr` and `dfn`, `datetime` for `time`, and the value is
    // CONSUMED - keeping it as a `title` key too would put the same attribute
    // on the element twice.
    expect(carve('<p><abbr title="y">A</abbr></p>')).toBe('[A]{abbr=y}')
    expect(codes('<p><time datetime="2026-01-01">t</time></p>')).toEqual([])
  })

  it('gives the bare boolean when the element carries no value', () => {
    // PART 11 §6c. The four value-less names have no source attribute at all,
    // and `abbr`/`time` land here when theirs is absent.
    expect(carve('<p><abbr>HTML</abbr></p>')).toBe('[HTML]{abbr}')
    expect(carve('<p><time>today</time></p>')).toBe('[today]{time}')
  })

  it('rides leftover attributes on the same span', () => {
    expect(carve('<p><abbr class="x" id="z" title="y">A</abbr></p>')).toBe('[A]{#z .x abbr=y}')
  })

  it('nests, because the compact form does', () => {
    expect(carve('<p><kbd><kbd>Ctrl</kbd>+<kbd>C</kbd></kbd></p>')).toBe('[[Ctrl]{kbd}+[C]{kbd}]{kbd}')
  })

  it('stops reporting the loss, because there is no longer one', () => {
    for (const html of ['<p><kbd>x</kbd></p>', '<p><samp>x</samp></p>', '<p><time datetime="X">x</time></p>']) {
      expect(codes(html)).toEqual([])
    }
  })

  // The ruling settles `safe` explicitly: none of the seven is active content,
  // so there is nothing for it to withhold. `roundtrip` follows by construction
  // rather than by a mode branch - it raw-preserves only what Carve CANNOT
  // express, which is why `<mark>` and `<em>` are already mapped in it too.
  it('maps identically in all three modes', () => {
    const html = '<p>Press <kbd>Tab</kbd> for <abbr title="H">A</abbr></p>'
    const expected = 'Press [Tab]{kbd} for [A]{abbr=H}'
    for (const mode of ['safe', 'semantic', 'roundtrip'] as const) {
      expect(htmlToCarve(html, { mode }).value.trim()).toBe(expected)
    }
  })

  /*
   * The controls. Each is a claim the mapping must NOT reach, and each is a
   * different reason: `mark` and inline `code` have their own syntax and were
   * retired from the semantic registry, and `<pre><code>` is a block.
   */
  it('leaves mark, inline code and a code block alone', () => {
    expect(carve('<p><mark>m</mark></p>')).toBe('=m=')
    expect(carve('<p><code>c</code></p>')).toBe('`c`')
    expect(carve('<pre><code class="language-js">x()</code></pre>')).toBe('``` js\nx()\n```')
  })

  /*
   * The tier consequence, shown rather than implied. `kbd` is core, so it
   * round-trips through a core render byte for byte. `samp` is the extension's,
   * so a core render returns the attribute rather than the element - still
   * strictly better than the unwrap it replaces, where the semantic was gone
   * altogether, but not a full round trip and not written here as one.
   */
  it('round-trips a core name exactly, and an extension name as an attribute', () => {
    expect(carveToHtml(carve('<p>Press <kbd>Tab</kbd></p>'))).toBe('<p>Press <kbd>Tab</kbd></p>')

    const samp = carve('<p><samp>out</samp></p>')
    expect(carveToHtml(samp)).toBe('<p><span samp="">out</span></p>')
    expect(carveToHtml(samp, { extensions: [semanticSpan()] })).toBe('<p><samp>out</samp></p>')
  })
})

/*
 * An authored `scope` is only worth importing where position cannot explain it
 * (markup-carve/carve-js#1032). The renderer derives `col` in the leading
 * header run and `row` below it, so importing those writes the generator's own
 * output back as if the author had typed it - the bug carve-php fixed alongside
 * markup-carve/carve-php#1234.
 *
 * The pairs are the point: each kept value has a dropped twin, because "keeps
 * scope" and "keeps only what position cannot explain" are different claims.
 */
describe('table cell scope on import', () => {
  const carve = (html: string) => htmlToCarve(html).value.trim()
  const codes = (html: string) => htmlToCarve(html).report.diagnostics.map((d) => d.code)

  it('drops a scope the renderer derives from position', () => {
    expect(carve('<table><thead><tr><th scope="col">A</th></tr></thead><tbody><tr><td>1</td></tr></tbody></table>'))
      .toBe('|=A|\n| 1 |')
    expect(carve('<table><tbody><tr><th scope="row">A</th><td>1</td></tr></tbody></table>')).toBe('|=A| 1 |')
  })

  it('keeps a scope position cannot explain, and it round-trips', () => {
    const source = carve('<table><thead><tr><th scope="colgroup">A</th></tr></thead><tbody><tr><td>1</td></tr></tbody></table>')
    expect(source).toBe('|{scope=colgroup}A|\n|---|\n| 1 |')
    expect(carveToHtml(source)).toContain('<th scope="colgroup">A</th>')
  })

  it('reports the one it cannot spell instead of trading the header for it', () => {
    // `header_cell = '=', …` has no attribute slot - only `data_cell` does - so
    // a header cell BELOW the header rows cannot carry one. Writing it anyway
    // produces `|{scope=rowgroup}=A|`, which re-parses as a data cell whose
    // content is the literal `=A`.
    const html = '<table><tbody><tr><th scope="rowgroup">A</th><td>1</td></tr></tbody></table>'
    expect(carve(html)).toBe('|=A| 1 |')
    expect(codes(html)).toContain('attribute-dropped')
  })
})

describe('table caption on import', () => {
  const carve = (html: string) => htmlToCarve(html).value.trim()
  const codes = (html: string) => htmlToCarve(html).report.diagnostics.map((d) => d.code)

  it('reads a table\'s own <caption>, which pandoc emits for every captioned table', () => {
    // The row walk looks only for `tr`, so before this the <caption> element
    // was skipped and its text left the document with no diagnostic at all.
    const source = carve(
      '<table><caption>Fruit prices</caption><thead><tr><th>A</th></tr></thead><tbody><tr><td>1</td></tr></tbody></table>',
    )
    expect(source).toBe('|=A|\n| 1 |\n^ Fruit prices')
    expect(carveToHtml(source)).toContain('<caption>Fruit prices</caption>')
    expect(codes('<table><caption>C</caption><tbody><tr><td>1</td></tr></tbody></table>')).toEqual([])
  })

  it('puts a figure-wrapped table\'s figcaption in the caption slot the table left empty', () => {
    expect(carve('<figure><table><tbody><tr><td>1</td></tr></tbody></table><figcaption>Outer</figcaption></figure>'))
      .toBe('| 1 |\n^ Outer')
  })

  it('keeps the table\'s own caption when a figure also captions it, and says so', () => {
    // Two captions, one slot. Carve cannot spell the figure WRAPPER around a
    // table at all, so the figure's caption is the one that cannot survive.
    // Writing both produced a second `^ ` line that re-read as a paragraph.
    const html =
      '<figure><table><caption>Inner</caption><tbody><tr><td>1</td></tr></tbody></table><figcaption>Outer</figcaption></figure>'
    expect(carve(html)).toBe('| 1 |\n^ Inner')
    expect(codes(html)).toEqual(['table-degraded'])
    expect(carveToHtml(carve(html))).not.toContain('<p>^')
  })
})
