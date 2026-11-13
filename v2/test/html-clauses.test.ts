// One test per clause of spec/0.2/html.md that states behavior, named with the id of the clause.
import { describe, expect, it } from 'vitest'
import {
  type AstNode, CarveOptionError, CarveRenderError, decodeTree, encodeTree, parse, render, type RenderOptions,
  renderWithDiagnostics,
} from '../src/index.ts'
import { documentOf, paragraph, text } from './support/tree.ts'

/** [clause ids and subject, source, expected HTML, options]. */
type Case = readonly [string, string, string, RenderOptions?]

function check(cases: readonly Case[]): void {
  for (const [name, src, html, options] of cases) {
    it(name, () => {
      expect(render(src, options)).toBe(html)
    })
  }
}

function lossCodes(input: string | AstNode, options?: RenderOptions): string[] {
  return renderWithDiagnostics(input, options).diagnostics.filter((entry) => entry.channel === 'render-loss').map((entry) => entry.code)
}

describe('output form', () => {
  check([
    ['C2-H-001: a fragment with no wrapper and no line ending after the last block', 'a\n\nb\n', '<p>a</p>\n<p>b</p>'],
    ['C2-H-002: the three markup characters and the no-break space are entities in text', 'a & b < c > d\\ e "f"', '<p>a &amp; b &lt; c &gt; d&nbsp;e “f”</p>'],
    ['C2-H-003: an attribute value stands in double quotes with five characters escaped', '[t]{k="a&b<c>d\\"e\'f"}', '<p><span k="a&amp;b&lt;c&gt;d&quot;e&apos;f">t</span></p>'],
    ['C2-H-004: a void element has no trailing slash', '***\n\n![a](b) x\\\ny', '<hr>\n<p><img src="b" alt="a"> x<br>\ny</p>'],
    ['C2-H-005: child blocks are indented by two spaces per level; inline content stays on the line of its block', '> a\n> b\n>\n> - c\n>\n>   d', '<blockquote>\n  <p>a\nb</p>\n  <ul>\n    <li>c\n      <p>d</p>\n    </li>\n  </ul>\n</blockquote>'],
    ['C2-H-006: a quote whose only visible child is one paragraph is written on one line', '> q\n> %% c', '<blockquote><p>q</p></blockquote>'],
    ['C2-H-007: an item with one paragraph is one line; with more blocks the first paragraph stands on the line of li', '- a\n- b\n\n  c\n\n- d', '<ul>\n  <li><p>a</p></li>\n  <li><p>b</p>\n    <p>c</p>\n  </li>\n  <li><p>d</p></li>\n</ul>'],
    ['C2-H-008: a container whose body renders nothing keeps one empty line between its tags', '::: note\n:::\n\n::: |\n:::\n\n::: \\\n:::\n\n::: figure\n:::', '<aside class="admonition note" aria-label="Note">\n\n</aside>\n<div class="line-block">\n\n</div>\n<div class="hardbreaks">\n\n</div>\n<figure class="carve-figure-group">\n\n</figure>'],
  ])
})

describe('attributes', () => {
  check([
    ['C2-H-009: structural attributes, then id, class, language and the keys as written', '{k=v :en .c #i}\n2) a', '<ol start="2" data-delim=")" id="i" class="c" lang="en" k="v">\n  <li>a</li>\n</ol>'],
    ['C2-H-010: the structural attributes of a link and of an image stand in their fixed order', '[a](b "T"){#i} ![c](d "U"){.x}', '<p><a href="b" title="T" id="i">a</a> <img src="d" alt="c" title="U" class="x"></p>'],
    ['C2-H-011: on a footnote reference the id stands before href; on a mention the class stands first', 'a[^n]{.c} @ann\n\n[^n]: x', '<p>a<a id="fnref1" href="#fn1" role="doc-noteref" class="c"><sup>1</sup></a> <span class="mention"><strong>@ann</strong></span></p>\n<section role="doc-endnotes" aria-label="Footnotes">\n  <hr>\n  <ol>\n    <li id="fn1">\n      <p>x<a href="#fnref1" role="doc-backlink" aria-label="Back to reference">↩</a></p>\n    </li>\n  </ol>\n</section>'],
    ['C2-H-012: a base class stands first, the authored classes follow, and a class the marker generates stands last', '{.a}\n::: |\nx\n:::\n\n{.b}\n- [ ] t\n\n{.c}\n::: tip\n:::\n\n$`m`{.d}', '<div class="a line-block">\n  <p>x</p>\n</div>\n<ul class="task-list b">\n  <li><input type="checkbox" disabled aria-label="t"> t</li>\n</ul>\n<aside class="admonition tip c" aria-label="Tip">\n\n</aside>\n<p><span class="math inline d" role="math">\\(m\\)</span></p>'],
    ['C2-H-012: a class that occurs twice is written once', '{.hardbreaks .a .a}\n::: \\\n:::', '<div class="hardbreaks a">\n\n</div>'],
    ['C2-H-013: a structural attribute replaces an authored key of the same name, and an authored key every other generated one', '[a](b){HREF=x k=1} $`m`{role=img}', '<p><a href="b" k="1">a</a> <span class="math inline" role="img">\\(m\\)</span></p>'],
    ['C2-H-014: an attribute with the empty value is written as name=""', '[t]{hidden k=""}', '<p><span hidden="" k="">t</span></p>'],
    ['C2-H-015: an align key on a paragraph, a div or a heading is a text-align declaration behind an authored style', '{align=center}\na\n\n{style="color: red" align=right k=v}\n# H\n\n{align=justify}\nb\n\n[c]{align=left}', '<p style="text-align: center;">a</p>\n<section id="H">\n  <h1 style="color: red; text-align: right;" k="v">H</h1>\n  <p align="justify">b</p>\n  <p><span align="left">c</span></p>\n</section>'],
    ['C2-H-016: with sourceLines each block element carries the line it starts on as its last attribute', '{data-source-line=9 .c}\na\n\n- b\n\n  > c', '<p class="c" data-source-line="1">a</p>\n<ul data-source-line="4">\n  <li data-source-line="4">b\n    <blockquote data-source-line="6"><p data-source-line="6">c</p></blockquote>\n  </li>\n</ul>', { sourceLines: true }],
    ['C2-H-017: the filter removes an attribute and blanks a value; it never removes an element', '[t]{onclick="x()" srcdoc=y k=javascript:z style="background: url(x)"}', '<p><span k="" style="">t</span></p>'],
  ])
})

