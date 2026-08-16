import { describe, expect, it } from 'vitest'
import { parseFragment } from 'parse5'
import { AstJsonPartitionError, HtmlImportLimitError, carveToHtml, details, htmlToAst, htmlToCarve, fromAstJson, parse, renderHtml, semanticSpan, toAstJson } from '../src/index.js'

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
      .toBe('|= A |\n| 1 |')
    expect(carve('<table><tbody><tr><th scope="row">A</th><td>1</td></tr></tbody></table>')).toBe('|= A | 1 |')
  })

  it('keeps a scope position cannot explain, and it round-trips', () => {
    const source = carve('<table><thead><tr><th scope="colgroup">A</th></tr></thead><tbody><tr><td>1</td></tr></tbody></table>')
    expect(source).toBe('|={scope=colgroup} A |\n| 1 |')
    expect(carveToHtml(source)).toContain('<th scope="colgroup">A</th>')
  })

  it('keeps it below the header rows too, where it used to be dropped', () => {
    // `header_cell` has an attribute slot now, after its markers (§5 T10), so
    // this is a real spelling. It used to be dropped and reported: the only
    // shape available was `|{scope=rowgroup}=A|`, which re-parses as a data
    // cell whose content is the literal `=A`, so keeping the value there traded
    // a header cell for an attribute.
    const html = '<table><tbody><tr><th scope="rowgroup">A</th><td>1</td></tr></tbody></table>'
    expect(carve(html)).toBe('|={scope=rowgroup} A | 1 |')
    expect(codes(html)).not.toContain('attribute-dropped')
    expect(carveToHtml(carve(html))).toContain('<th scope="rowgroup">A</th>')
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
    expect(source).toBe('|= A |\n| 1 |\n^ Fruit prices')
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
    // Bare-text `<li>`s import TIGHT (the ruled tight-li import).
    expect(carve(html)).toBe(':: Modes\n:  Three of them:\n\n   - safe\n   - semantic')
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
    expect(carve('<ol type="a"><li>x</li><li>y</li></ol>')).toBe('a. x\nb. y')
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
    expect(zero.value).toBe('0. x\n1. y\n')
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

/*
 * `markup-carve/carve#1210` P9's two recognition upgrades for carve-js.
 */
describe('disclosures and quotations on import', () => {
  const carve = (html: string) => htmlToCarve(html).value.trim()
  const codes = (html: string) => htmlToCarve(html).report.diagnostics.map((d) => d.code)

  it('reads a disclosure as the details admonition, summary and all', () => {
    // It became a generic `div` with a `details` CLASS, and `<summary>` was not
    // recognized at all: the label unwrapped into the body, so it re-rendered
    // inside the box rather than on it.
    const html = '<details><summary>More info</summary><p>The body.</p></details>'
    expect(carve(html)).toBe('::: details "More info"\nThe body.\n:::')
    expect(codes(html)).toEqual([])
    expect(carveToHtml(carve(html), { extensions: [details()] })).toBe(
      '<details>\n  <summary>More info</summary>\n  <p>The body.</p>\n</details>',
    )
  })

  it('keeps the label on the box even without the extension', () => {
    // A core render has no `<details>`, but the summary is the admonition TITLE
    // now rather than an anonymous first paragraph.
    expect(carveToHtml(carve('<details><summary>More info</summary><p>b</p></details>'))).toContain(
      '<p class="admonition-title">More info</p>',
    )
  })

  it('keeps the disclosure open when the HTML says it is', () => {
    const html = '<details open><summary>T</summary><p>b</p></details>'
    expect(carve(html)).toBe('{open}\n::: details "T"\nb\n:::')
    expect(codes(html)).toEqual([])
    expect(carveToHtml(carve(html), { extensions: [details()] })).toContain('<details open="">')
  })

  it('leaves a summary-less disclosure to the default label, as the element does', () => {
    expect(carve('<details><p>b</p></details>')).toBe('::: details\nb\n:::')
    expect(carveToHtml(carve('<details><p>b</p></details>'), { extensions: [details()] })).toContain('<summary>Details</summary>')
  })

  it('keeps the disclosure when its label cannot be a title', () => {
    /*
     * The title slot is delimited by `"` and has no escape, so a quote in the
     * summary ends it early and the opening line stops being an opener: the
     * whole block - body included - re-reads as ONE paragraph. Recording that
     * as a writer loss would leave the destroyed document in place, so this is
     * the one place the import degrades the TREE instead: the label becomes the
     * body's first paragraph, which is where it landed before this mapping
     * existed anyway.
     */
    const html = '<details><summary>Say "hi"</summary><p>The body.</p></details>'
    expect(carve(html)).toBe('::: details\nSay \\"hi\\"\n\nThe body.\n:::')
    expect(carveToHtml(carve(html), { extensions: [details()] })).toBe(
      '<details>\n  <summary>Details</summary>\n  <p>Say "hi"</p>\n  <p>The body.</p>\n</details>',
    )
    expect(htmlToCarve(html).report.diagnostics).toContainEqual(expect.objectContaining({
      code: 'element-unwrapped',
      severity: 'warning',
      message: expect.stringContaining('cannot spell a double quote or a line break'),
      path: '/details[1]/summary[1]',
    }))
  })

  it('and does the same for a label broken across lines', () => {
    expect(carveToHtml(carve('<details><summary>a<br>b</summary><p>x</p></details>'), { extensions: [details()] })).toContain('<details>')
  })

  it('asks the writer, so a quote inside an attribute value counts too', () => {
    // A quote reaches the title through more than its own text: an attribute
    // VALUE is written quoted, and a code span carries its content verbatim.
    // Enumerating the spellings that can produce one would be a second copy of
    // the grammar, so the check renders the inlines and looks at the result.
    for (const label of ['<span title="a&quot;b">hi</span>', '<code>a"b</code>']) {
      const html = `<details><summary>${label}</summary><p>body</p></details>`
      expect(htmlToCarve(html).value.startsWith('::: details "')).toBe(false)
      expect(carveToHtml(htmlToCarve(html).value, { extensions: [details()] })).toContain('<details>')
    }
  })

  it('CONTROL: a quote in a LINK DESTINATION does not cost the title', () => {
    // Percent-encoded in the href, so the written form carries no quote and the
    // title slot is still available. A rule that looked for the character in
    // the input rather than in the output would give this one up.
    expect(htmlToCarve('<details><summary><a href="/x?q=%22">link</a></summary><p>b</p></details>').value)
      .toBe('::: details "[link](/x?q=%22)"\nb\n:::\n')
  })

  it('CONTROL: the titles that ARE spellable keep the slot', () => {
    // Measured against the parser, not assumed: emphasis, an apostrophe and the
    // typographic quotes all survive the title slot.
    for (const label of ['a <em>b</em>', "it's", 'He said \u201chi\u201d']) {
      const written = carve(`<details><summary>${label}</summary><p>x</p></details>`)
      expect(written.startsWith('::: details "')).toBe(true)
      expect(carveToHtml(written, { extensions: [details()] })).toContain('<summary>')
    }
  })

  it('reports what the label carried, since the title slot holds no attributes', () => {
    expect(htmlToCarve('<details><summary id="sum" class="k">T</summary><p>b</p></details>').report.diagnostics).toEqual([
      expect.objectContaining({
        code: 'attribute-dropped',
        severity: 'warning',
        message: 'Dropped id, class on <summary>: a disclosure label has no attribute slot',
        path: '/details[1]/summary[1]',
      }),
    ])
  })

  it('does not write the open state twice in a static render', () => {
    // The static renderer adds `open` for print; an imported `<details open>`
    // already carries it in the attributes, and adding it again wrote
    // `<details open open="">`. A hand-written `{open}` reached it too.
    const src = htmlToCarve('<details open><summary>T</summary><p>b</p></details>').value
    expect(renderHtml(parse(src), { extensions: [details()], mode: 'static' })).toBe(
      '<details open="">\n  <summary>T</summary>\n  <p>b</p>\n</details>',
    )
    expect(renderHtml(parse('::: details "T"\nb\n:::\n'), { extensions: [details()], mode: 'static' })).toContain('<details open>')
  })

  it('reports a disclosure body under the path it came in on', () => {
    // Filtering the summary out of the child list renumbers everything after
    // it, and a summary that is not first is not `summary[1]` either.
    expect(htmlToCarve('<details><p>a</p><summary id="s">S</summary></details>').report.diagnostics).toEqual([
      expect.objectContaining({ path: '/details[1]/summary[2]' }),
    ])
    expect(htmlToCarve('<details><summary>S</summary><blockquote onclick="x()">b</blockquote></details>').report.diagnostics).toEqual([
      expect.objectContaining({ path: '/details[1]/blockquote[2]' }),
    ])
  })

  it('counts the summary against the node budget', () => {
    // An empty `<summary>` is a DOM node the caller's limit is counting;
    // reading straight past it let a document process more nodes than allowed.
    expect(() => htmlToAst('<details><summary></summary></details>', { maxNodes: 2 })).not.toThrow()
    expect(() => htmlToAst('<details><summary></summary></details>', { maxNodes: 1 })).toThrow(HtmlImportLimitError)
  })

  it('reads <q> as the marks a browser draws for it', () => {
    // The content reached the document before this; the marks that made it a
    // quotation did not.
    expect(carve('<p>He said <q>hi</q>.</p>')).toBe('He said “hi”.')
    expect(htmlToCarve('<p>He said <q>hi</q>.</p>').report.diagnostics).toEqual([
      expect.objectContaining({
        code: 'element-unwrapped',
        severity: 'info',
        message: 'Read <q> as quotation marks: Carve has no quotation element, so the marks are the mapping',
        path: '/p[1]/q[2]',
      }),
    ])
  })

  it('alternates the marks by nesting depth', () => {
    expect(carve('<p><q>nested <q>inner</q></q></p>')).toBe('“nested ‘inner’”')
  })

  it('writes the typographic marks, which survive being written', () => {
    // A straight `"` is escaped back to a straight quote by the writer (PART 11
    // section 5 keeps a quote that reached it as TEXT), so the curly pair is
    // both what the element renders as and what round-trips.
    const written = carve('<p><q>hi</q></p>')
    expect(written).not.toContain('\\"')
    expect(carveToHtml(written)).toBe('<p>“hi”</p>')
  })

  it('preserves <q> raw in roundtrip mode, where the marks are not enough', () => {
    // `roundtrip` raw-preserves what Carve cannot express. The seven semantic
    // elements are mapped in every mode because their spelling renders back as
    // the element; the marks do not - the `<q>` becomes text and its `cite`
    // goes with it - so this one belongs to the raw fallback there.
    const result = htmlToAst('<p><q cite="/x">hi</q></p>', { mode: 'roundtrip' })
    expect(result.value.children[0]).toMatchObject({
      children: [{ type: 'raw_inline', format: 'html', content: '<q cite="/x">hi</q>' }],
    })
    expect(result.report.diagnostics.map((d) => d.code)).toContain('raw-preserved')
  })

  it('keeps what a quotation carried, on a span', () => {
    expect(carve('<p><q id="cited" class="key">hi</q></p>')).toBe('[“hi”]{#cited .key}')
  })
})

/*
 * `markup-carve/carve#1210` P1's span row for carve-js.
 *
 * The model already carried the continuation cells - `table_cell.span` is in
 * PART 12, and the HTML renderer derives `rowspan`/`colspan` from a run of them
 * - and the import threw them away. A spanning cell was written as an ordinary
 * one and its row came up short, so `<td colspan="2">` under a two-column
 * header produced a one-cell row, with `table-degraded` as the only trace.
 *
 * The assertion is on the GRID rather than on the source or the HTML string:
 * both sides are expanded into the matrix of cells a browser lays out, so a
 * different but equivalent spelling passes and a lost span cannot.
 */
describe('table spans on import', () => {
  const cellsOf = (row: { childNodes?: Array<{ tagName?: string }> }) =>
    (row.childNodes ?? []).filter((n) => n.tagName === 'td' || n.tagName === 'th')

  const gridOf = (html: string): string[][] => {
    const fragment = parseFragment(html) as unknown as { childNodes?: unknown[] }
    const rows: Array<{ childNodes?: Array<{ tagName?: string }> }> = []
    const collect = (node: { tagName?: string; childNodes?: unknown[] }): void => {
      if (node.tagName === 'tr') rows.push(node as never)
      else (node.childNodes ?? []).forEach((child) => collect(child as never))
    }
    collect(fragment as never)
    const text = (node: { nodeName?: string; value?: string; childNodes?: unknown[] }): string =>
      node.nodeName === '#text' ? (node.value ?? '') : (node.childNodes ?? []).map((c) => text(c as never)).join('')
    const attr = (node: { attrs?: Array<{ name: string; value: string }> }, name: string) =>
      node.attrs?.find((a) => a.name === name)?.value
    const grid: string[][] = rows.map(() => [])
    rows.forEach((row, r) => {
      let c = 0
      for (const cell of cellsOf(row)) {
        while (grid[r]![c] !== undefined) c++
        const colspan = Math.max(1, Number(attr(cell as never, 'colspan') ?? '1') || 1)
        const rowspan = Math.max(1, Number(attr(cell as never, 'rowspan') ?? '1') || 1)
        const value = `${cell.tagName}:${text(cell as never).trim()}`
        for (let dr = 0; dr < rowspan && r + dr < rows.length; dr++) {
          for (let dc = 0; dc < colspan; dc++) grid[r + dr]![c + dc] = value
        }
        c += colspan
      }
    })
    return grid
  }

  const fixtures: Array<[string, string]> = [
    ['a header-wide column', '<table><tr><th>a</th><th>b</th></tr><tr><td colspan="2">wide</td></tr></table>'],
    ['a cell held over a row', '<table><tr><th>a</th><th>b</th></tr><tr><td rowspan="2">tall</td><td>x</td></tr><tr><td>y</td></tr></table>'],
    ['a two-by-two merge', '<table><tr><td colspan="2" rowspan="2">X</td><td>c</td></tr><tr><td>f</td></tr></table>'],
    ['a span in the last column', '<table><tr><td>a</td><td rowspan="2">b</td></tr><tr><td>c</td></tr></table>'],
    ['two spans in one row', '<table><tr><td colspan="2">A</td><td colspan="2">B</td></tr><tr><td>1</td><td>2</td><td>3</td><td>4</td></tr></table>'],
    ['a header cell spanning columns', '<table><tr><th colspan="2">Group</th></tr><tr><th>a</th><th>b</th></tr><tr><td>1</td><td>2</td></tr></table>'],
    ['a span three rows deep', '<table><tr><td rowspan="3">tall</td><td>1</td></tr><tr><td>2</td></tr><tr><td>3</td></tr></table>'],
    ['a Word-shaped merge', '<table><tbody><tr><td rowspan="2">Name</td><td colspan="2">Contact</td></tr><tr><td>Phone</td><td>Email</td></tr><tr><td>Ada</td><td>1</td><td>a@x</td></tr></tbody></table>'],
  ]

  for (const [name, html] of fixtures) {
    it(`keeps the grid of ${name}`, () => {
      const written = htmlToCarve(html).value
      expect(gridOf(carveToHtml(written))).toEqual(gridOf(html))
      expect(htmlToCarve(html).report.diagnostics).toEqual([])
    })
  }

  it('resolves rowspan="0" against the row group, as HTML does', () => {
    // "To the end of this row GROUP", so a `<tfoot>` below the body is not
    // swallowed by a cell HTML stops at the body's last row.
    const html = '<table><thead><tr><th>h</th></tr></thead><tbody><tr><td rowspan="0">b</td><td>x</td></tr><tr><td>y</td></tr></tbody><tfoot><tr><td>f</td></tr><tr><td>g</td></tr></tfoot></table>'
    expect(htmlToCarve(html).value).toBe('|= h |\n| b | x |\n| ^ | y |\n| f |\n| g |\n')
    // The `<tfoot>` is a grouping the written source cannot spell, which is its
    // own row's business; no span is reported here.
    expect(htmlToCarve(html).report.diagnostics.map((d) => d.code)).toEqual(['structure-unspellable'])
  })

  it('stops a rowspan at its row group, whatever the number says', () => {
    // HTML clips a rowspan at the group boundary, so a `rowspan="5"` on the
    // last body row does not reach into the `<tfoot>` below it. Only the `0`
    // form was resolved against the group at first, and a positive one walked
    // straight through.
    const html = '<table><tbody><tr><td rowspan="5">b</td><td>x</td></tr></tbody><tfoot><tr><td>f</td></tr><tr><td>g</td></tr></tfoot></table>'
    expect(htmlToCarve(html).value).toBe('| b | x |\n| f |\n| g |\n')
  })

  it('reads a tall table in time proportional to its rows', () => {
    /*
     * Asking each cell for its group's size meant scanning the whole table per
     * cell. The rows are the same shape, so the RATIO across two sizes is the
     * measurement and no stopwatch reading is asserted: at four times the rows,
     * the linear form measured 2.4x and the quadratic one 14.7x.
     *
     * Four times rather than two, and a bound of 8 rather than 4, because a
     * doubling puts quadratic work at about 4x - the same number a slow machine
     * can produce from linear work, which is a threshold no mutation has to
     * cross.
     */
    const table = (rows: number) => `<table>${Array.from({ length: rows }, (_, i) => `<tr><td>${i}</td></tr>`).join('')}</table>`
    // Warm the parser so the first-call cost is not what is being compared.
    htmlToCarve(table(200))
    const time = (rows: number) => {
      const started = performance.now()
      htmlToCarve(table(rows))
      return performance.now() - started
    }
    const small = time(2000)
    const large = time(8000)

    expect(large).toBeLessThan(small * 8)
  })

  it('clips a rowspan that would leave the head the renderer synthesizes', () => {
    /*
     * Carve derives the head from the LEADING RUN of all-header rows, so a span
     * reaching out of that run is written into a `<thead>` with its other rows
     * in the `<tbody>`. Browsers clip a rowspan across row groups, so keeping
     * the number would produce a document claiming a grid it does not render.
     *
     * The grid fixtures cannot catch this one: their expander is the layout
     * algorithm without the group rule, which is exactly the rule that bites.
     */
    const html = '<table><tr><th rowspan="2">H</th><th>A</th></tr><tr><td>B</td></tr></table>'
    expect(htmlToCarve(html).value).toBe('|= H |= A |\n| B |\n')
    expect(htmlToCarve(html).report.diagnostics).toEqual([
      expect.objectContaining({
        code: 'table-degraded',
        severity: 'warning',
        message: expect.stringContaining('Clipped a rowspan at the header rows'),
        path: '/table[1]/tr[1]/th[1]',
      }),
    ])
    // The written table renders no rowspan at all, which is what a browser
    // shows for the clipped one.
    expect(carveToHtml(htmlToCarve(html).value)).not.toContain('rowspan')
  })

  it('CONTROL: a span WITHIN the header rows is untouched', () => {
    const html = '<table><tr><th rowspan="2">H</th><th>A</th></tr><tr><th>B</th></tr><tr><td>1</td><td>2</td></tr></table>'
    expect(htmlToCarve(html).report.diagnostics).toEqual([])
    expect(carveToHtml(htmlToCarve(html).value)).toContain('rowspan="2"')
  })

  it('reports the empty cell a short row needs, and only when it invents one', () => {
    // A row shorter than the spans reaching into it needs the index kept. The
    // continuation itself costs nothing - the span already owns that cell - so
    // only an invented EMPTY cell is reported.
    expect(htmlToCarve('<table><tr><td>a</td><td rowspan="2">b</td></tr><tr><td>c</td></tr></table>').report.diagnostics).toEqual([])
    expect(htmlToCarve('<table><tr><td>a</td><td>b</td><td rowspan="2">c</td></tr><tr></tr></table>').report.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'table-degraded', message: expect.stringContaining('a cell the source did not have') }),
    )
  })

  it('clamps a span to what HTML allows, so a value cannot ask for a billion cells', () => {
    // Each unit of a span becomes a CELL, so an unclamped `colspan` is a
    // 30-byte input asking for a billion of them.
    const wide = htmlToCarve('<table><tr><td colspan="1000000000">x</td></tr></table>')
    expect(wide.value.split('|').length - 1).toBe(1001)
    // And the generated cells are charged to the node budget on top of that.
    expect(() => htmlToAst('<table><tr><td colspan="1000">x</td></tr></table>', { maxNodes: 100 })).toThrow(HtmlImportLimitError)
  })

  it('keeps the first caption and reports the second, as the parser does', () => {
    // `| a |` + two `^ ` lines reads the first as the caption and the second as
    // a paragraph, so the import follows the same rule and says which one went.
    const html = '<table><caption>One</caption><tr><td>a</td></tr><caption>Two</caption></table>'
    expect(htmlToAst(html).value.children).toMatchObject([{ type: 'table', caption: [{ value: 'One' }] }])
    expect(htmlToCarve(html).report.diagnostics).toEqual([
      expect.objectContaining({
        code: 'table-degraded',
        severity: 'warning',
        message: 'Dropped a second <caption>: a table has one caption, and the first one wins',
        path: '/table[1]/caption[3]',
      }),
    ])
  })

  it('CONTROL: one caption after the rows is not a degradation', () => {
    // It is where Carve writes it, so nothing is lost and nothing is reported.
    expect(htmlToCarve('<table><tr><td>a</td></tr><caption>Late</caption></table>').value).toBe('| a |\n^ Late\n')
    expect(htmlToCarve('<table><tr><td>a</td></tr><caption>Late</caption></table>').report.diagnostics).toEqual([])
  })
})

