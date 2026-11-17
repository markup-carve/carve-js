// The clauses that the specification commits "decide the cases the three engine lanes logged" and
// "fix what the review of today's clauses found" added or changed, one test per clause id.
import { describe, expect, it } from 'vitest'
import {
  type Block, type DocumentNode, format, type ListItemNode, type ListNode, parse, parseWithLayout, render, type RenderOptions,
  treesEqual, write, writeWithDiagnostics,
} from '../src/index.ts'
import { childrenOf, ofType } from './support/nodes.ts'
import { documentOf, paragraph, text } from './support/tree.ts'
import { unaskedEscape } from './support/writer-checks.ts'

const FENCE = '```'

/** [clause id and subject, source, expected HTML, options]. */
type Case = readonly [string, string, string, RenderOptions?]

function check(cases: readonly Case[]): void {
  for (const [name, src, html, options] of cases) {
    it(name, () => {
      expect(render(src, options)).toBe(html)
    })
  }
}

describe('the URL policy', () => {
  check([
    ['C2-H-159: the scheme test removes the bidirectional embeddings and overrides', '[x](java‮script:alert(1))', '<p><a href="">x</a></p>'],
    ['C2-H-159: the scheme test removes the bidirectional isolates', '[x](java⁦script:alert(1))', '<p><a href="">x</a></p>'],
    ['C2-H-161: an authored value is tested with the bidirectional controls removed', '[t]{title="java‮script:x"}', '<p><span title="">t</span></p>'],
    ['C2-H-167: an autolink is allowed under comment and takes the rel of the profile', '<https://a.b>',
      '<p><a href="https://a.b" rel="nofollow ugc">https://a.b</a></p>', { profile: 'comment' }],
  ])
})

describe('the rel of a link', () => {
  check([
    ['C2-H-167: an authored rel that C2-H-161 empties gives no word, and the profile words stay', '[x](/u){rel="javascript:foo"}',
      '<p><a href="/u" rel="nofollow ugc">x</a></p>', { profile: 'comment' }],
    ['C2-H-167: with no word from the author or the profile there is no rel', '[x](/u){rel="javascript:foo"}', '<p><a href="/u">x</a></p>'],
    ['C2-H-167: an empty authored rel gives no attribute', '[x](/u){rel=""}', '<p><a href="/u">x</a></p>'],
    ['C2-H-167: rel stands behind href and before the id and the classes', '[x](/u){#i .c rel=me}', '<p><a href="/u" rel="me" id="i" class="c">x</a></p>'],
    ['C2-H-167: the authored words come first, then the profile words not among them', '[x](/u){rel="ugc me"}',
      '<p><a href="/u" rel="ugc me nofollow">x</a></p>', { profile: 'comment' }],
  ])
})

describe('the byte-order mark', () => {
  it('C2-B-165: the first character behind the mark has column 1, and offsets count the three bytes of the mark', () => {
    const paragraph = ofType(parse('\uFEFFab *c*').children[0], 'paragraph')
    expect(paragraph.pos).toEqual({ startLine: 1, startColumn: 1, startOffset: 3, endLine: 1, endColumn: 7, endOffset: 9 })
    expect(paragraph.children[1]?.pos).toMatchObject({ startColumn: 4, startOffset: 6 })
  })

  it('C2-B-165: the columns of the layout record do not count the mark', () => {
    const { layout } = parseWithLayout('\uFEFF- a\n- b')
    const first = layout.nodes.find((entry) => entry.path === '/children/0/children/0')!
    expect(first).toMatchObject({ startByte: 3, markerColumn: 0, contentColumn: 2 })
  })
})

describe('U+0000 in the source', () => {
  it('C2-B-218: U+0000 is read as U+FFFD in text, code, a code block, an attribute value and a destination', () => {
    const src = 'a\0b `c\0` [t]{k="v\0"} [x](/u\0)\n\n```\nd\0\n```'
    expect(JSON.stringify(parse(src))).not.toContain('\\u0000')
    expect(render(src)).toBe('<p>a�b <code>c�</code> <span k="v�">t</span> <a href="/u�">x</a></p>\n<pre><code>d�\n</code></pre>')
  })

  it('C2-B-218: offsets count the source as it stands, one byte for U+0000', () => {
    const document = parse('a\0b')
    expect(document.srcByteLength).toBe(3)
    expect(document.children![0]!.pos).toMatchObject({ startOffset: 0, endOffset: 3, endColumn: 4 })
  })
})