describe('paragraphs, headings and sections', () => {
  check([
    ['C2-H-018: a paragraph is p around its inline content', 'a *b*', '<p>a <strong>b</strong></p>'],
    ['C2-H-019: a paragraph that holds only comments renders nothing', '{% only %}\n\na', '<p>a</p>'],
    ['C2-H-020: a block image is written without its p, also where it is an unresolved reference', '![a](b)\n\n![c][nope]\n\n![d](e) f', '<img src="b" alt="a">\n![c][nope]\n<p><img src="e" alt="d"> f</p>'],
    ['C2-H-022: every heading has an id, authored or generated', '# One two\n\n{#mine}\n## Three', '<h1 id="One-two">One two</h1>\n<h2 id="mine">Three</h2>', { sections: false }],
    ['C2-H-022, C2-H-131: with headingIds off no id is generated, and an authored id is still written', '# One\n\n{#mine}\n# Two', '<h1>One</h1>\n<h1 id="mine">Two</h1>', { sections: false, headingIds: 'off' }],
    ['C2-H-022: lower folds the slug to lower case', '# One Two', '<h1 id="one-two">One Two</h1>', { sections: false, headingIds: 'lower' }],
    ['C2-H-023: the carriers say whether the id of a heading was authored or generated', '# A\n\n{#b}\n# B', '<h1 data-carve-generated-id id="A">A</h1>\n<h1 data-carve-explicit-id id="b">B</h1>', { sections: false, roundtrip: true }],
    ['C2-H-024: a slug that is taken gets a suffix, and an authored id is written as the author wrote it', '# T\n\n# T\n\n{#T}\nx\n\n{#T}\ny', '<h1 id="T-2">T</h1>\n<h1 id="T-3">T</h1>\n<p id="T">x</p>\n<p id="T">y</p>', { sections: false }],
    ['C2-H-026: a top-level heading opens a section up to the next heading of the same or a lower level number; a skipped level makes none', '# A\n\na\n\n### C\n\n## B\n\n# D', '<section id="A">\n  <h1>A</h1>\n  <p>a</p>\n  <section id="C">\n    <h3>C</h3>\n  </section>\n  <section id="B">\n    <h2>B</h2>\n  </section>\n</section>\n<section id="D">\n  <h1>D</h1>\n</section>'],
    ['C2-H-027: the id of a heading that opens a section is on the section, every other attribute on the heading', '{#i .c k=v :en}\n# H', '<section id="i">\n  <h1 class="c" lang="en" k="v">H</h1>\n</section>'],
    ['C2-H-028: a heading inside a container opens no section and carries its id itself', '> # Q\n\n- # L', '<blockquote>\n  <h1 id="Q">Q</h1>\n</blockquote>\n<ul>\n  <li>\n    <h1 id="L">L</h1>\n  </li>\n</ul>'],
    ['C2-H-127: with sections off no heading opens a section', '# A\n\nx', '<h1 id="A">A</h1>\n<p>x</p>', { sections: false }],
  ])

  it('C2-H-021: a level above 6 is a div that keeps the true level, and it nests sections by its level', () => {
    const heading = (level: number, value: string): AstNode => ({ type: 'heading', level, children: [text(value)] })
    expect(render(documentOf(heading(6, 'six'), heading(8, 'eight'), paragraph('x'), heading(7, 'seven')))).toBe(
      '<section id="six">\n  <h6>six</h6>\n  <section id="eight">\n    <div role="heading" aria-level="8">eight</div>\n    <p>x</p>\n  </section>\n'
      + '  <section id="seven">\n    <div role="heading" aria-level="7">seven</div>\n  </section>\n</section>',
    )
  })
})

describe('lists', () => {
  check([
    ['C2-H-029: a bullet list is ul, an ordered list is ol, an item is li', '- a\n\n1. b', '<ul>\n  <li>a</li>\n</ul>\n<ol>\n  <li>b</li>\n</ol>'],
    ['C2-H-030: an ordered list carries type when its style is not decimal and start when it does not start at 1', 'c.  x\n\niv)  y\n\nI.  z\n\n3. w', '<ol type="a" start="3">\n  <li>x</li>\n</ol>\n<ol type="i" start="4" data-delim=")">\n  <li>y</li>\n</ol>\n<ol type="I">\n  <li>z</li>\n</ol>\n<ol start="3">\n  <li>w</li>\n</ol>'],
    ['C2-H-031: the delimiter ) gives data-delim on every render', '1) a', '<ol data-delim=")">\n  <li>a</li>\n</ol>'],
    ['C2-H-032, C2-H-033: a task item starts with its box and carries its state; the list carries task-list', '- [ ] a *b*\n- [x] c\n- [/] d', '<ul class="task-list">\n  <li><input type="checkbox" disabled aria-label="a b"> a <strong>b</strong></li>\n  <li data-task-state="x"><input type="checkbox" checked disabled aria-label="c"> c</li>\n  <li data-task-state="/"><input type="checkbox" disabled aria-label="d"> d</li>\n</ul>'],
    ['C2-H-034: in a tight list only the first paragraph of an item is bare', '- a\n\n  b\n- > q\n\n  c', '<ul>\n  <li>a\n    <p>b</p>\n  </li>\n  <li>\n    <blockquote><p>q</p></blockquote>\n    <p>c</p>\n  </li>\n</ul>'],
    ['C2-H-035: in a loose list every paragraph gets p', '- a\n\n- b', '<ul>\n  <li><p>a</p></li>\n  <li><p>b</p></li>\n</ul>'],
    ['C2-H-037: the bullet character adds nothing by default and is carried by data-marker under roundtrip', '* a', '<ul>\n  <li>a</li>\n</ul>'],
    ['C2-H-037, C2-H-138: under roundtrip a star list carries data-marker and every tight list data-carve-tight', '* a\n\n- b\n\n- c', '<ul data-marker="*" data-carve-tight>\n  <li>a</li>\n</ul>\n<ul>\n  <li><p>b</p></li>\n  <li><p>c</p></li>\n</ul>', { roundtrip: true }],
  ])

  it('C2-H-036: the renderer reads list.spacing and derives nothing from the blocks of an item', () => {
    const item = (...children: AstNode[]): AstNode => ({ type: 'list_item', children })
    const list = (spacing: string): AstNode => documentOf({ type: 'list', marker: { kind: 'bullet', char: '-' }, spacing, children: [item(paragraph('a'), paragraph('b'))] })
    expect(render(list('tight'))).toBe('<ul>\n  <li>a\n    <p>b</p>\n  </li>\n</ul>')
    expect(render(list('loose'))).toBe('<ul>\n  <li><p>a</p>\n    <p>b</p>\n  </li>\n</ul>')
  })
})