/*
 * `markup-carve/carve#1210` P10's two carve-js rows: behavior that is CLOSED as
 * policy rather than waiting for a mapping. Both were verified against the
 * importer before being written down - a documented loss is honest, and a
 * documented ACCIDENT launders a bug - and both are pinned here so the docs
 * line stays true.
 */
describe('the import decisions that are policy', () => {
  const EMBEDS = ['video', 'audio', 'iframe', 'svg', 'object', 'canvas']

  it('unwraps an embed to its fallback content in safe and semantic mode', () => {
    for (const tag of EMBEDS) {
      const html = `<${tag} src="clip.mp4">Your reader cannot play this.</${tag}>`
      for (const mode of ['safe', 'semantic'] as const) {
        const result = htmlToCarve(html, { mode })
        expect(result.value).toBe('Your reader cannot play this.\n')
        expect(result.report.diagnostics).toEqual([
          expect.objectContaining({ code: 'attribute-dropped', message: `Dropped unsupported attribute src on <${tag}>` }),
          expect.objectContaining({ code: 'element-unwrapped', message: `Unwrapped unsupported <${tag}> element` }),
        ])
      }
    }
  })

  it('reports what an unwrapped element takes with it, not only its src', () => {
    /*
     * `attrs()` reports the attributes it cannot represent and KEEPS the rest -
     * an id an anchor points at, a class a stylesheet selects on. When the
     * element is then unwrapped there is nothing left to hang them on, and they
     * went in silence, so the docs line promising every attribute is accounted
     * for was false for all but `src`.
     *
     * Not only embeds: the same arms unwrap `<section>`, `<form>` and any
     * unmapped inline element.
     */
    expect(htmlToCarve('<video id="player" class="wide" data-x="1">fallback</video>').report.diagnostics).toEqual([
      expect.objectContaining({ code: 'element-unwrapped' }),
      expect.objectContaining({
        code: 'attribute-dropped',
        severity: 'warning',
        message: 'Dropped id, class, data-x with the unwrapped <video>: there is no element left to carry them',
      }),
    ])
    for (const html of [
      '<section id="s">x</section>',
      '<form id="f">x</form>',
      '<p><ruby id="r">x</ruby></p>',
      // The figure that has no representable target is a fourth unwrap arm,
      // and it kept the same silence.
      '<figure id="f"><ul><li>a</li></ul><figcaption>c</figcaption></figure>',
    ]) {
      expect(htmlToCarve(html).report.diagnostics.map((d) => d.code)).toEqual(['element-unwrapped', 'attribute-dropped'])
    }
  })

  it('CONTROL: a div KEEPS its attributes, so nothing is reported there', () => {
    // It becomes a `div` node, which has an attribute slot. A rule that fired
    // on every unwrap arm would report a loss that does not happen here.
    expect(htmlToCarve('<div id="d">x</div>', { mode: 'semantic' }).report.diagnostics).toEqual([])
  })

  it('keeps an embed verbatim in roundtrip mode, whose contract is Carve-produced HTML', () => {
    for (const tag of EMBEDS) {
      const html = `<${tag} src="clip.mp4">fallback</${tag}>`
      const result = htmlToCarve(html, { mode: 'roundtrip' })
      expect(result.value).toContain(`<${tag} src="clip.mp4">fallback</${tag}>`)
      expect(result.report.diagnostics.map((d) => d.code)).toContain('raw-preserved')
    }
  })

  it('and a void embed too, which has no fallback content to unwrap to', () => {
    expect(htmlToCarve('<p>a</p><embed src="x">').value).toBe('a\n')
    expect(htmlToCarve('<p>a</p><embed src="x">', { mode: 'roundtrip' }).value).toContain('<embed src="x">')
  })

  it('gives mark and code their own syntax, not a second spelling as a span', () => {
    // The seven PART 9 spells as a span attribute import as `[text]{kbd}`.
    // These two are not among them: each already has a syntax, and importing
    // them here as well would give one input two spellings.
    expect(htmlToCarve('<p><mark>m</mark></p>').value).toBe('=m=\n')
    expect(htmlToCarve('<p><code>c</code></p>').value).toBe('`c`\n')
    expect(htmlToCarve('<p><mark>m</mark><code>c</code></p>').report.diagnostics).toEqual([])
    // The contrast, in the same assertion style: one of the seven.
    expect(htmlToCarve('<p><kbd>Tab</kbd></p>').value).toBe('[Tab]{kbd}\n')
  })
})