describe('the bidirectional controls', () => {
  const controls = '‪‫‬‭‮⁦⁧⁨⁩'

  it('C2-H-172: they are not written in a text node, a code span, a code block or an escaped raw block', () => {
    const src = `a${controls}b \`c${controls}d\`\n\n${FENCE}\ne${controls}\n${FENCE}\n\n${FENCE}=html\n<b>${controls}</b>\n${FENCE}`
    expect(render(src)).toBe('<p>ab <code>cd</code></p>\n<pre><code>e\n</code></pre>\n<pre><code class="language-html">&lt;b&gt;&lt;/b&gt;\n</code></pre>')
  })

  it('C2-H-172: they stay in the tree, in the canonical form and in attribute values', () => {
    const src = `[t${controls}]{k="v${controls}"}`
    expect(render(src)).toBe(`<p><span k="v${controls}">t</span></p>`)
    expect(JSON.stringify(parse(src))).toContain(`t${controls}`)
    expect(format(src)).toBe(`[t${controls}]{k=v${controls}}\n`)
  })

  it('C2-H-172: a supplied tree is written without them too', () => {
    expect(render(documentOf(paragraph(text(`x${controls}y`))))).toBe('<p>xy</p>')
  })

  it('C2-H-172: they are not written where a scanner stepped over them or in the cells of a delimited table', () => {
    expect(render(`a\n{footer-rows=1${controls}}`)).toBe('<p>a\n{footer-rows=1}</p>')
    expect(render(`a {_k=v${controls}_} b`)).toBe('<p>a {_k=v_} b</p>')
    expect(render(`{table}\n${FENCE}csv\na${controls},b\n${FENCE}`)).toContain('<th scope="col">a</th>')
  })

  it('C2-H-172: raw HTML that is written as markup keeps them', () => {
    expect(render(`${FENCE}=html\n<b>${controls}</b>\n${FENCE}`, { rawHtml: true })).toBe(`<b>${controls}</b>`)
  })
})

describe('the writer', () => {
  it('C2-W-059: an empty braced comment is written {%%}', () => {
    expect(format('a {%  %} b')).toBe('a {%%} b\n')
    expect(format('{% %}')).toBe('{%%}\n')
    expect(format('a {% x %} b')).toBe('a {% x %} b\n')
  })
})

describe('the tree', () => {
  it('C2-A-181: {{ a.crv @code }} gives the options [["code", ""]]', () => {
    expect(parse('{{ a.crv @code }}', { positions: false }).children).toEqual([{ type: 'include', path: 'a.crv', options: { code: true } }])
  })
})

describe('a start value of more than nine digits', () => {
  const list = (delimiter: string): DocumentNode => ({
    type: 'document', astVersion: '2.0', children: [{
      type: 'list', marker: { kind: 'ordered', style: '1', delimiter, start: 1234567890 }, spacing: 'tight',
      children: [{ type: 'list_item', children: [paragraph(text('a'))] }, { type: 'list_item', children: [paragraph(text('b'))] }],
    }],
  })

  // The schema bounds `marker.start` to nine digits, so the reader refuses the tree that C2-W-044 would write
  // from 1 (_SPEC_GAPS.md G-E3).
  it('C2-W-044, C2-A-056: a supplied start of more than nine digits is refused by the reader', () => {
    for (const delimiter of ['.', ')']) expect(() => writeWithDiagnostics(list(delimiter))).toThrow('a start outside 0 to 999999999')
  })

  it('C2-B-219: a start attribute of more than nine digits stays a key', () => {
    const list = ofType(parse('{start=1234567890}\n. a', { positions: false }).children[0], 'list')
    expect(list.marker).toEqual({ kind: 'ordered', style: '1', delimiter: '.' })
    expect(list.attrs).toEqual({ keyValues: [['start', '1234567890']] })
  })
})