describe('description lists', () => {
  check([
    ['C2-H-038, C2-H-039: dl, dt and dd; a term holds inline content and never a p', ':: *t*\n: d', '<dl>\n  <dt><strong>t</strong></dt>\n  <dd>d</dd>\n</dl>'],
    ['C2-H-040: a description with one block writes a paragraph bare, with several every paragraph gets p', ':: t\n: a\n: b\n\n  c\n: > q', '<dl>\n  <dt>t</dt>\n  <dd>a</dd>\n  <dd>\n    <p>b</p>\n    <p>c</p>\n  </dd>\n  <dd>\n    <blockquote><p>q</p></blockquote>\n  </dd>\n</dl>'],
  ])
})

describe('quotes, divs and their sigil forms', () => {
  check([
    ['C2-H-041: the quote fence and quote marks give the same output', '::: >\nq\n:::\n\n> q', '<blockquote><p>q</p></blockquote>\n<blockquote><p>q</p></blockquote>'],
    ['C2-H-042: the name of a div is its first class, and a title is its first child', '{.x}\n::: spoiler "T *b*"\na\n:::', '<div class="spoiler x">\n  <p class="admonition-title">T <strong>b</strong></p>\n  <p>a</p>\n</div>'],
    ['C2-H-042: an admonition is an aside that its title labels, or else the name of its kind', '::: warning\nw\n:::\n\n::: note "T"\nn\n:::', '<aside class="admonition warning" aria-label="Warning">\n  <p>w</p>\n</aside>\n<aside class="admonition note" aria-labelledby="adm-1">\n  <p class="admonition-title" id="adm-1">T</p>\n  <p>n</p>\n</aside>'],
    ['C2-H-042: a directive is a div with its name as a class', '::: toc\n:::', '<div class="toc">\n\n</div>'],
    ['C2-H-043: a line block is one p per stanza; every break is br and leading spaces are no-break spaces', '::: |\na\n  b\n\nc\n:::', '<div class="line-block">\n  <p>a<br>\n&nbsp;&nbsp;b</p>\n  <p>c</p>\n</div>'],
    ['C2-H-044: the two forms of a hard-break block give the same output', '::: \\\na\nb\n:::\n\n{.hardbreaks}\n:::\na\nb\n:::', '<div class="hardbreaks">\n  <p>a<br>\nb</p>\n</div>\n<div class="hardbreaks">\n  <p>a<br>\nb</p>\n</div>'],
    ['C2-H-045: a hard break is br and a line break; a soft break is a line break', 'a\\\nb\nc', '<p>a<br>\nb\nc</p>'],
    ['C2-H-046: a thematic break is hr', '{.c}\n***', '<hr class="c">'],
    ['C2-H-136: a line that holds only a braced comment renders as an empty line', '::: |\na\n{% c %}\nb\n:::', '<div class="line-block">\n  <p>a<br>\n<br>\nb</p>\n</div>'],
  ])
})

describe('code and raw content', () => {
  check([
    ['C2-H-047: a code block is pre and code around its escaped value, with its language as a class', '```js\na < b\n\n  c\n```\n\n```\n```', '<pre><code class="language-js">a &lt; b\n\n  c\n</code></pre>\n<pre><code></code></pre>'],
    ['C2-H-048: the attributes go on pre, and an authored title key wins over the title of the opener', '{.c title="mine"}\n```js "theirs"\nx\n```\n\n```py "t"\ny\n```', '<pre class="c" title="mine"><code class="language-js">x\n</code></pre>\n<pre title="t"><code class="language-py">y\n</code></pre>'],
    ['C2-H-049: a code span is code; a literal-text span is its escaped content, or a span when it carries attributes', '`a<b`{.c} !`x<y` !`z`{.d}', '<p><code class="c">a&lt;b</code> x&lt;y <span class="d">z</span></p>'],
    ['C2-H-050, C2-H-051: with rawHtml off raw HTML is escaped, a block as a code block of the language html', '```=html\n<b>x</b>\n```\n\na `<i>`{=html}', '<pre><code class="language-html">&lt;b&gt;x&lt;/b&gt;\n</code></pre>\n<p>a &lt;i&gt;</p>'],
    ['C2-H-053: with rawHtml on raw HTML is written verbatim, a block at column 0', '> ```=html\n> <b>x</b>\n>  <i>\n> ```\n\na `<i>y</i>`{=html}', '<blockquote>\n<b>x</b>\n <i>\n</blockquote>\n<p>a <i>y</i></p>', { rawHtml: true }],
    ['C2-H-134: with rawHtml on a raw block with no line and one with a blank line both write one empty line', '```=html\n```\n\n```=html\n\n```', '\n', { rawHtml: true }],
  ])

  it('C2-H-052: the escaped form is not a render loss', () => {
    expect(lossCodes('```=html\n<b>\n```')).toEqual([])
  })

  it('C2-H-054: raw content in another format renders nothing and is reported', () => {
    expect(render('a `x`{=latex} b\n\n```=latex\ny\n```')).toBe('<p>a  b</p>')
    expect(lossCodes('a `x`{=latex} b\n\n```=latex\ny\n```')).toEqual(['raw-format-dropped', 'raw-format-dropped'])
  })
})