/*
 * `markup-carve/carve#1210` P1's row-group row for carve-js, under decision D1
 * as ruled: (b), emit only where the partition says something a reader cannot
 * derive from the rows alone.
 */
describe('table row groups on import', () => {
  const groupsOf = (html: string) =>
    (htmlToAst(html).value.children[0] as { rowGroups?: unknown }).rowGroups

  it('says nothing for the tables every renderer already derives', () => {
    // The derivation is: the leading run of all-header rows is the head,
    // everything after it is one body, no foot, no row-head columns. A
    // `<thead>` over a `<tbody>` IS that, and so is a bare header row - the
    // HTML parser wraps it in an implicit `<tbody>`, which is not a statement
    // about the table.
    expect(groupsOf('<table><thead><tr><th>h</th></tr></thead><tbody><tr><td>b</td></tr></tbody></table>')).toBeUndefined()
    expect(groupsOf('<table><tr><th>h</th></tr><tr><td>b</td></tr></table>')).toBeUndefined()
    expect(groupsOf('<table><tbody><tr><th>h</th></tr><tr><td>b</td></tr></tbody></table>')).toBeUndefined()
    expect(groupsOf('<table><tr><td>a</td></tr><tr><td>b</td></tr></table>')).toBeUndefined()
  })

  const nonTrivial: Array<[string, string, unknown]> = [
    [
      'a foot',
      '<table><thead><tr><th>h</th></tr></thead><tbody><tr><td>b</td></tr></tbody><tfoot><tr><td>f</td></tr></tfoot></table>',
      { headRows: 1, bodies: [{ headRows: 0, bodyRows: 1 }], footRows: 1 },
    ],
    [
      'a second body',
      '<table><tbody><tr><td>a</td></tr></tbody><tbody><tr><td>b</td></tr></tbody></table>',
      { headRows: 0, bodies: [{ headRows: 0, bodyRows: 1 }, { headRows: 0, bodyRows: 1 }], footRows: 0 },
    ],
    [
      'row-head columns',
      '<table><thead><tr><th>h</th><th>x</th></tr></thead><tbody><tr><th>r</th><td>1</td></tr><tr><th>s</th><td>2</td></tr></tbody></table>',
      { headRows: 1, bodies: [{ headRows: 0, bodyRows: 2, rowHeadColumns: 1 }], footRows: 0 },
    ],
    [
      'a head that is not header cells',
      // What Word and pandoc emit. The derived head is EMPTY here and the
      // stated one is not, so the two disagree and the field is the difference.
      '<table><thead><tr><td>h</td></tr></thead><tbody><tr><td>b</td></tr></tbody></table>',
      { headRows: 1, bodies: [{ headRows: 0, bodyRows: 1 }], footRows: 0 },
    ],
    [
      'a body with its own header rows under a head',
      '<table><thead><tr><th>h</th></tr></thead><tbody><tr><th>g</th></tr><tr><td>a</td></tr></tbody></table>',
      { headRows: 1, bodies: [{ headRows: 1, bodyRows: 1 }], footRows: 0 },
    ],
  ]

  for (const [name, html, expected] of nonTrivial) {
    it(`states the partition for ${name}`, () => {
      expect(groupsOf(html)).toEqual(expected)
    })
  }

  it('keeps a header-only first body as a body, since a second one follows it', () => {
    // Absorbing it into the head left ONE ordinary body, which the derivation
    // reproduces exactly - so the two bodies went silently, the opposite of
    // what the field is for. The absorption is for a single body group.
    expect(groupsOf('<table><tbody><tr><th>h</th></tr></tbody><tbody><tr><td>b</td></tr></tbody></table>')).toEqual({
      headRows: 0,
      bodies: [{ headRows: 1, bodyRows: 0 }, { headRows: 0, bodyRows: 1 }],
      footRows: 0,
    })
  })

  it('counts row-head COLUMNS, which spans make different from cells', () => {
    // `<th colspan="2">` is one element and two columns; a `<th rowspan="2">`
    // leaves the row below it starting with a data ELEMENT while a header still
    // occupies the column. Counting elements got both wrong.
    expect(groupsOf('<table><thead><tr><th>a</th><th>b</th><th>c</th></tr></thead><tbody><tr><th colspan="2">r</th><td>1</td></tr><tr><th colspan="2">s</th><td>2</td></tr></tbody></table>'))
      .toEqual({ headRows: 1, bodies: [{ headRows: 0, bodyRows: 2, rowHeadColumns: 2 }], footRows: 0 })
    expect(groupsOf('<table><thead><tr><th>a</th><th>b</th></tr></thead><tbody><tr><th rowspan="2">r</th><td>1</td></tr><tr><td>2</td></tr></tbody></table>'))
      .toEqual({ headRows: 1, bodies: [{ headRows: 0, bodyRows: 2, rowHeadColumns: 1 }], footRows: 0 })
    // Both dimensions at once. A carried `^` occupies ONE slot however many
    // columns its origin covers - that is the array-index model the renderer
    // resolves - so the row below a `<th rowspan="2" colspan="2">` has a single
    // slot standing for two columns, and counting slots reported one.
    expect(groupsOf('<table><thead><tr><th>a</th><th>b</th><th>c</th></tr></thead><tbody><tr><th rowspan="2" colspan="2">r</th><td>1</td></tr><tr><td>2</td></tr></tbody></table>'))
      .toEqual({ headRows: 1, bodies: [{ headRows: 0, bodyRows: 2, rowHeadColumns: 2 }], footRows: 0 })
  })

  it('partitions the rows it was built from, in every shape that emits one', () => {
    // PART 12 section 15's MUST, asserted where it CAN fail: over the produced
    // field against the produced rows. The producer itself does not check it -
    // both come from the same row list there, so such a check could not fail.
    for (const [, html] of nonTrivial) {
      const table = htmlToAst(html).value.children[0] as { rows: unknown[]; rowGroups: { headRows: number; footRows: number; bodies: Array<{ headRows: number; bodyRows: number }> } }
      const counted = table.rowGroups.headRows + table.rowGroups.footRows +
        table.rowGroups.bodies.reduce((total, body) => total + body.headRows + body.bodyRows, 0)

      expect(counted).toBe(table.rows.length)
    }
  })

  it('keeps it in the AST and reports it when a writer has to spell it', () => {
    // Carve source has no spelling for the field, so `htmlToAst` loses nothing
    // and `htmlToCarve` is where the loss happens - the split PART 12 section
    // 16 draws, and the same one the figure-wrapping-a-table loss uses.
    const html = '<table><tbody><tr><td>a</td></tr></tbody><tbody><tr><td>b</td></tr></tbody></table>'
    expect(htmlToAst(html).report.diagnostics).toEqual([])
    expect(htmlToCarve(html).report.diagnostics).toEqual([
      expect.objectContaining({
        code: 'structure-unspellable',
        severity: 'warning',
        message: expect.stringContaining('explicit head/body/foot grouping'),
        path: '/table[1]',
      }),
    ])
  })

  it('refuses to describe a head or foot that is not at the edge of the rows', () => {
    // The field can only say "the first N rows" and "the last N rows". A
    // `<thead>` after a `<tbody>` is a table it cannot describe, so the
    // grouping goes and is reported rather than being stated wrongly.
    const html = '<table><tbody><tr><td>b</td></tr></tbody><thead><tr><th>h</th></tr></thead></table>'
    expect(groupsOf(html)).toBeUndefined()
    expect(htmlToAst(html).report.diagnostics).toEqual([
      expect.objectContaining({ code: 'table-degraded', message: expect.stringContaining('not at the edge of its rows') }),
    ])
  })

  it('survives the wire in both directions', () => {
    const doc = htmlToAst('<table><thead><tr><th>h</th></tr></thead><tbody><tr><td>b</td></tr></tbody><tfoot><tr><td>f</td></tr></tfoot></table>').value
    const wire = toAstJson(doc)
    expect((wire.children[0] as { rowGroups?: unknown }).rowGroups).toEqual({ headRows: 1, bodies: [{ headRows: 0, bodyRows: 1 }], footRows: 1 })
    expect((fromAstJson(JSON.parse(JSON.stringify(wire))).children[0] as { rowGroups?: unknown }).rowGroups)
      .toEqual((doc.children[0] as { rowGroups?: unknown }).rowGroups)
  })
})