describe('tables', () => {
  it('C2-B-184: Example 249, a backtick run whose closer is in the next fragment is text', () => {
    const table = parse('| `a | x |\n+ b` | y |', { positions: false }).children[0]
    const cell = ofType(childrenOf(childrenOf(childrenOf(table)[0])[0])[0], 'table_cell')
    expect(cell.children).toEqual([{ type: 'cell_paragraph', children: [{ type: 'text', value: '`a b`' }] }])
    expect(render('| `a | x |\n+ b` | y |')).toBe('<table>\n  <tbody>\n    <tr><td>`a b`</td><td>x y</td></tr>\n  </tbody>\n</table>')
  })

  it('C2-B-209, C2-B-221: a count past the last row is clamped, so every row stands in the head and there is no body', () => {
    const src = `{table header-rows=5}\n${FENCE}csv\na,b\nc,d\n${FENCE}`
    const table = ofType(parse(src, { positions: false }).children[0], 'table')
    expect(table.children.map((group) => group.type)).toEqual(['table_head'])
    expect(ofType(table.children[0], 'table_head').children).toHaveLength(2)
    expect(table).not.toHaveProperty('attrs')
  })

  it('C2-W-066: a delimited table whose rows all stand in its head is written with the count of its head rows', () => {
    const src = `{table header-rows=5}\n${FENCE}csv\na,b\nc,d\n${FENCE}`
    expect(format(src)).toBe(`{table header-rows=2}\n${FENCE}csv\na,b\nc,d\n${FENCE}\n`)
    // With no record it is a pipe table, whose rows of header cells form the same head (C2-L-036, C2-B-178).
    expect(write(parse(src, { positions: false }))).toBe('|= a |= b |\n|= c |= d |\n')
  })
})

describe('escapes, from left to right', () => {
  const written = (value: string): string => write(documentOf(paragraph(text(value))))

  it('C2-W-091: x<a:b>=} as text is written x\<a:b\>=}, and the escape a later one makes needless stays', () => {
    expect(written('x<a:b>=}')).toBe('x\\<a:b\\>=}\n')
  })

  it('C2-W-091: an escape that a node which did not form asked for is placed only where the test asks for it', () => {
    expect(format('x{.c}/}\\{/')).toBe('x{.c}/}\\{/\n')
  })

  it('C2-W-091: where a node takes its other form, no escape of its first spelling stays', () => {
    expect(format('x(/u){/ /}')).toBe('x(/u){/ /}\n')
  })

  it('C2-W-091: a round places the first escape only, so one behind it that it makes needless is not placed', () => {
    expect(format('x(/u)\\/}/}')).toBe('x({/u)\\/}/}}\n')
  })

  it('C2-W-088: the gate finds an escape the test does not ask for, also before one it asks for', () => {
    expect(unaskedEscape('\\.x\n', parse('.x'))).toBe(0)
    expect(unaskedEscape('\\.x\\<a:b\\>=}\n', parse('.x\\<a:b\\>=}'))).toBe(0)
    expect(unaskedEscape('x\\<a:b\\>=}\n', parse('x\\<a:b\\>=}'))).toBe(-1)
  })
})