describe('tables', () => {
  check([
    ['C2-H-055: thead, tbody and tfoot on their own lines, one row per line; an empty group is not written', '{footer-rows=1}\n|= h |\n| a |\n| f |\n\n|= only |', '<table>\n  <thead>\n    <tr><th scope="col">h</th></tr>\n  </thead>\n  <tbody>\n    <tr><td>a</td></tr>\n  </tbody>\n  <tfoot>\n    <tr><td>f</td></tr>\n  </tfoot>\n</table>\n<table>\n  <thead>\n    <tr><th scope="col">only</th></tr>\n  </thead>\n</table>'],
    ['C2-H-056: a header cell in the head carries scope col, one outside it scope row', '|= h |= i |\n|= r | d |', '<table>\n  <thead>\n    <tr><th scope="col">h</th><th scope="col">i</th></tr>\n  </thead>\n  <tbody>\n    <tr><th scope="row">r</th><td>d</td></tr>\n  </tbody>\n</table>'],
    ['C2-H-057: a resolved alignment is a style that follows an authored style', '|={>} a |={~ style="color: red"} b |\n| c |{<} d |', '<table>\n  <thead>\n    <tr><th scope="col" style="text-align: right;">a</th><th scope="col" style="color: red; text-align: center;">b</th></tr>\n  </thead>\n  <tbody>\n    <tr><td style="text-align: right;">c</td><td style="text-align: left;">d</td></tr>\n  </tbody>\n</table>'],
    ['C2-H-058: rowspan and colspan are written for a count above 1, and a covered cell is not written', '| a | < | b |\n| c | d | ^ |', '<table>\n  <tbody>\n    <tr><td colspan="2">a</td><td rowspan="2">b</td></tr>\n    <tr><td>c</td><td>d</td></tr>\n  </tbody>\n</table>'],
    ['C2-H-059: widths gives a colgroup', '{widths="30,70"}\n| a | b |', '<table>\n  <colgroup>\n    <col style="width: 30%;">\n    <col style="width: 70%;">\n  </colgroup>\n  <tbody>\n    <tr><td>a</td><td>b</td></tr>\n  </tbody>\n</table>'],
    ['C2-H-060: a row span that crosses into the foot gives one tbody that holds every row', '{footer-rows=1}\n| a |\n| ^ |', '<table>\n  <tbody>\n    <tr><td rowspan="2">a</td></tr>\n    <tr></tr>\n  </tbody>\n</table>'],
    ['C2-H-061: the caption is the first child of the table, and the attributes stay on the table', '{#t .c}\n| a |{.r}\n^ *C*', '<table id="t" class="c">\n  <caption><strong>C</strong></caption>\n  <tbody>\n    <tr class="r"><td>a</td></tr>\n  </tbody>\n</table>'],
  ])

  it('C2-A-093, C2-A-175: a supplied cell with counts and no marks covers the positions its counts give, and blocks in a cell are rendered', () => {
    const cell = (value: string, extra: Partial<AstNode> = {}): AstNode => ({ type: 'table_cell', header: false, children: [{ type: 'cell_paragraph', children: [text(value)] }], ...extra })
    const row = (...cells: AstNode[]): AstNode => ({ type: 'table_row', children: cells })
    const columns: AstNode[] = [{ type: 'table_column' }, { type: 'table_column' }, { type: 'table_column', align: 'right' }]
    const body: AstNode = { type: 'table_body', children: [row(cell('a', { rowspan: 2, colspan: 2 }), cell('b')), row(cell('c')), row({ type: 'table_cell', header: false, children: [paragraph('p')] })] }
    expect(render(documentOf({ type: 'table', columns, children: [body] }))).toBe(
      '<table>\n  <tbody>\n    <tr><td rowspan="2" colspan="2">a</td><td style="text-align: right;">b</td></tr>\n'
      + '    <tr><td style="text-align: right;">c</td></tr>\n    <tr><td><p>p</p></td></tr>\n  </tbody>\n</table>',
    )
  })
})

describe('captions and figures', () => {
  check([
    ['C2-H-062, C2-H-063: a captioned block is a figure around the block and its figcaption; the attribute line applies to the figure', '{#f .c}\n> q\n^ who', '<figure id="f" class="c">\n  <blockquote><p>q</p></blockquote>\n  <figcaption>who</figcaption>\n</figure>'],
    ['C2-H-064: a figure group and its panels carry their classes, and the caption of the group is its last child', '::: figure\n![a](b)\n^ one\n:::\n^ both', '<figure class="carve-figure-group">\n  <figure class="carve-figure-panel">\n    <img src="b" alt="a">\n    <figcaption>one</figcaption>\n  </figure>\n  <figcaption>both</figcaption>\n</figure>'],
    ['C2-H-065: a caption with one paragraph writes it bare, and its line breaks are soft breaks', '| a |\n^ one\ntwo', '<table>\n  <caption>one\ntwo</caption>\n  <tbody>\n    <tr><td>a</td></tr>\n  </tbody>\n</table>'],
    ['C2-H-066, C2-H-135: the number mark is the number of the caption in the sequence of its label; a panel caption takes none', '| a |\n^ Table #: x\n\n| b |\n^ Table #\n\n::: figure\n![a](b)\n^ P #\n:::\n^ Figure #', '<table>\n  <caption>Table 1: x</caption>\n  <tbody>\n    <tr><td>a</td></tr>\n  </tbody>\n</table>\n<table>\n  <caption>Table 2</caption>\n  <tbody>\n    <tr><td>b</td></tr>\n  </tbody>\n</table>\n<figure class="carve-figure-group">\n  <figure class="carve-figure-panel">\n    <img src="b" alt="a">\n    <figcaption>P #</figcaption>\n  </figure>\n  <figcaption>Figure 1</figcaption>\n</figure>'],
    ['C2-H-067: under roundtrip the number is wrapped in a span', '| a |\n^ T #', '<table>\n  <caption>T <span data-carve-caption-number>1</span></caption>\n  <tbody>\n    <tr><td>a</td></tr>\n  </tbody>\n</table>', { roundtrip: true }],
    ['C2-H-077: a math block is p around the display form, and it takes a caption', '$$`x`\n^ Equation #', '<figure>\n  <p><span class="math display" role="math">\\[x\\]</span></p>\n  <figcaption>Equation 1</figcaption>\n</figure>'],
  ])

  it('C2-H-065, C2-H-068: a supplied caption with several blocks gives every paragraph p, and caption.short is not written', () => {
    const caption: AstNode = { type: 'caption', children: [paragraph('a'), paragraph('b')], short: [text('s')] }
    expect(render(documentOf({ type: 'figure', children: [{ type: 'thematic_break' }], caption }))).toBe(
      '<figure>\n  <hr>\n  <figcaption>\n    <p>a</p>\n    <p>b</p>\n  </figcaption>\n</figure>',
    )
  })
})