describe('a row-group partition arriving from outside', () => {
  const payload = (rowGroups: unknown) => ({
    type: 'document',
    srcByteLength: 0,
    children: [
      {
        type: 'table',
        rows: [
          { type: 'table_row', cells: [{ type: 'table_cell', header: true, children: [{ type: 'text', value: 'h' }] }] },
          { type: 'table_row', cells: [{ type: 'table_cell', header: false, children: [{ type: 'text', value: 'b' }] }] },
        ],
        rowGroups,
      },
    ],
  })

  it('is refused when the counts do not consume the rows', () => {
    /*
     * PART 12 section 15 makes it a MUST, and JSON SCHEMA CANNOT SAY SO: there
     * is no way to relate one field's value to the length of another's, so
     * `headRows: 5` on a two-row table validates cleanly. A green validator is
     * not evidence, which is why this is checked here.
     */
    expect(() => fromAstJson(payload({ headRows: 5, bodies: [{ headRows: 0, bodyRows: 1 }], footRows: 0 }) as never))
      .toThrow(AstJsonPartitionError)
    expect(() => fromAstJson(payload({ headRows: 0, bodies: [], footRows: 0 }) as never)).toThrow(AstJsonPartitionError)
    expect(() => fromAstJson(payload({ headRows: 1, bodies: [{ headRows: 0, bodyRows: 1 }], footRows: 1 }) as never))
      .toThrow(AstJsonPartitionError)
  })

  it('names both numbers, so the payload can be fixed', () => {
    try {
      fromAstJson(payload({ headRows: 5, bodies: [{ headRows: 0, bodyRows: 1 }], footRows: 0 }) as never)
      expect.unreachable('the partition should have been refused')
    } catch (error) {
      expect(error).toBeInstanceOf(AstJsonPartitionError)
      expect((error as AstJsonPartitionError).counted).toBe(6)
      expect((error as AstJsonPartitionError).rows).toBe(2)
      expect((error as Error).message).toContain('account for 6 rows of 2')
    }
  })

  it('CONTROL: a partition that does consume them is accepted', () => {
    expect(() => fromAstJson(payload({ headRows: 1, bodies: [{ headRows: 0, bodyRows: 1 }], footRows: 0 }) as never)).not.toThrow()
    expect(() => fromAstJson(payload({ headRows: 0, bodies: [{ headRows: 1, bodyRows: 1 }], footRows: 0 }) as never)).not.toThrow()
    // And a table with no grouping at all is not asked the question.
    expect(() => fromAstJson(payload(undefined) as never)).not.toThrow()
  })
})