describe('the other clauses of the two commits', () => {
  const layoutOf = (src: string): readonly object[] => parseWithLayout(src).layout.nodes
  const entry = (src: string, path: string): Record<string, unknown> | undefined =>
    parseWithLayout(src).layout.nodes.find((node) => node.path === path) as Record<string, unknown> | undefined

  it('C2-B-220: a widths entry is digits with an optional dot and digits; .5, 5., 1e1 and +5 set no width', () => {
    const widths = (value: string): (number | undefined)[] => ofType(parse(`{table widths="${value}"}\n${FENCE}csv\na,b\n${FENCE}`,
      { positions: false }).children[0], 'table').columns.map((column) => column.width)
    expect(widths('30.5,5')).toEqual([0.305, 0.05])
    for (const entry of ['.5', '5.', '1e1', '+5']) expect(widths(`30.5,${entry}`), entry).toEqual([undefined, undefined])
  })

  it('C2-A-089: resolvedAlign is the mark of the last head cell before the aligns entry', () => {
    const table = ofType(parse('{aligns="right"}\n|={<} a |\n| b |', { positions: false }).children[0], 'table')
    expect(table.columns).toEqual([{ type: 'table_column', align: 'right', resolvedAlign: 'left' }])
  })

  it('C2-A-187: the bracket label of a div is the string groupLabel, not parsed', () => {
    expect(parse('::: tip [Tab *x*]\nbody\n:::', { positions: false }).children![0]).toMatchObject({ type: 'admonition', groupLabel: 'Tab *x*' })
  })

  it('C2-H-147: with ascii the result is lowered as with lower', () => {
    expect(render('# AB', { headingIds: 'ascii' })).toBe('<section id="ab">\n  <h1>AB</h1>\n</section>')
  })

  it('C2-H-165: a degraded block is one paragraph of its plain text behind the mark of its kind', () => {
    expect(render(`# h *x*\n\n> q\n\n***\n\n| a | b |\n| c | d |\n\n${FENCE}\ncode\n${FENCE}\n\n::: d "T"\nx\n:::`, { profile: 'minimal' }))
      .toBe('<p># h x</p>\n<p>&gt; q</p>\n<p>---</p>\n<p>a | b<br>\nc | d</p>\n<p>code</p>\n<p>T x</p>')
  })

  it('C2-H-165: a degraded block image is the text [img: ALT] in its paragraph', () => {
    expect(render('![alt](i.png)', { profile: 'minimal' })).toBe('<p>[img: alt]</p>')
  })

  it('C2-H-166: a node at the bound of max_nesting stays and its children are degraded', () => {
    expect(render('- a\n  - b\n    - c\n      - d\n        - e', { profile: 'comment' }))
      .toBe('<ul>\n  <li>a\n    <ul>\n      <li>b\n        <ul>\n          <li>c\n            <p>- d - e</p>\n          </li>\n        </ul>\n      </li>\n    </ul>\n  </li>\n</ul>')
  })

  it('C2-H-168: static mode writes core math as interactive mode does', () => {
    expect(render('$`x`\n\n$$`y`', { mode: 'static' })).toBe(
      '<p><span class="math inline" role="math">\\(x\\)</span></p>\n<p><span class="math display" role="math">\\[y\\]</span></p>',
    )
  })

  it('C2-H-169: the blocks of the footnotes directive come before the section, its attributes are not written, and a title names it', () => {
    expect(render('a[^n]\n\n[^n]: note\n\n{aria-label="L" .c}\n::: footnotes "Notes"\nbefore\n:::')).toBe(
      '<p>a<a id="fnref1" href="#fn1" role="doc-noteref"><sup>1</sup></a></p>\n<p>before</p>\n'
      + '<section role="doc-endnotes" aria-labelledby="adm-1">\n  <p class="admonition-title" id="adm-1">Notes</p>\n  <hr>\n  <ol>\n'
      + '    <li id="fn1">\n      <p>note<a href="#fnref1" role="doc-backlink" aria-label="Back to reference">↩</a></p>\n    </li>\n  </ol>\n</section>',
    )
  })

  it('C2-H-170: the caption of a table takes its number before an equation in a cell of that table', () => {
    const document = parse('| a | x |\n^ Table # cap', { positions: false })
    const cell = childrenOf(childrenOf(childrenOf(document.children[0])[0])[0])[1]
    ofType(childrenOf(cell)[0], 'cell_paragraph').children = [{ type: 'math', display: true, value: 'e', numberPrefix: 'Table', number: 0 }]
    const html = render(document)
    expect(html).toContain('<caption>Table 1 cap</caption>')
    expect(html).toContain('<span class="equation-number">Table 2</span>')
  })

  it('C2-H-171: an option value with a space, a tab, @ or } stands in quotes, and the options stand in the order of C2-W-058', () => {
    // C2-B-206: `"a,,b"` is no list of names, so the option is invalid and stands as the source spelled it.
    expect(render('{{ a.crv @cols:"a,,b" }}')).toBe('<p>{{ a.crv @cols:"a,,b" }}</p>')
    const document: DocumentNode = {
      type: 'document', astVersion: '2.0',
      // C2-A-181: a reader refuses a range, a region or a syntax outside its shape, so the space and the brace stand in a name.
      children: [{ type: 'include', path: 'a.crv', options: { region: 'r', shift: 1, cols: ['x }y'], code: 'js', lines: '1-2' } }],
    }
    expect(render(document)).toBe('<p>{{ a.crv @lines:1-2 @region:r @cols:"x }y" @shift:1 @code:js }}</p>')
  })

  it('C2-W-002: the gate holds for a document the writer does not refuse', () => {
    const src = 'a *b* `c`\n\n- d'
    expect(treesEqual(parse(format(src)), parse(src))).toBe(true)
  })

  it('C2-W-099: a first block that reads as another tree on line 1 is written below one blank line', () => {
    const document = documentOf(paragraph({ type: 'smart_punctuation', kind: 'em_dash', glyph: '—', source: '---' }))
    const output = writeWithDiagnostics(document)
    expect(output.source).toBe('\n---\n')
    expect(output.diagnostics).toEqual([])
    expect(format(output.source)).toBe(output.source)
  })

  it('C2-W-116: a caption_number is written as #', () => {
    expect(format('| a |\n^ Table # cap')).toBe('| a |\n^ Table # cap\n')
  })

  it('C2-W-120: a first class of the shape of a div name names the div, any other stands on the attribute line', () => {
    const div = (name: string): DocumentNode => ({ type: 'document', astVersion: '2.0', children: [{ type: 'div', attrs: { classes: [name] }, children: [paragraph(text('x'))] }] })
    expect(write(div('my-box'))).toBe('::: my-box\nx\n:::\n')
    expect(write(div('note'))).toBe('{.note}\n:::\nx\n:::\n')
    expect(write(div('a.b'))).toBe('{class="a.b"}\n:::\nx\n:::\n')
  })

  it('C2-W-088: a paragraph that starts with a description mark after a description list keeps its backslash', () => {
    expect(format(':: t\n: d\n\n\n\n\\: x')).toBe(':: t\n: d\n\n\\: x\n')
  })

  it('C2-W-122, C2-W-123: a comment between two lists, behind the open fence of the first, then three blank lines', () => {
    const item = (blocks: Block[]): ListItemNode => ({ type: 'list_item', children: blocks })
    const list = (blocks: Block[]): ListNode => ({ type: 'list', marker: { kind: 'bullet', char: '-' }, spacing: 'tight', children: [item(blocks)] })
    const document: DocumentNode = {
      type: 'document', astVersion: '2.0',
      children: [list([paragraph(text('a')), { type: 'code_block', value: 'x\n' }]), { type: 'comment', form: 'line', value: 'c' }, list([paragraph(text('b'))])],
    }
    const output = writeWithDiagnostics(document)
    expect(output.source).toBe(`- a\n\n  ${FENCE}\n  x\n%% c\n\n\n\n- b\n`)
    expect(output.diagnostics).toEqual([])
  })

  it('C2-W-124: a frontmatter format that is no format name is reported at the frontmatter as structure-unspellable', () => {
    const document: DocumentNode = {
      type: 'document', astVersion: '2.0', children: [{ type: 'frontmatter', format: 'Not A Name', value: 'k: v\n' }, paragraph(text('x'))],
    }
    expect(writeWithDiagnostics(document).diagnostics.map((item) => [item.code, item.path])).toEqual([['structure-unspellable', '/children/0']])
  })

  it('C2-L-047: every block has blankLinesBefore and blankLinesAfter, 0 included; an inline node only with a fact', () => {
    expect(layoutOf('a *b*\n\nc')).toEqual([
      { path: '/children/0', startByte: 0, endByte: 5, blankLinesBefore: 0, blankLinesAfter: 1 },
      { path: '/children/1', startByte: 7, endByte: 8, blankLinesBefore: 1, blankLinesAfter: 0 },
    ])
  })

  it('C2-L-048: a wrap behind a hard break names the joining space behind it, and content that starts in a continuation row has offset 0', () => {
    expect(entry('| a\\ | x |\n+ b | y |', '/children/0/children/0/children/0/children/0')!['wraps'])
      .toEqual([{ line: 1, path: '/children/0/children/0/children/0/children/0/children/0/children/2', offset: 1 }])
    expect(entry('| | x |\n+ b | y |', '/children/0/children/0/children/0/children/0')!['wraps'])
      .toEqual([{ line: 1, path: '/children/0/children/0/children/0/children/0/children/0/children/0', offset: 0 }])
    expect(entry('| `a | x |\n+ b` | y |', '/children/0/children/0/children/0/children/0')!['wraps'])
      .toEqual([{ line: 1, path: '/children/0/children/0/children/0/children/0/children/0/children/0', offset: 3 }])
  })

  it('C2-L-049: rawRef runs from the bracket, without the image mark and the attribute block, read without prefixes', () => {
    expect(entry('> [a\n> b][r]{.c}\n\n[a b]: /u', '/children/0/children/0/children/0')!['rawRef']).toBe('[a\nb][r]')
    expect(entry('![x][r]\n\n[r]: /u', '/children/0/children/0')!['rawRef']).toBe('[x][r]')
  })

  it('C2-L-050: markerRaw of a definition holds its colon, and so does metadataSeparatorRaw', () => {
    const src = '[^n]: note\n\n[r]:  /u\n\n*[A]: Abbr\n\n:: term\n: d'
    expect(entry(src, '/children/0')).toMatchObject({ markerRaw: '[^n]:', metadataSeparatorRaw: ': ' })
    expect(entry(src, '/children/1')).toMatchObject({ markerRaw: '[r]:', metadataSeparatorRaw: ':  ' })
    expect(entry(src, '/children/2')).toMatchObject({ markerRaw: '*[A]:', metadataSeparatorRaw: ': ' })
    expect(entry(src, '/children/3/children/0')).toMatchObject({ markerRaw: '::', metadataSeparatorRaw: ' ' })
  })

  it('C2-L-051: a task box is not content of the item', () => {
    expect(entry('- [x] a', '/children/0/children/0')).toMatchObject({ contentColumn: 6 })
  })

  it('C2-L-052: continuationStyle on every item, description and footnote', () => {
    const src = '- a\n  b\n- c\nlazy\n\n:: t\n: d\n\n[^n]: x'
    expect(entry(src, '/children/0/children/0')!['continuationStyle']).toBe('indent')
    expect(entry(src, '/children/0/children/1')!['continuationStyle']).toBe('lazy')
    expect(entry(src, '/children/1/children/1')!['continuationStyle']).toBe('marker_line')
    expect(entry(src, '/children/2')!['continuationStyle']).toBe('marker_line')
  })

  it('C2-L-053: blank lines with the mark of a quote count inside it, a blank line without the mark after it', () => {
    const src = '> a\n>\n>\n\nb'
    expect(entry(src, '/children/0/children/0')!['blankLinesAfter']).toBe(2)
    expect(entry(src, '/children/0')!['blankLinesAfter']).toBe(1)
    expect(entry(src, '/children/1')!['blankLinesBefore']).toBe(1)
    expect(entry('> a\n>\n>\nb', '/children/0')!['blankLinesAfter']).toBe(0)
  })

  it('C2-L-054: a delimited table has no openerRaw, a caption is preceding, and lineEndings reports a lone CR', () => {
    const src = `{table}\n${FENCE}csv\na\n${FENCE}\n\n| a |\n^ cap`
    expect(entry(src, '/children/0')).not.toHaveProperty('openerRaw')
    expect(entry(src, '/children/0')).not.toHaveProperty('closerRaw')
    expect(entry(src, '/children/1/caption')).toMatchObject({ attachment: 'preceding' })
    expect(parseWithLayout('x\ry').layout.lineEndings).toBe('cr')
  })
})