describe('comments, frontmatter and definitions', () => {
  check([
    ['C2-H-069: a comment renders nothing in every form, and the whitespace around a braced comment stays', 'a {% c %} b %% d\n\n%%%\nx\n%%%\n\n> %% e', '<p>a  b</p>\n<blockquote>\n\n</blockquote>'],
    ['C2-H-070, C2-H-071: frontmatter and the definitions render nothing', '---\na: b\n---\n\n[r]: /u\n*[A]: b\n[^unused]: c\n\nx', '<p>x</p>'],
    ['C2-H-133: an include directive renders as a paragraph that holds the directive as text', '{{  a.crv #s @code:js @lines:1-2 }}', '<p>{{ a.crv #s @lines:1-2 @code:js }}</p>'],
  ])

  it('C2-H-133: the unexpanded include is reported', () => {
    expect(lossCodes('{{ a.crv }}')).toEqual(['include-unresolved'])
  })
})

describe('inline elements', () => {
  check([
    ['C2-H-072: the inline nodes map to their elements', '/a/ *b* {_c_} {~d~} {=e=} {^f^} {,g,} {+h+} {-i-} [j]{.k} $`l` $$`m` x {# n #}', '<p><em>a</em> <strong>b</strong> <u>c</u> <s>d</s> <mark>e</mark> <sup>f</sup> <sub>g</sub> <ins>h</ins> <del>i</del> <span class="k">j</span> <span class="math inline" role="math">\\(l\\)</span> <span class="math display" role="math">\\[m\\]</span> x <span class="critic-comment"> n </span></p>'],
    ['C2-H-073: a replacement is del directly followed by ins', '{-old-}{+new+}', '<p><del>old</del><ins>new</ins></p>'],
    ['C2-H-074: emphasis and strong nest in the tree order', '*/a/* /*b*/', '<p><strong><em>a</em></strong> <em><strong>b</strong></em></p>'],
    ['C2-H-075: a span with the key abbr, time or kbd is that element; several nest, and an authored title wins', '[a]{kbd .c} [b]{abbr="B" title="T"} [c]{kbd time="1" abbr="C" #i}', '<p><kbd class="c">a</kbd> <abbr title="T">b</abbr> <kbd id="i"><time datetime="1"><abbr title="C">c</abbr></time></kbd></p>'],
    ['C2-H-076: the other semantic names are plain keys, and an inline extension with no renderer is a span', '[x]{samp} :note[y]{.c}', '<p><span samp="">x</span> <span class="ext-note c">y</span></p>'],
    ['C2-H-078: a smart-punctuation node is its glyph', '"a" -- b...', '<p>“a” – b…</p>'],
    ['C2-H-078, C2-H-127: with smartTypography off it is its source', '"a" -- b...', '<p>"a" -- b...</p>', { smartTypography: false }],
  ])

  it('C2-H-142: small_caps, ruby and section reach the renderer in a supplied tree', () => {
    const ruby: AstNode = { type: 'ruby', pairs: [{ type: 'rubyPair', base: [text('漢')], annotation: [text('kan')] }] }
    const section: AstNode = { type: 'section', children: [paragraph({ type: 'small_caps', children: [text('a')] }, ruby)] }
    expect(render(documentOf(section))).toBe(
      '<section>\n  <p><span class="smallcaps">a</span><ruby>漢<rp>(</rp><rt>kan</rt><rp>)</rp></ruby></p>\n</section>',
    )
  })

  it('C2-A-119: with no extension for citations a citation group writes its bracket text and a citation definition writes nothing', () => {
    const citation: AstNode = { type: 'citation', key: 'a', namespace: 'citation', suppressAuthor: false }
    const group: AstNode = { type: 'citation_group', raw: '[@a, p. 3 & 4]', children: [citation] }
    const definition: AstNode = { type: 'citation_definition', key: 'a', namespace: 'citation', children: [text('A book')] }
    expect(render(documentOf(paragraph('see ', group), definition))).toBe('<p>see [@a, p. 3 &amp; 4]</p>')
  })

  it('C2-A-123: an inline extension with a qualified name is a registered extension and renders through its fallback', () => {
    const extension: AstNode = { type: 'inline_extension', name: 'org.example.badge', children: [], fallback: [text('new')] }
    expect(render(documentOf(paragraph(extension)))).toBe('<p>new</p>')
    expect(lossCodes(documentOf(paragraph(extension)))).toEqual(['extension-fallback-rendered'])
  })

  it('C2-H-076, C2-A-127: an unknown optional extension renders through its fallback and is reported', () => {
    const extension: AstNode = { type: 'block_extension', name: 'org.example.d', children: [], fallback: [paragraph('f')] }
    expect(render(documentOf(extension))).toBe('<p>f</p>')
    expect(lossCodes(documentOf(extension))).toEqual(['extension-fallback-rendered'])
  })
})