/*
 * `markup-carve/carve#1210` P9's MathML row for carve-js, under decision D6 as
 * ruled: (a)+(b), a three-tier lookup for TeX already present in the source,
 * and no MathML-to-TeX converter.
 *
 * The fixtures are the four the ruling names, in the shapes their producers
 * actually emit.
 */
describe('MathML on import', () => {
  // en.wikipedia.org, Mathoid output: alttext and annotation both present and
  // equal, the `{\displaystyle …}` wrapper included in both.
  const WIKIPEDIA = '<p>Then <math xmlns="http://www.w3.org/1998/Math/MathML" alttext="{\\displaystyle E=mc^{2}}">'
    + '<semantics><mrow class="MJX-TeXAtom-ORD"><mstyle displaystyle="true" scriptlevel="0">'
    + '<mi>E</mi><mo>=</mo><mi>m</mi><msup><mi>c</mi><mn>2</mn></msup></mstyle></mrow>'
    + '<annotation encoding="application/x-tex">{\\displaystyle E=mc^{2}}</annotation></semantics></math> holds.</p>'

  // ar5iv/LaTeXML output: `display="block"`, `class="ltx_Math"`, a paragraph-scoped id.
  const AR5IV = '<p>See <math xmlns="http://www.w3.org/1998/Math/MathML" id="S1.p1.m1" class="ltx_Math" display="block"'
    + ' alttext="\\int_{0}^{1}x^{2}\\,dx=\\frac{1}{3}"><semantics><mrow><mi>x</mi></mrow>'
    + '<annotation encoding="application/x-tex">\\int_{0}^{1}x^{2}\\,dx=\\frac{1}{3}</annotation></semantics></math> above.</p>'

  // Hand-written presentation MathML: no annotation, no alttext, no TeX anywhere.
  const HAND_WRITTEN = '<p>Bare <math><mfrac><mn>1</mn><mn>2</mn></mfrac></math> here.</p>'

  // MathType's own binary encoding, base64 in the annotation. Not TeX, and a
  // substring test for `tex` is what would let a payload like it through.
  const MATHTYPE = '<p>MT <math><semantics><mrow><mi>a</mi></mrow>'
    + '<annotation encoding="MathType-MTEF">MTEFY9gaeaaaaaaa</annotation></semantics></math> end.</p>'

  it('TIER 1: reads the TeX from an annotation that declares it, byte for byte', () => {
    // Including the `{\displaystyle …}` wrapper: Carve's math content is opaque
    // TeX, so unwrapping it would be a second decision nobody asked for.
    const result = htmlToCarve(WIKIPEDIA)
    expect(result.value).toBe('Then $`{\\displaystyle E=mc^{2}}` holds.\n')
    // Tier 1 assumes nothing, so it reports nothing.
    expect(result.report.diagnostics).toEqual([])
  })

  it('TIER 1: display="block" is display math, and the element keeps its own attributes', () => {
    const result = htmlToAst(AR5IV)
    expect(result.value.children).toMatchObject([
      {
        type: 'paragraph',
        children: [
          { type: 'text', value: 'See ' },
          {
            type: 'math',
            display: true,
            content: '\\int_{0}^{1}x^{2}\\,dx=\\frac{1}{3}',
            attrs: { id: 'S1.p1.m1', classes: ['ltx_Math'] },
          },
          { type: 'text', value: ' above.' },
        ],
      },
    ])
    expect(result.report.diagnostics).toEqual([])
    expect(htmlToCarve(AR5IV).value).toBe('See $$`\\int_{0}^{1}x^{2}\\,dx=\\frac{1}{3}`{id=S1.p1.m1 .ltx_Math} above.\n')
  })

  it('TIER 1 beats TIER 2 where the two disagree', () => {
    // A declared encoding beats an undeclared attribute. carve-php's docblock
    // documents the reverse order, and this is the correction D6 rules.
    const html = '<p><math alttext="FROM_ALTTEXT"><semantics><mrow><mi>a</mi></mrow>'
      + '<annotation encoding="application/x-tex">FROM_ANNOTATION</annotation></semantics></math></p>'
    expect(htmlToCarve(html).value).toBe('$`FROM_ANNOTATION`\n')
  })

  it('TIER 2: falls back to alttext and says the encoding was assumed', () => {
    const html = '<p>Alt <math alttext="a^2"><mrow><mi>a</mi></mrow></math>.</p>'
    const result = htmlToCarve(html)
    expect(result.value).toBe('Alt $`a^2`.\n')
    expect(result.report.diagnostics).toEqual([
      {
        // `encoding-assumed`, not `element-unwrapped`: the loss being reported
        // is about the OUTPUT, whose content is only TeX while the guess
        // holds, and not about an element the input structured differently.
        code: 'encoding-assumed',
        severity: 'info',
        message: 'Read <math> through its alttext: MathML does not declare the encoding of alttext, so TeX is assumed',
        path: '/p[1]/math[2]',
      },
    ])
  })

  it('TIER 3: drops a hand-written element and names it, rather than reading 1/2 as 12', () => {
    /*
     * The measurement that settled D6. Before this branch existed the children
     * concatenated, and the paragraph read `Bare 12 here.` - one half arriving
     * as twelve, a plausible wrong value that survives review where a missing
     * equation and a warning naming it do not.
     */
    for (const mode of ['safe', 'semantic'] as const) {
      const result = htmlToCarve(HAND_WRITTEN, { mode })
      expect(result.value).not.toContain('12')
      expect(result.value).toBe('Bare  here.\n')
      expect(result.report.diagnostics).toEqual([
        {
          code: 'element-dropped',
          severity: 'warning',
          message: 'Dropped <math>: no TeX annotation and no alttext, and its children are a token stream, not an equation',
          path: '/p[1]/math[2]',
        },
      ])
    }
  })

  it('TIER 3: a MathType payload is not TeX, and is never read as any', () => {
    const result = htmlToCarve(MATHTYPE)
    expect(result.value).not.toContain('MTEF')
    expect(result.value).toBe('MT  end.\n')
    expect(result.report.diagnostics).toEqual([
      expect.objectContaining({ code: 'element-dropped', severity: 'warning' }),
    ])
  })

  it('TIER 3: text/plain is not TeX, though a substring test for tex says it is', () => {
    /*
     * The case that proves the whole-value match, which the MathType fixture
     * cannot: `MathType-MTEF` does not contain `tex` and so never exercises a
     * loose comparison, while `text/plain` does. carve-php read this one as an
     * equation until the same ruling landed there.
     */
    const html = '<p><math><semantics><mrow><mn>1</mn></mrow>'
      + '<annotation encoding="text/plain">one over two</annotation></semantics></math></p>'
    const result = htmlToCarve(html)
    expect(result.value).not.toContain('one over two')
    expect(result.report.diagnostics.map((d) => d.code)).toEqual(['element-dropped'])
  })

  it('TIER 3: an encoding that only LOOKS like one of the three is not one of the three', () => {
    // The match is on the whole value, case-insensitively. A substring test for
    // `tex` accepts every line here, and each would hand a math node content
    // that is not TeX or not the element's own presentation.
    for (const encoding of ['application/x-tex;charset=utf-8', 'application/mathml-content', 'TeX-and-more', 'StarMath 5.0', 'text/plain']) {
      const html = `<p><math><semantics><mrow><mi>a</mi></mrow><annotation encoding="${encoding}">PAYLOAD</annotation></semantics></math></p>`
      expect(htmlToCarve(html).value).toBe('\n')
    }
    // And the three themselves are matched whatever their case.
    for (const encoding of ['application/x-tex', 'TEXT/X-TEX', 'LaTeX', ' latex ']) {
      const html = `<p><math><semantics><mrow><mi>a</mi></mrow><annotation encoding="${encoding}">x</annotation></semantics></math></p>`
      expect(htmlToCarve(html).value).toBe('$`x`\n')
    }
  })

  it('TIER 3: a nested annotation-xml payload does not leak into the match', () => {
    // Both hops are direct children - `<semantics>` of the `<math>`, the
    // annotation of that `<semantics>`. A recursive lookup by tag name reaches
    // an annotation describing some OTHER expression and reports nothing.
    const html = '<p><math><semantics><mrow><mi>a</mi></mrow>'
      + '<annotation-xml encoding="application/mathml-content">'
      + '<annotation encoding="application/x-tex">LEAK</annotation>'
      + '</annotation-xml></semantics></math></p>'
    expect(htmlToCarve(html).value).toBe('\n')
    expect(htmlToCarve(html).report.diagnostics.map((d) => d.code)).toEqual(['element-dropped'])
  })

  it('TIER 2: an annotation that holds only whitespace falls through, and says so', () => {
    // The diagnostic follows which tier SUPPLIED the content. Reading the
    // presence of the annotation ELEMENT instead makes this the one tier-2
    // read that assumes an encoding in silence.
    const html = '<p><math alttext="a^2"><semantics><mrow><mi>a</mi></mrow>'
      + '<annotation encoding="application/x-tex">\n  \n</annotation></semantics></math></p>'
    const result = htmlToCarve(html)
    expect(result.value).toBe('$`a^2`\n')
    expect(result.report.diagnostics).toEqual([
      {
        code: 'encoding-assumed',
        severity: 'info',
        message: 'Read <math> through its alttext: MathML does not declare the encoding of alttext, so TeX is assumed',
        path: '/p[1]/math[1]',
      },
    ])
  })

  it('TIER 1: an empty annotation does not settle the tier for a sibling that is not', () => {
    // A `<semantics>` may carry several annotations. Stopping at the first
    // whose ENCODING matches answers tier 2 or tier 3 for a document that has
    // its TeX one sibling further along.
    const html = '<p><math alttext="FROM_ALTTEXT"><semantics><mrow><mi>a</mi></mrow>'
      + '<annotation encoding="application/x-tex"> </annotation>'
      + '<annotation encoding="text/x-tex">FROM_SECOND</annotation></semantics></math></p>'
    const result = htmlToCarve(html)
    expect(result.value).toBe('$`FROM_SECOND`\n')
    expect(result.report.diagnostics).toEqual([])
  })

  it('charges the subtree once, not once per arm that decided to skip it', () => {
    // The dropped element is charged by the caller, which is the only place
    // that knows the branch was taken. Charging inside the tier lookup as well
    // counted every descendant of an empty-annotation element twice, and a
    // document could fail `maxNodes` on nodes it has only one of.
    const html = '<p><math><semantics><mrow><mi>a</mi></mrow>'
      + '<annotation encoding="application/x-tex"> </annotation></semantics></math></p>'
    // 8 nodes: the paragraph, the `<math>`, and its six descendants -
    // semantics, mrow, mi, its text, annotation, its text.
    expect(() => htmlToAst(html, { maxNodes: 8 })).not.toThrow()
    expect(() => htmlToAst(html, { maxNodes: 7 })).toThrow(HtmlImportLimitError)
  })

  it('TIER 3: an empty annotation and an empty alttext say nothing, so they are not content', () => {
    const empty = '<p><math alttext="  "><semantics><mrow><mi>a</mi></mrow>'
      + '<annotation encoding="application/x-tex">\n  \n</annotation></semantics></math></p>'
    expect(htmlToCarve(empty).report.diagnostics.map((d) => d.code)).toEqual(['element-dropped'])
  })

  it('reports what a mapped element still loses, so a handler does not vanish with it', () => {
    /*
     * The tier lookup returns before the generic arm reads the attributes, so
     * the element's own attribute walk has to happen inside it. Without that,
     * `<math onclick>` with a usable annotation imports as a LOSSLESS document
     * and the handler leaves no trace at all.
     */
    const html = '<p><math onclick="evil()" data-src="x"><semantics><mrow><mi>a</mi></mrow>'
      + '<annotation encoding="application/x-tex">a</annotation></semantics></math></p>'
    const result = htmlToCarve(html, { mode: 'semantic' })
    expect(result.value).toBe('$`a`{data-src=x}\n')
    expect(result.report.diagnostics).toEqual([
      expect.objectContaining({ code: 'attribute-dropped', severity: 'warning', message: 'Dropped event-handler attribute onclick on <math>' }),
    ])
    // And the three the mapping CONSUMES are not reported as losses.
    expect(htmlToCarve('<p><math xmlns="http://www.w3.org/1998/Math/MathML" display="block" alttext="x"></math></p>').report.diagnostics.map((d) => d.code))
      .toEqual(['encoding-assumed'])
  })

  it('CONTROL: roundtrip keeps the whole element, exactly as it did before this mapping', () => {
    /*
     * That mode's contract is Carve-produced HTML, which spells math as a
     * `<span class="math">` and never as a `<math>`, so a `<math>` arriving
     * there is foreign markup and preserving it verbatim is the answer. This
     * arm is not the one D6 changed.
     */
    for (const html of [HAND_WRITTEN, MATHTYPE]) {
      const result = htmlToCarve(html, { mode: 'roundtrip' })
      expect(result.value).toContain('<math>')
      expect(result.value).toContain('</math>')
      // One entry for the element, where the generic arm reported one per
      // descendant on the way past. The descendants are not preserved
      // separately - they are inside this one raw span.
      expect(result.report.diagnostics).toEqual([
        { code: 'raw-preserved', severity: 'warning', message: 'Preserved unsupported <math> element as raw HTML', path: '/p[1]/math[2]' },
      ])
    }
    expect(htmlToCarve(HAND_WRITTEN, { mode: 'roundtrip' }).value)
      .toBe('Bare `<math><mfrac><mn>1</mn><mn>2</mn></mfrac></math>`{=html} here.\n')
  })

  it('charges the subtree it does not walk, so an accepted element keeps the limits', () => {
    /*
     * Tiers 1 and 2 read one node of the subtree and discard the rest, so
     * `inlines()` never counts a descendant. Left uncharged, an accepted
     * `<math>` was the one element whose children answered to neither
     * `maxNodes` nor `maxDepth`, and a deep annotation reached `text()` and
     * raised a RangeError where the API contract is a typed error.
     */
    const nest = (n: number): string => '<mrow>'.repeat(n) + '<mi>a</mi>' + '</mrow>'.repeat(n)
    const withTex = (body: string): string =>
      `<p><math><semantics>${body}<annotation encoding="application/x-tex">x</annotation></semantics></math></p>`

    expect(() => htmlToAst(withTex(nest(400)))).toThrow(HtmlImportLimitError)
    expect(() => htmlToAst(withTex(nest(2)), { maxNodes: 4 })).toThrow(HtmlImportLimitError)
    // Inside the annotation itself, which is the subtree `text()` recurses into.
    expect(() => htmlToAst(`<p><math><semantics><annotation encoding="application/x-tex">${nest(400)}</annotation></semantics></math></p>`))
      .toThrow(HtmlImportLimitError)
    // And the tier-3 drop returns without walking them too.
    expect(() => htmlToAst(`<p><math>${nest(400)}</math></p>`)).toThrow(HtmlImportLimitError)
    // CONTROL: the ordinary element passes both budgets and is still read.
    expect(htmlToCarve(withTex(nest(2))).value).toBe('$`x`\n')
  })

  it('and reaches the counter rather than the stack, where a caller raised the depth limit', () => {
    // `maxDepth` is the caller's, and above the interpreter's stack a walk that
    // recurses stops being a guard and becomes the thing being guarded against:
    // it raises a RangeError instead of counting. At the default limit the two
    // shapes are indistinguishable, which is why this test sets its own.
    const nest = (n: number): string => '<mrow>'.repeat(n) + '<mi>a</mi>' + '</mrow>'.repeat(n)
    const result = htmlToAst(`<p><math alttext="x">${nest(20_000)}</math></p>`, { maxDepth: 100_000, maxNodes: 5_000_000 })
    expect(result.value.children).toMatchObject([{ type: 'paragraph', children: [{ type: 'math', content: 'x' }] }])
    // Reading the annotation is the same walk once the budget has accepted it.
    const annotated = htmlToAst(
      `<p><math><semantics><annotation encoding="application/x-tex">a${nest(20_000)}b</annotation></semantics></math></p>`,
      { maxDepth: 100_000, maxNodes: 5_000_000 },
    )
    expect(annotated.value.children).toMatchObject([{ type: 'paragraph', children: [{ type: 'math', content: 'aab' }] }])
  })

  it('CONTROL: a document with no math is not touched by any of it', () => {
    const html = '<p>A <em>plain</em> paragraph with an <a href="https://example.com">link</a>.</p>'
    const result = htmlToCarve(html)
    expect(result.value).toBe('A /plain/ paragraph with an [link](https://example.com).\n')
    expect(result.report.diagnostics).toEqual([])
  })
})
