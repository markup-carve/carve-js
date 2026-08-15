import { describe, expect, it } from 'vitest'
import { HtmlImportLimitError, carveToHtml, htmlToAst, htmlToCarve, parse, semanticSpan } from '../src/index.js'

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

describe('unspellable HTML import structures', () => {
  const tableFigure = '<figure><table><tr><td>1</td></tr></table><figcaption>Cap</figcaption></figure>'

  it('reports a table figure only when serializing the imported AST', () => {
    expect(htmlToAst(tableFigure).report.diagnostics).not.toContainEqual(
      expect.objectContaining({ code: 'structure-unspellable' }),
    )
    expect(htmlToCarve(tableFigure).report.diagnostics).toContainEqual(expect.objectContaining({
      code: 'structure-unspellable',
      severity: 'warning',
      message: expect.stringContaining('figure wrapping a table'),
      path: '/figure[1]',
    }))
  })

  it('does not report a table whose caption is already inside it', () => {
    const result = htmlToCarve('<table><caption>Cap</caption><tr><td>1</td></tr></table>')
    expect(result.report.diagnostics.map((diagnostic) => diagnostic.code)).not.toContain('structure-unspellable')
  })

  it('does not report an image figure, whose wrapper has a Carve spelling', () => {
    const result = htmlToCarve('<figure><img src="x.png" alt="X"><figcaption>Cap</figcaption></figure>')
    expect(result.report.diagnostics.map((diagnostic) => diagnostic.code)).not.toContain('structure-unspellable')
  })

  it('finds a table figure nested in a div', () => {
    const result = htmlToCarve(`<div class="outer">${tableFigure}</div>`)
    expect(result.report.diagnostics).toContainEqual(expect.objectContaining({
      code: 'structure-unspellable',
      path: '/div[1]/figure[1]',
    }))
  })

  it('applies the existing diagnostics limit to serialization losses', () => {
    expect(() => htmlToCarve(tableFigure, { maxDiagnostics: 0 })).toThrow(HtmlImportLimitError)
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
    expect(carve('<pre><code class="language-js">x()</code></pre>')).toBe('```js\nx()\n```')
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

/*
 * `<dl>` had no branch at all, and `dt`/`dd` are not block tags, so a
 * definition list did not degrade - it was destroyed. Every term and every
 * definition landed in one inline buffer and came out as a single paragraph
 * with the texts run together:
 *
 * ```
 * <dl><dt>Term</dt><dd>Definition</dd></dl>
 * ```
 *
 * imported as `TermDefinition`, and the only diagnostic said an unsupported
 * element had been unwrapped.
 *
 * The assertions are on the emitted source and on the HTML it re-reads to,
 * because a mapping that builds the right nodes and writes them unspellably
 * would pass an AST-shape check and still lose the list.
 */
describe('definition lists on import', () => {
  const carve = (html: string) => htmlToCarve(html).value.trim()
  const codes = (html: string) => htmlToCarve(html).report.diagnostics.map((d) => d.code)

  it('reads terms and definitions as a definition list, not as one paragraph', () => {
    const html = '<dl><dt>Carve</dt><dd>A markup language.</dd></dl>'
    expect(carve(html)).toBe(':: Carve\n:  A markup language.')
    expect(codes(html)).toEqual([])
    expect(carveToHtml(carve(html))).toBe('<dl>\n  <dt>Carve</dt>\n  <dd>A markup language.</dd>\n</dl>')
  })

  it('groups a run of terms with the definitions that follow it', () => {
    const html = '<dl><dt>HTML</dt><dt>HyperText Markup Language</dt><dd>The web page format.</dd><dd>Also a Carve import source.</dd><dt>CSS</dt><dd>Styling.</dd></dl>'
    expect(htmlToAst(html).value.children).toMatchObject([
      {
        type: 'definition_list',
        items: [
          { terms: [[{ value: 'HTML' }], [{ value: 'HyperText Markup Language' }]], definitions: [[{ type: 'paragraph' }], [{ type: 'paragraph' }]] },
          { terms: [[{ value: 'CSS' }]], definitions: [[{ type: 'paragraph' }]] },
        ],
      },
    ])
    expect(carve(html)).toBe(':: HTML\n:: HyperText Markup Language\n:  The web page format.\n:  Also a Carve import source.\n:: CSS\n:  Styling.')
  })

  it('walks through the HTML5 <div> wrapper around a name-value group', () => {
    const html = '<dl><div><dt>Carve</dt><dd>A markup language.</dd></div><div><dt>Djot</dt><dd>Its closest relative.</dd></div></dl>'
    expect(carve(html)).toBe(':: Carve\n:  A markup language.\n:: Djot\n:  Its closest relative.')
    expect(codes(html)).toEqual([])
  })

  it('reports what the group wrapper carried, since walking through it drops that too', () => {
    // An ordinary `<div>` keeps its attributes by becoming a `div` node. This
    // one cannot, and an `onclick` on it was the same silence: reported
    // everywhere else in the importer, nowhere here.
    expect(htmlToCarve('<dl><div id="g" onclick="evil()"><dt>T</dt><dd>D</dd></div></dl>').report.diagnostics).toEqual([
      expect.objectContaining({ code: 'attribute-dropped', message: 'Dropped event-handler attribute onclick on <div>' }),
      expect.objectContaining({ code: 'attribute-dropped', message: 'Dropped id on <div>: a definition group has no attribute slot' }),
    ])
  })

  it('does not carry an entry across a group wrapper boundary', () => {
    // The wrapper IS the group (HTML 5.2). A `<dd>` opening the second one is a
    // description with no term of its own, not a second description of the
    // first group's term.
    const html = '<dl><div><dt>A</dt><dd>One</dd></div><div><dd>Orphan</dd></div></dl>'
    expect(htmlToAst(html).value.children).toMatchObject([
      {
        type: 'definition_list',
        items: [
          { terms: [[{ value: 'A' }]], definitions: [[{ type: 'paragraph' }]] },
          { terms: [], definitions: [[{ type: 'paragraph' }]] },
        ],
      },
    ])
    expect(htmlToCarve(html).report.diagnostics).toContainEqual(expect.objectContaining({
      code: 'structure-unspellable',
      message: expect.stringContaining('<dd> with no <dt>'),
      path: '/dl[1]/div[2]/dd[1]',
    }))
  })

  it('reports displaced content under the path it came in on', () => {
    // The strays are converted AFTER the list, from a filtered array. Rebuilding
    // their paths from that array renumbers them, so one element would report
    // its own losses under a different name than the message that displaced it.
    const html = '<dl><dt>T</dt><dd>D</dd><p onclick="evil()">stray</p></dl>'
    const paths = htmlToCarve(html).report.diagnostics.map((d) => d.path)
    expect(paths).toEqual(['/dl[1]/p[3]', '/dl[1]/p[3]'])
  })

  it('keeps block content in a definition', () => {
    const html = '<dl><dt>Modes</dt><dd><p>Three of them:</p><ul><li>safe</li><li>semantic</li></ul></dd></dl>'
    expect(carve(html)).toBe(':: Modes\n:  Three of them:\n\n   - safe\n\n   - semantic')
    expect(carveToHtml(carve(html))).toContain('<ul>')
  })

  it('carries the list attributes onto the node', () => {
    expect(carve('<dl id="glossary" class="compact"><dt>T</dt><dd>D</dd></dl>')).toBe('{#glossary .compact}\n:: T\n:  D')
  })

  it('reports a definition with no term only when a writer has to spell it', () => {
    const html = '<dl><dd>A description of nothing.</dd></dl>'
    expect(htmlToAst(html).value.children).toMatchObject([
      { type: 'definition_list', items: [{ terms: [], definitions: [[{ type: 'paragraph' }]] }] },
    ])
    expect(htmlToAst(html).report.diagnostics).toEqual([])
    expect(htmlToCarve(html).report.diagnostics).toContainEqual(expect.objectContaining({
      code: 'structure-unspellable',
      severity: 'warning',
      message: expect.stringContaining('<dd> with no <dt>'),
      path: '/dl[1]/dd[1]',
    }))
    // The diagnostic states what actually happens to the written source.
    expect(carveToHtml(carve(html))).toBe('<p>:  A description of nothing.</p>')
  })

  it('reports an empty term, which the writer spells as a line that is not one', () => {
    const html = '<dl><dt></dt><dd>A description whose term was deleted.</dd></dl>'
    expect(htmlToAst(html).report.diagnostics).toEqual([])
    expect(htmlToCarve(html).report.diagnostics).toContainEqual(expect.objectContaining({
      code: 'structure-unspellable',
      severity: 'warning',
      message: expect.stringContaining('empty <dt>'),
      path: '/dl[1]/dt[1]',
    }))
    // What the emitted source actually reads as: the whole list becomes a
    // paragraph, so the diagnostic is not decoration.
    expect(carveToHtml(carve(html))).toBe('<p>::\n:  A description whose term was deleted.</p>')
  })

  it('reports an empty description, which the term above it swallows', () => {
    const html = '<dl><dt>Term</dt><dd></dd></dl>'
    expect(htmlToAst(html).report.diagnostics).toEqual([])
    expect(htmlToCarve(html).report.diagnostics).toContainEqual(expect.objectContaining({
      code: 'structure-unspellable',
      severity: 'warning',
      message: expect.stringContaining('<dd> that writes nothing'),
      path: '/dl[1]/dd[2]',
    }))
    expect(carveToHtml(carve(html))).toBe('<dl>\n  <dt>Term\n:</dt>\n</dl>')
  })

  it('reports a description whose blocks write nothing, not only an empty one', () => {
    // `<dd><p></p></dd>` is a NON-empty block list holding a block that writes
    // nothing, so an array-length check reports no loss while the writer still
    // emits the bare `:` the term above absorbs.
    const html = '<dl><dt>Term</dt><dd><p></p></dd></dl>'
    expect(htmlToCarve(html).report.diagnostics).toContainEqual(expect.objectContaining({
      code: 'structure-unspellable',
      message: expect.stringContaining('<dd> that writes nothing'),
    }))
    expect(carveToHtml(carve(html))).toBe('<dl>\n  <dt>Term\n:</dt>\n</dl>')
  })

  it('leaves a description that writes SOMETHING alone', () => {
    // CONTROL for the row above: an empty `<li>` writes `:  - +` and an empty
    // `<blockquote>` writes `:  >`. Both are descriptions on the reparse, so
    // reporting them would be a diagnostic for a loss that does not happen.
    for (const inner of ['<ul><li></li></ul>', '<blockquote></blockquote>', '<hr>']) {
      const html = `<dl><dt>Term</dt><dd>${inner}</dd></dl>`
      expect(htmlToCarve(html).report.diagnostics.map((d) => d.code)).not.toContain('structure-unspellable')
      expect(carveToHtml(carve(html))).toContain('<dd>')
    }
  })

  it('reports the attributes a term or a description has nowhere to keep', () => {
    // The entries have no `attrs` slot in the model, so an id an anchor points
    // at and a class a stylesheet selects on both end here.
    expect(htmlToCarve('<dl><dt id="term" class="key">T</dt><dd data-note="x">D</dd></dl>').report.diagnostics).toEqual([
      expect.objectContaining({ code: 'attribute-dropped', severity: 'warning', message: 'Dropped id, class on <dt>: a definition term has no attribute slot', path: '/dl[1]/dt[1]' }),
      expect.objectContaining({ code: 'attribute-dropped', severity: 'warning', message: 'Dropped data-note on <dd>: a definition description has no attribute slot', path: '/dl[1]/dd[2]' }),
    ])
  })

  it('reports an event-handler attribute on a description like it does everywhere else', () => {
    // The one that made this a security asymmetry rather than a fidelity one:
    // skipping `attrs()` made a `<dd>` the only element whose active markup was
    // dropped in silence.
    expect(htmlToCarve('<dl><dt>T</dt><dd onclick="evil()">D</dd></dl>').report.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'attribute-dropped', message: 'Dropped event-handler attribute onclick on <dd>' }),
    )
  })

  it('counts a <dl> against the node budget once, like any other element', () => {
    // `block()` already entered the node before handing it here. A second
    // `enter` charged one DOM node twice, so a caller-set limit rejected a
    // definition list earlier than the same-sized markup in any other tag.
    expect(() => htmlToAst('<dl><dt>T</dt><dd>D</dd></dl>', { maxNodes: 5 })).not.toThrow()
    expect(() => htmlToAst('<dl><dt>T</dt><dd>D</dd></dl>', { maxNodes: 4 })).toThrow(HtmlImportLimitError)
  })

  it('keeps content the model has no slot for, after the list, and says so', () => {
    const html = '<dl><dt>T</dt><dd>D</dd><p>An editor stray.</p></dl>'
    expect(carve(html)).toBe(':: T\n:  D\n\nAn editor stray.')
    expect(htmlToCarve(html).report.diagnostics).toContainEqual(expect.objectContaining({
      code: 'element-unwrapped',
      severity: 'warning',
      message: expect.stringContaining('Moved <p> content out of the <dl>'),
    }))
  })
})

/*
 * The two one-line mappings of `markup-carve/carve#1210` P7, and one the row's
 * parenthetical assumed was already there.
 */
describe('change tracking and ordered-list alphabets on import', () => {
  const carve = (html: string) => htmlToCarve(html).value.trim()
  const codes = (html: string) => htmlToCarve(html).report.diagnostics.map((d) => d.code)

  it('keeps an edit as an edit, in both directions of the pair', () => {
    // `<ins>` unwrapped to its text: the insertion vanished and only its words
    // stayed. `<del>` reached `strike`, which renders `<s>` - a deletion
    // imported as "no longer accurate", a different statement.
    const html = '<p><del>gone</del> <ins>added</ins> <s>old</s></p>'
    expect(carve(html)).toBe('{-gone-} {+added+} ~old~')
    expect(codes(html)).toEqual([])
    expect(carveToHtml(carve(html))).toBe('<p><del>gone</del> <ins>added</ins> <s>old</s></p>')
  })

  it('spells <strike> the way it spells <s>', () => {
    expect(carve('<p><strike>old</strike></p>')).toBe('~old~')
  })

  it('counts an ordered list in the alphabet the HTML asked for', () => {
    // The attribute was exempt from the unsupported-attribute report and then
    // unread, so the list came back counting 1. 2. 3. and nothing said so.
    expect(carve('<ol type="a"><li>x</li><li>y</li></ol>')).toBe('a. x\n\nb. y')
    expect(carve('<ol type="I"><li>x</li></ol>')).toBe('I. x')
    expect(carveToHtml(carve('<ol type="a"><li>x</li></ol>'))).toContain('<ol type="a">')
  })

  it('keeps the start together with the alphabet', () => {
    expect(carve('<ol type="a" start="3"><li>x</li></ol>')).toBe('c. x')
    expect(carveToHtml(carve('<ol type="a" start="3"><li>x</li></ol>'))).toContain('<ol type="a" start="3">')
  })

  it('treats type="1" as the default it is, with no diagnostic', () => {
    expect(carve('<ol type="1"><li>x</li></ol>')).toBe('1. x')
    expect(codes('<ol type="1"><li>x</li></ol>')).toEqual([])
  })

  it('reports a type HTML does not define, rather than exempting it into silence', () => {
    expect(htmlToCarve('<ol type="q"><li>x</li></ol>').report.diagnostics).toEqual([
      expect.objectContaining({
        code: 'attribute-dropped',
        severity: 'warning',
        message: 'Dropped type="q" on <ol>: an ordered list counts in 1, a, A, i or I',
        path: '/ol[1]',
      }),
    ])
  })

  it('reports the marker the writer cannot spell, on exactly the lists where it cannot', () => {
    /*
     * The FIELD survives every combination; the written MARKER does not. Two
     * shapes lose it, and the check is the parser's rather than a table's: every
     * start from 1 to 60 in each of the four alphabets, at one, two and three
     * items, is imported, written, read back, and the diagnostic is compared
     * against whether the list actually changed.
     *
     * 720 combinations, 212 of which do not survive the round trip. A rule that
     * over-reports passes a "warns on the bad case" test and fails this one.
     */
    let broken = 0
    let mismatched = 0
    for (const items of [1, 2, 3]) {
      for (const type of ['a', 'A', 'i', 'I'] as const) {
        for (let start = 1; start <= 60; start++) {
          const html = `<ol type="${type}"${start === 1 ? '' : ` start="${start}"`}>${'<li>x</li>'.repeat(items)}</ol>`
          const result = htmlToCarve(html)
          const reread = parse(result.value).children[0] as { olType?: string; start?: number } | undefined
          const changed = (reread?.olType ?? undefined) !== type || (reread?.start ?? 1) !== start
          const reported = result.report.diagnostics.some((d) => d.code === 'structure-unspellable')
          if (changed) broken++
          if (changed !== reported) mismatched++
        }
      }
    }

    expect(broken).toBe(212)
    expect(mismatched).toBe(0)
  })

  it('names the two shapes, so the message says what happened', () => {
    // No multi-letter alphabetic marker exists: `aa. x` is a paragraph, so the
    // writer's marker wraps and the list restarts at the first letter.
    expect(htmlToCarve('<ol type="a" start="27"><li>x</li></ol>').report.diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'structure-unspellable',
        severity: 'warning',
        message: expect.stringContaining('alphabetic list starting at 27'),
      }),
    )
    // A lone `v.` reads as the 22nd letter; `v.` `vi.` reads as roman 5.
    expect(htmlToCarve('<ol type="i" start="5"><li>x</li></ol>').report.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'structure-unspellable', message: expect.stringContaining('one-item roman list starting at 5') }),
    )
    expect(htmlToCarve('<ol type="i" start="5"><li>x</li><li>y</li></ol>').report.diagnostics).toEqual([])
  })

  it('reports it as a writer loss, so the AST keeps the alphabet either way', () => {
    const html = '<ol type="a" start="27"><li>x</li></ol>'
    expect(htmlToAst(html).value.children).toMatchObject([{ type: 'list', ordered: true, olType: 'a', start: 27 }])
    expect(htmlToAst(html).report.diagnostics).toEqual([])
  })

  it('claims no alphabet before its first letter', () => {
    // `start="0"` and a negative start are valid HTML and no alphabet has a
    // letter there. Keeping the type would be worse than the loss it reports:
    // the writer derives its letter arithmetically, so zero came out as a
    // BACKTICK and -3 as `]` - characters that can pair with a later one.
    const zero = htmlToCarve('<ol type="a" start="0"><li>x</li><li>y</li></ol>')
    expect(zero.value).toBe('0. x\n\n1. y\n')
    expect(zero.report.diagnostics).toEqual([
      expect.objectContaining({
        code: 'attribute-dropped',
        severity: 'warning',
        message: 'Dropped type="a" on <ol> with start="0": an alphabet has no letter before the first',
      }),
    ])
    expect(htmlToCarve('<ol type="i" start="-3"><li>x</li></ol>').value).not.toContain('`')
  })

  it('CONTROL: a decimal list with the same start is untouched by that rule', () => {
    // What a negative start does to a list is the existing decimal behavior and
    // no part of this change: `type="1"` takes the same path it always did.
    expect(htmlToCarve('<ol type="1" start="-3"><li>x</li></ol>').value).toBe('-3. x\n')
    expect(htmlToCarve('<ol type="1" start="-3"><li>x</li></ol>').report.diagnostics).toEqual([])
  })

  it('refuses a roman start no roman numeral spells', () => {
    // Past 3999 the writer has no numeral and repeats the thousands letter, so
    // a 40-byte input asks for a million characters PER ITEM. The list keeps
    // its decimal counting, which spells any start in its own digits.
    const huge = htmlToCarve('<ol type="i" start="1000000000"><li>x</li></ol>')
    expect(huge.value).toBe('1000000000. x\n')
    expect(huge.report.diagnostics).toEqual([
      expect.objectContaining({ code: 'attribute-dropped', message: expect.stringContaining('no numeral above 3999') }),
    ])
    // The boundary itself is spellable and keeps the alphabet.
    expect(htmlToCarve('<ol type="i" start="3999"><li>x</li></ol>').value).toBe('mmmcmxcix. x\n')
    // And the LAST item is the one asked about: a list opened below the
    // boundary crosses it from inside, where the output grows as the square of
    // the list's length.
    expect(htmlToCarve('<ol type="i" start="3999"><li>x</li><li>y</li></ol>').report.diagnostics).toEqual([
      expect.objectContaining({ code: 'attribute-dropped', message: expect.stringContaining('reaching 4000') }),
    ])
  })

  it('CONTROL: an alphabetic list crossing the 26th letter loses nothing', () => {
    // Carve derives a list's numbering from where it STARTS, exactly as a
    // decimal list does, so the marker the writer puts on a later item is not
    // an authored fact to preserve. `<ol type="a" start="26">` with two items
    // is written `z.` `a.` and renders back as the same two-item list starting
    // at 26 - no diagnostic is owed, and reporting one would name a loss that
    // does not happen.
    const html = '<ol type="a" start="26"><li>x</li><li>y</li></ol>'
    expect(htmlToCarve(html).report.diagnostics).toEqual([])
    expect(carveToHtml(htmlToCarve(html).value)).toContain('<ol type="a" start="26">')
  })

  it('reads the start by HTML integer rules, not by Number()', () => {
    // `Number()` accepted what the attribute does not. `foo` became NaN, which
    // the writer spelled `NaN. x` in a decimal list and, once a type could be
    // kept, as a NUL byte in an alphabetic one; `2.9` opened a list at 2.9 and
    // `1e3` at 1000. None of it was reported.
    // The minimum signed 32-bit value is IN range, not out of it.
    expect(htmlToCarve('<ol start="-2147483648"><li>x</li></ol>').report.diagnostics).toEqual([])
    expect(htmlToCarve('<ol start="-2147483649"><li>x</li></ol>').report.diagnostics).toEqual([
      expect.objectContaining({ code: 'attribute-dropped', message: expect.stringContaining('not an integer HTML defines') }),
    ])
    for (const bad of ['foo', '2.9', '1e3', '']) {
      expect(htmlToCarve(`<ol start="${bad}"><li>x</li></ol>`).value).toBe('1. x\n')
      expect(htmlToCarve(`<ol type="a" start="${bad}"><li>x</li></ol>`).value).toBe('a. x\n')
      expect(htmlToCarve(`<ol start="${bad}"><li>x</li></ol>`).report.diagnostics).toEqual([
        expect.objectContaining({ code: 'attribute-dropped', message: expect.stringContaining('not an integer HTML defines') }),
      ])
    }
    // A well-formed one still counts from where it says.
    expect(htmlToCarve('<ol start="7"><li>x</li></ol>').value).toBe('7. x\n')
    expect(htmlToCarve('<ol start="7"><li>x</li></ol>').report.diagnostics).toEqual([])
  })

  it('CONTROL: an unordered list has no alphabet, so its type is still unsupported', () => {
    expect(htmlToCarve('<ul type="disc"><li>x</li></ul>').report.diagnostics).toEqual([
      expect.objectContaining({ code: 'attribute-dropped', message: 'Dropped unsupported attribute type on <ul>' }),
    ])
  })
})