describe('links, images and references', () => {
  check([
    ['C2-H-079: a link is a with its destination and its title; an email autolink leads to mailto', '[a](/u "T") <https://x.y/z> <a@b.cd>', '<p><a href="/u" title="T">a</a> <a href="https://x.y/z">https://x.y/z</a> <a href="mailto:a@b.cd">a@b.cd</a></p>'],
    ['C2-H-080: an image always writes alt, also when it is empty', '![](x) ![a "b"](y "T")', '<p><img src="x" alt=""> <img src="y" alt="a &quot;b&quot;" title="T"></p>'],
    ['C2-H-081: a link or an autolink inside link text is unwrapped', '[a [b](/in) <https://c.d> ![i](j)](/out)', '<p><a href="/out">a b https://c.d <img src="j" alt="i"></a></p>'],
    ['C2-H-082: a destination the policy denies is the empty string, and the element stays', '[a](javascript:alert(1)) ![b](DATA:x) <vbscript:y>', '<p><a href="">a</a> <img src="" alt="b"> <a href="">vbscript:y</a></p>'],
    ['C2-H-083: a reference a heading resolves leads to the id of the first matching heading', '# T\n\n# T\n\n[T][] [x][T]', '<h1 id="T">T</h1>\n<h1 id="T-2">T</h1>\n<p><a href="#T">T</a> <a href="#T">x</a></p>', { sections: false }],
    ['C2-H-084: an image reference never resolves against the headings', '# T\n\nx ![i][T]', '<h1 id="T">T</h1>\n<p>x ![i][T]</p>', { sections: false }],
    ['C2-H-085: an unresolved reference renders its brackets and its label as text and its children as HTML', '[*a* & `b`][no  pe] [/c/][] x ![i <j>][k]', '<p>[<strong>a</strong> &amp; <code>b</code>][no pe] [<em>c</em>][] x ![i &lt;j&gt;][k]</p>'],
    ['C2-H-086: an unresolved footnote reference and cross-reference are text; a footnote inside an unresolved reference is an ordinary one', '[^zz] </#no> [a^[n]][nope]', '<p>[^zz] &lt;/#no&gt; [a<a id="fnref1" href="#fn1" role="doc-noteref"><sup>1</sup></a>][nope]</p>\n<section role="doc-endnotes" aria-label="Footnotes">\n  <hr>\n  <ol>\n    <li id="fn1">\n      <p>n<a href="#fnref1" role="doc-backlink" aria-label="Back to reference">↩</a></p>\n    </li>\n  </ol>\n</section>'],
    ['C2-H-139: the attribute block of an unresolved reference is text, as one block in the fixed order', '[a][nope]{k="v w" .c :en #i bare}', '<p>[a][nope]{#i .c :en k="v w" bare}</p>'],
    ['C2-H-141: the attributes of a link definition merge into a reference; the classes of the definition come first and the reference wins', '[a][r]{.own #mine k=2} ![i][r]\n\n{.def #theirs k=1 m=3}\n[r]: /u "T"', '<p><a href="/u" title="T" id="mine" class="def own" m="3" k="2">a</a> <img src="/u" alt="i" title="T" id="theirs" class="def" k="1" m="3"></p>'],
    ['C2-H-140: under roundtrip a collapsed reference carries data-carve-ref-collapsed beside data-carve-ref', '[r][] [x][r] ![r][]\n\n[r]: /u', '<p><a href="/u" data-carve-ref="r" data-carve-ref-collapsed>r</a> <a href="/u" data-carve-ref="r">x</a> <img src="/u" alt="r" data-carve-ref="r" data-carve-ref-collapsed></p>', { roundtrip: true }],
  ])

  it('C2-H-080: a supplied image with no src and no alt writes both as empty', () => {
    expect(render(documentOf(paragraph({ type: 'image' }, 'x')))).toBe('<p><img src="" alt="">x</p>')
  })

  it('C2-H-082, C2-H-132: the denial is reported with the severity error', () => {
    expect(renderWithDiagnostics('[a](javascript:x)').diagnostics).toEqual([
      { code: 'destination-denied', severity: 'error', channel: 'render-loss', message: 'the destination javascript:x is denied by the URL policy' },
    ])
  })
})

describe('footnotes', () => {
  const section = (items: string): string => `<section role="doc-endnotes" aria-label="Footnotes">\n  <hr>\n  <ol>\n${items}\n  </ol>\n</section>`
  const back = (id: string): string => `<a href="#${id}" role="doc-backlink" aria-label="Back to reference">↩</a>`
  const ref = (n: number, id = `fnref${n}`): string => `<a id="${id}" href="#fn${n}" role="doc-noteref"><sup>${n}</sup></a>`
  check([
    ['C2-H-087: footnotes are numbered in the order of their first reference, labeled and inline in one sequence', 'a[^b] ^[i] [^a] [^b]\n\n[^a]: A\n[^b]: B', `<p>a${ref(1)} ${ref(2)} ${ref(3)} ${ref(1, 'fnref1-2')}</p>\n${section(`    <li id="fn1">\n      <p>B<a href="#fnref1" role="doc-backlink" aria-label="Back to reference 1">↩<sup>1</sup></a> <a href="#fnref1-2" role="doc-backlink" aria-label="Back to reference 2">↩<sup>2</sup></a></p>\n    </li>\n    <li id="fn2">\n      <p>i${back('fnref2')}</p>\n    </li>\n    <li id="fn3">\n      <p>A${back('fnref3')}</p>\n    </li>`)}`],
    ['C2-H-088: an id the author wrote on the reference replaces the generated one, and the backlink points to it', 'a[^n]{#mine}\n\n[^n]: N', `<p>a<a id="mine" href="#fn1" role="doc-noteref"><sup>1</sup></a></p>\n${section(`    <li id="fn1">\n      <p>N${back('mine')}</p>\n    </li>`)}`],
    ['C2-H-089, C2-H-125: the label of the section and of a backlink come from labels and are escaped', 'a[^n]\n\n[^n]: N', '<p>a<a id="fnref1" href="#fn1" role="doc-noteref"><sup>1</sup></a></p>\n<section role="doc-endnotes" aria-label="Notes &amp; &quot;more&quot;">\n  <hr>\n  <ol>\n    <li id="fn1">\n      <p>N<a href="#fnref1" role="doc-backlink" aria-label="Zurück">↩</a></p>\n    </li>\n  </ol>\n</section>', { labels: { endnotes: 'Notes & "more"', footnoteBacklink: 'Zurück' } }],
    ['C2-H-090, C2-H-091: every paragraph of a note gets p, and the backlink stands in a paragraph of its own when the note does not end with one', 'a[^n]\n\n[^n]: N\n\n    - l', `<p>a${ref(1)}</p>\n${section(`    <li id="fn1">\n      <p>N</p>\n      <ul>\n        <li>l</li>\n      </ul>\n      <p>${back('fnref1')}</p>\n    </li>`)}`],
    ['C2-H-092, C2-H-094: a definition that no reference uses is not written, and with no numbered footnote there is no section', 'a\n\n[^n]: N', '<p>a</p>'],
    ['C2-H-093: a top-level footnotes directive moves the section to its place; inside a container it places nothing', '> ::: footnotes\n> :::\n\na[^n]\n\n::: footnotes\n:::\n\nb\n\n[^n]: N', `<blockquote>\n  <div class="footnotes">\n\n  </div>\n</blockquote>\n<p>a${ref(1)}</p>\n${section(`    <li id="fn1">\n      <p>N${back('fnref1')}</p>\n    </li>`)}\n<p>b</p>`],
  ])
})

describe('cross-references and abbreviations', () => {
  check([
    ['C2-H-095, C2-H-096: a resolved cross-reference is a link around the plain text of the heading or the label and number of the caption', '# The *big* one\n\n{#t}\n| a |\n^ Table #: x\n\n</#The-big-one> </#t> </#the-big-one>', '<h1 id="The-big-one">The <strong>big</strong> one</h1>\n<table id="t">\n  <caption>Table 1: x</caption>\n  <tbody>\n    <tr><td>a</td></tr>\n  </tbody>\n</table>\n<p><a href="#The-big-one">The big one</a> <a href="#t">Table 1</a> &lt;/#the-big-one&gt;</p>', { sections: false }],
    ['C2-H-097: the generated text is plain text, with no abbreviation in it', '*[HTML]: x\n\n# HTML & co\n\n</#HTML-co>', '<h1 id="HTML-co"><abbr title="x">HTML</abbr> &amp; co</h1>\n<p><a href="#HTML-co">HTML &amp; co</a></p>', { sections: false }],
    ['C2-H-098, C2-H-099: an abbreviation node is abbr with its expansion, and inside a span with the abbr key only its text', '*[HTML]: Hyper "Text"\n\nHTML [HTML]{abbr="other"}', '<p><abbr title="Hyper &quot;Text&quot;">HTML</abbr> <abbr title="other">HTML</abbr></p>'],
    ['C2-H-104: a reference and a cross-reference resolve against a block further down', '[T][] </#T> </#f>\n\n# T\n\n{#f}\n![a](b)\n^ Figure #', '<p><a href="#T">T</a> <a href="#T">T</a> <a href="#f">Figure 1</a></p>\n<h1 id="T">T</h1>\n<figure id="f">\n  <img src="b" alt="a">\n  <figcaption>Figure 1</figcaption>\n</figure>', { sections: false }],
  ])
})

describe('mentions, tags and symbols', () => {
  check([
    ['C2-H-100: a mention and a tag are inert spans without social', '@ann #t', '<p><span class="mention"><strong>@ann</strong></span> <span class="tag"><strong>#t</strong></span></p>'],
    ['C2-H-100, C2-H-126: with social the outer element is a link to the URL of the template', '@a.b #t', '<p><a class="mention" href="/u/a.b">@a.b</a> <a class="tag" href="/t?q=t">#t</a></p>'.replaceAll('">@a.b', '"><strong>@a.b</strong>').replaceAll('">#t', '"><strong>#t</strong>'), { social: { mentionUrl: '/u/{name}', tagUrl: '/t?q={name}' } }],
    ['C2-H-101, C2-H-124: a symbol in the symbols table is its value verbatim, any other its source; one with attributes is wrapped in a span', ':ok: :no: :ok:{.c}', '<p><b>✓</b> :no: <span class="c"><b>✓</b></span></p>', { symbols: { ok: '<b>✓</b>' } }],
  ])

  it('C2-H-126: a resolver gives the URL of a mention, and a denied one leaves the element inert of a destination', () => {
    const social = { resolveMention: (name: string) => (name === 'ann' ? 'https://x.y/ann' : null), resolveTag: () => 'javascript:x' }
    expect(render('@ann @bob #t', { social })).toBe(
      '<p><a class="mention" href="https://x.y/ann"><strong>@ann</strong></a> <span class="mention"><strong>@bob</strong></span> <a class="tag" href=""><strong>#t</strong></a></p>',
    )
  })
})

describe('state beyond the current block', () => {
  check([
    ['C2-H-102: a definition stands anywhere at the top level, also after its uses', 'HTML [a][r] b[^n]\n\n[r]: /u\n[^n]: N\n*[HTML]: x', '<p><abbr title="x">HTML</abbr> <a href="/u">a</a> b<a id="fnref1" href="#fn1" role="doc-noteref"><sup>1</sup></a></p>\n<section role="doc-endnotes" aria-label="Footnotes">\n  <hr>\n  <ol>\n    <li id="fn1">\n      <p>N<a href="#fnref1" role="doc-backlink" aria-label="Back to reference">↩</a></p>\n    </li>\n  </ol>\n</section>'],
    ['C2-H-103: an authored id further down is reserved before the first generated id is final', '# T\n\n{#T}\nx', '<h1 id="T-2">T</h1>\n<p id="T">x</p>', { sections: false }],
    ['C2-H-105: a footnotes directive above the last reference still holds every note', '::: footnotes\n:::\n\na[^n]\n\n[^n]: N', '<section role="doc-endnotes" aria-label="Footnotes">\n  <hr>\n  <ol>\n    <li id="fn1">\n      <p>N<a href="#fnref1" role="doc-backlink" aria-label="Back to reference">↩</a></p>\n    </li>\n  </ol>\n</section>\n<p>a<a id="fnref1" href="#fn1" role="doc-noteref"><sup>1</sup></a></p>'],
    ['C2-H-106: a blank line before the last item makes the first item loose', '- a\n- b\n\n- c', '<ul>\n  <li><p>a</p></li>\n  <li><p>b</p></li>\n  <li><p>c</p></li>\n</ul>'],
    ['C2-H-107: a caption line below decides whether a figure wraps the block', '```\nx\n```\n^ c', '<figure>\n  <pre><code>x\n</code></pre>\n  <figcaption>c</figcaption>\n</figure>'],
    ['C2-H-108: a section closes at the next heading of the same or a lower level number, or at the end', '## A\n\n# B', '<section id="A">\n  <h2>A</h2>\n</section>\n<section id="B">\n  <h1>B</h1>\n</section>'],
    ['C2-H-109: whether the first paragraph of a description is bare is known when the description closes', ':: t\n: a\n\n  b', '<dl>\n  <dt>t</dt>\n  <dd>\n    <p>a</p>\n    <p>b</p>\n  </dd>\n</dl>'],
    ['C2-H-110: the task-list class is known when the list closes', '- [ ] a\n- [x] b', '<ul class="task-list">\n  <li><input type="checkbox" disabled aria-label="a"> a</li>\n  <li data-task-state="x"><input type="checkbox" checked disabled aria-label="b"> b</li>\n</ul>'],
  ])

  it('C2-H-111: the tree of a source, also after a JSON round trip, renders as the source does', () => {
    const src = '# T\n\n[T][] a[^n] </#T>\n\n- [x] b\n\n| a |\n^ Table #\n\n[^n]: x'
    expect(render(parse(src))).toBe(render(src))
    expect(render(decodeTree(encodeTree(parse(src))))).toBe(render(src))
  })
})

describe('roundtrip carriers', () => {
  check([
    ['C2-H-112: the option adds the carriers and changes nothing else; it is off by default', '[x][r]\n\n[r]: /u', '<p><a href="/u">x</a></p>'],
    ['C2-H-113, C2-H-119: a spelling the sidecar holds has no carrier', '::: >\nq\n:::\n\n. a\n\n***', '<blockquote><p>q</p></blockquote>\n<ol data-carve-tight>\n  <li>a</li>\n</ol>\n<hr>', { roundtrip: true }],
    ['C2-H-114: the carriers of a raw span, of a code fence label, of a line block and of a div with no other attribute', 'a `<b>`{=html}\n\n```js [L]\n```\n\n::: |\nx\n:::\n\n:::\n:::\n\n{.c}\n:::\n:::', '<p>a <span data-carve-raw="html">&lt;b&gt;</span></p>\n<pre data-carve-label="L"><code class="language-js"></code></pre>\n<div data-carve-line-block class="line-block">\n  <p>x</p>\n</div>\n<div data-carve-div>\n\n</div>\n<div class="c">\n\n</div>', { roundtrip: true }],
    ['C2-H-115, C2-H-116, C2-H-120: with roundtrip on an authored attribute with a reserved name is dropped; another data-carve- name is ordinary', '[t]{data-carve-ref=x data-carve-other=y data-marker=z}', '<p><span data-carve-other="y">t</span></p>', { roundtrip: true }],
    ['C2-H-116: with roundtrip off the attribute passes through', '[t]{data-carve-ref=x}', '<p><span data-carve-ref="x">t</span></p>'],
    ['C2-H-117: a presence carrier is the bare attribute name', '<https://x.y>', '<p><a href="https://x.y" data-carve-autolink>https://x.y</a></p>', { roundtrip: true }],
    ['C2-H-118: data-task-state, data-delim and task-list are written on every render', '1) a\n\n- [x] b', '<ol data-delim=")">\n  <li>a</li>\n</ol>\n<ul class="task-list">\n  <li data-task-state="x"><input type="checkbox" checked disabled aria-label="b"> b</li>\n</ul>'],
  ])

  it('C2-H-116: the dropped attribute is reported as a render loss', () => {
    expect(lossCodes('[t]{data-carve-ref=x}', { roundtrip: true })).toEqual(['carrier-attribute-dropped'])
  })
})

describe('options', () => {
  it('C2-H-121, C2-H-137: an unknown option, and an option of another stage, is refused', () => {
    expect(() => render('a', { color: true } as RenderOptions)).toThrow(CarveOptionError)
    expect(() => render('a', { alignTables: true } as RenderOptions)).toThrow('option alignTables: not an option of render')
    expect(() => render('a', { sections: 'yes' } as unknown as RenderOptions)).toThrow('option sections: not a boolean')
  })

  it('C2-H-122: an unknown value of mode is refused, and the static mode is not offered yet', () => {
    expect(() => render('a', { mode: 'print' } as unknown as RenderOptions)).toThrow('option mode: unknown value "print"')
    expect(() => render('a', { mode: 'static' })).toThrow(CarveOptionError)
    expect(render('a', { mode: 'interactive' })).toBe('<p>a</p>')
  })

  it('C2-H-123, C2-H-137: renderers, extensions and includes are refused while the engine offers none', () => {
    expect(() => render('a', { renderers: { x: 1 } })).toThrow('option renderers: not offered by this engine')
    expect(() => render('a', { extensions: [{}] })).toThrow(CarveOptionError)
    expect(render('a', { renderers: {}, extensions: [] })).toBe('<p>a</p>')
  })

  it('C2-H-128: urlPolicy is a deny list or an allow list; the filter also blanks a denied scheme in an attribute value', () => {
    expect(render('[a](ftp://x) [b](https://y) [c](/rel)', { urlPolicy: { deny: ['ftp'] } })).toBe('<p><a href="">a</a> <a href="https://y">b</a> <a href="/rel">c</a></p>')
    expect(render('[a](ftp://x) [b](https://y) [c](/rel)', { urlPolicy: { allow: ['HTTPS'] } })).toBe('<p><a href="">a</a> <a href="https://y">b</a> <a href="/rel">c</a></p>')
    expect(render('[a](java\tscript:x) [b]( JavaScript:y)')).toBe('<p>[a](java\tscript:x) [b]( JavaScript:y)</p>')
    expect(render(documentOf(paragraph({ type: 'link', href: ' Java\tScript:x', children: [text('a')] })))).toBe('<p><a href="">a</a></p>')
  })

  it('C2-H-129: the restricted profiles are not offered yet and are refused', () => {
    expect(() => render('a', { profile: 'comment' })).toThrow('option profile: only full is offered by this engine')
    expect(render('a', { profile: 'full' })).toBe('<p>a</p>')
  })

  it('C2-H-130, C2-A-174: strictLosses turns a render loss into an error, and the render returns no output', () => {
    expect(() => render('{{ a.crv }}', { strictLosses: true })).toThrow(CarveRenderError)
    expect(renderWithDiagnostics('{{ a.crv }}', { strictLosses: true }).html).toBe('')
    expect(render('a', { strictLosses: true })).toBe('<p>a</p>')
  })

  it('C2-H-132: the loss codes that apply to HTML', () => {
    const src = '`x`{=tex} [a](data:x) [t]{data-carve-xref}'
    expect(lossCodes(src, { roundtrip: true })).toEqual(['raw-format-dropped', 'destination-denied', 'carrier-attribute-dropped'])
  })
})
