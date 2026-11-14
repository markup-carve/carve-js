// The clauses that the specification commits after "fix what the review of today's clauses found"
// added or changed, one test per clause id.
import { describe, expect, it } from 'vitest'
import { type AstNode, format, type NodeLayout, parseWithLayout, formatWithDiagnostics, parse, render, renderWithDiagnostics, write, writeWithDiagnostics } from '../src/index.ts'
import { documentOf, paragraph, text } from './support/tree.ts'

const CONTROLS = '‪‮⁦⁩'
const TICK = '`'

function inline(node: AstNode): AstNode {
  return documentOf(paragraph(node))
}

describe('the bidirectional controls', () => {
  it('C2-H-172: they are not written in a title paragraph or a label paragraph', () => {
    expect(render(`::: note "T${CONTROLS}t" [L${CONTROLS}l]\nx\n:::`)).toBe(
      '<aside class="admonition note" aria-labelledby="adm-1">\n  <p class="admonition-title" id="adm-1">Tt</p>\n'
      + '  <p class="div-label">Ll</p>\n  <p>x</p>\n</aside>')
  })

  it('C2-H-172: they are not written in the text of a cross-reference', () => {
    expect(render(`{#h}\n# A${CONTROLS}b\n\nsee </#h>`)).toContain('<a href="#h">Ab</a>')
  })

  it('C2-H-172: they are not written in static math', () => {
    expect(render(`$${TICK}a${CONTROLS}b${TICK}`, { mode: 'static' })).toBe('<p><code class="language-math">ab</code></p>')
  })

  it('C2-H-172: they are not written in the text of an autolink', () => {
    expect(render(inline({ type: 'autolink', href: 'https://a.b', text: `a${CONTROLS}b` })))
      .toBe('<p><a href="https://a.b">ab</a></p>')
  })

  it('C2-H-172: they are not written in an editorial comment', () => {
    expect(render(`a {#ed${CONTROLS}it#} b`)).toBe('<p>a <span class="critic-comment">edit</span> b</p>')
  })

  it('C2-H-172: they are not written in an unresolved reference written as text', () => {
    expect(render(`[x][k${CONTROLS}k]`)).toBe('<p>[x][kk]</p>')
  })

  it('C2-H-172: they are not written in a symbol written as its source', () => {
    expect(render(inline({ type: 'symbol', name: `s${CONTROLS}y` }))).toBe('<p>:sy:</p>')
  })

  it('C2-H-172: they are not written in an unexpanded include', () => {
    expect(render(`{{ a${CONTROLS}.crv }}`)).toBe('<p>{{ a.crv }}</p>')
  })

  it('C2-H-172: they are not written in raw HTML that is escaped', () => {
    expect(render(`a ${TICK}x${CONTROLS}${TICK}{=html} b`)).toBe('<p>a x b</p>')
  })

  it('C2-H-172: they are not written in a degraded form', () => {
    expect(render(`# H${CONTROLS}h`, { profile: 'minimal' })).toBe('<p># Hh</p>')
    expect(render(documentOf(paragraph(text('a'), { type: 'symbol', name: `s${CONTROLS}y` })), { profile: 'minimal' }))
      .toBe('<p>a:sy:</p>')
  })

  it('C2-H-172: the text of a roundtrip carrier keeps them', () => {
    expect(render(`a ${TICK}x${CONTROLS}${TICK}{=html} b`, { roundtrip: true }))
      .toBe(`<p>a <span data-carve-raw="html">x${CONTROLS}</span> b</p>`)
  })

  it('C2-H-172: raw content passed through unescaped keeps them', () => {
    expect(render(`a ${TICK}x${CONTROLS}${TICK}{=html} b`, { rawHtml: true })).toBe(`<p>a x${CONTROLS} b</p>`)
  })
})

describe('the degraded forms', () => {
  const minimal = { profile: 'minimal' } as const

  it('C2-H-165: a description list gives one paragraph for each term and the degraded blocks of each description', () => {
    expect(render(':: term one\n: desc *a*\n\n  desc b\n:: term two\n: desc c', minimal))
      .toBe('<p>term one</p>\n<p>desc a</p>\n<p>desc b</p>\n<p>term two</p>\n<p>desc c</p>')
  })

  it('C2-H-165: the nodes inside a degraded node are not reported again', () => {
    const out = renderWithDiagnostics(':: term one\n: desc *a* [x](/u)\n', minimal)
    expect(out.diagnostics.filter((entry) => entry.code === 'profile-construct-degraded')).toHaveLength(1)
  })

  it('C2-H-165: an include is written as the source text of its directive, options included', () => {
    expect(render('{{ a.crv #s @lines:1-2 @cols:"a,b" }}', minimal)).toBe('<p>{{ a.crv #s @lines:1-2 @cols:"a,b" }}</p>')
  })

  it('C2-H-165: a heading is one # for each level and a space, whatever marker the source used', () => {
    expect(render('=== Deep', minimal)).toBe('<p>### Deep</p>')
  })

  it('C2-H-165: a no-break space, a break and a smart punctuation node give U+00A0, one space and the glyph', () => {
    expect(render('[a\\ b "q" x -- y\\\nz]{.c}', minimal)).toBe('<p>a&nbsp;b “q” x – y z</p>')
  })

  it('C2-H-165: a footnote reference is written as [^key]', () => {
    expect(render('a[^n]\n\n[^n]: note', minimal)).toBe('<p>a[^n]</p>')
  })

  it('C2-H-165: a comment gives no text, and a paragraph that holds only comments writes nothing', () => {
    expect(render('a {% c %} b', minimal)).toBe('<p>a  b</p>')
    expect(render('{% only %}', minimal)).toBe('')
    expect(render('> {% only %}', minimal)).toBe('')
  })
})

describe('the cols value of an include', () => {
  it('C2-A-181, C2-W-058: a cols value that kept its quotes formats to itself with no diagnostic', () => {
    const out = formatWithDiagnostics('{{ a.crv @cols:"a,b" }}')
    expect(out.source).toBe('{{ a.crv @cols:"a,b" }}\n')
    expect(out.diagnostics).toEqual([])
  })

  it('C2-W-058: the writer writes a stored cols value with no second pair', () => {
    expect(write(documentOf({ type: 'include', path: 'a.crv', options: [['cols', '"a b"']] }))).toBe('{{ a.crv @cols:"a b" }}\n')
  })

  it('C2-H-171: the renderer writes a cols value that kept its quotes as stored', () => {
    expect(render('{{ a.crv @cols:"a b" }}')).toBe('<p>{{ a.crv @cols:"a b" }}</p>')
  })
})

describe('the bracket label', () => {
  const fence = TICK.repeat(3)

  it('C2-A-187: the bracket label of a code block is the string groupLabel, with no inline parsing', () => {
    expect(parse(`${fence}js [Tab *x*]\nx\n${fence}`, { positions: false }).children?.[0]).toEqual(
      { type: 'code_block', value: 'x\n', syntax: 'js', groupLabel: 'Tab *x*' })
  })

  it('C2-B-121: the label renders nothing on a code fence', () => {
    expect(render(`${fence}js [Tab]\nx\n${fence}`)).toBe('<pre><code class="language-js">x\n</code></pre>')
  })

  it('C2-B-121: the label is the label paragraph on a div, an admonition and a directive', () => {
    expect(render('::: [Tab *x*]\nx\n:::')).toBe('<div>\n  <p class="div-label">Tab *x*</p>\n  <p>x</p>\n</div>')
    expect(render('::: tip [L]\nx\n:::')).toContain('<p class="div-label">L</p>')
    expect(render('::: toc [L]\n:::')).toBe('<div class="toc">\n  <p class="div-label">L</p>\n</div>')
  })

  it('C2-B-119: a label may stand with no name or language before it', () => {
    expect(parse('::: [L]\nx\n:::', { positions: false }).children?.[0]).toMatchObject({ type: 'div', groupLabel: 'L' })
    expect(parse(`${fence} [L]\nx\n${fence}`, { positions: false }).children?.[0]).toEqual({ type: 'code_block', value: 'x\n', groupLabel: 'L' })
    expect(format('::: [L]\nx\n:::')).toBe('::: [L]\nx\n:::\n')
  })
})

describe('a line comment behind a list', () => {
  const fence = TICK.repeat(3)

  function withComment(src: string): ReturnType<typeof writeWithDiagnostics> {
    const document = parse(src, { positions: false })
    document.children!.push({ type: 'comment', form: 'line', value: 'c' })
    return writeWithDiagnostics(document)
  }

  for (const src of ['- a', ':: t\n: d', '[^n]: d']) {
    it(`C2-W-122: a supplied tree with a line comment as the sibling of ${JSON.stringify(src)} is reported`, () => {
      expect(withComment(src).diagnostics.map((entry) => `${entry.code} ${entry.path ?? ''}`)).toEqual(['structure-unspellable /children/1'])
    })
  }

  it('C2-W-122, C2-W-123: behind an open fence the comment is a sibling and nothing is reported', () => {
    const out = withComment(`- a\n\n  ${fence}\n  x\n  ${fence}`)
    expect(out.source).toBe(`- a\n\n  ${fence}\n  x\n%% c\n`)
    expect(out.diagnostics).toEqual([])
  })
})

describe('continuation rows with no layout record', () => {
  const fence = TICK.repeat(3)

  it('C2-W-067: a pipe-table cell whose code span holds a line feed is written with a continuation row there', () => {
    const document = parse(`| ${TICK}a | b |\n+ b${TICK} | c |`, { positions: false })
    const out = writeWithDiagnostics(document)
    expect(out.source).toBe(`| ${TICK}a | b c |\n+ b${TICK} | |\n`)
    expect(out.diagnostics).toEqual([])
  })

  it('C2-W-067: a braced comment that holds a line feed is broken the same way', () => {
    expect(write(parse('| {%a | b |\n+ x%} | c |', { positions: false }))).toBe('| {% a | b c |\n+ x %} | |\n')
  })

  it('C2-W-067: a delimited table writes a cell that holds a line feed in double quotes', () => {
    const document = parse(`{table}\n${fence}csv\n"a\nb",c\n${fence}`, { positions: false })
    expect(write(document)).toBe(`{table}\n${fence}csv\n"a\nb",c\n${fence}\n`)
  })

  it('C2-W-067: a rawRef that holds a line feed is written in its cell with one space in its place', () => {
    expect(format('| [x][a | b |\n+ b] | c |\n\n[a b]: /u')).toBe('| [x][a b] | b |\n+ | c |\n\n[a b]: /u\n')
  })
})

describe('the scheme test', () => {
  it('C2-H-159: U+0000 of the source is read as U+FFFD, which the scheme test removes', () => {
    expect(render('[x](java\u0000script:alert(1))')).toBe('<p><a href="">x</a></p>')
    expect(render('[x](java\ufffdscript:alert(1))')).toBe('<p><a href="">x</a></p>')
  })

  it('C2-H-159: the two ranges of bidirectional controls are removed before the test', () => {
    expect(render('[x](java\u202ascript:alert(1))')).toBe('<p><a href="">x</a></p>')
    expect(render('[x](java\u2069script:alert(1))')).toBe('<p><a href="">x</a></p>')
  })
})

describe('the layout record', () => {
  function entries(src: string): NodeLayout[] {
    return parseWithLayout(src).layout.nodes
  }

  function entry(src: string, path: string): NodeLayout | undefined {
    return entries(src).find((node) => node.path === path)
  }

  it('C2-L-011: the slots of a node are visited in the order title, children, caption', () => {
    expect(entries('::: note "see [x][r]"\n[y][r]\n:::\n\n[r]: /u').map((node) => node.path))
      .toEqual(['/children/0', '/children/0/title/1', '/children/0/children/0', '/children/0/children/0/children/0', '/children/1'])
    const figure = entries('![a][r]\n^ see [c][r]\n\n[r]: /u').map((node) => node.path)
    expect(figure.indexOf('/children/0/children/0')).toBeLessThan(figure.indexOf('/children/0/caption'))
  })

  it('C2-L-020, C2-L-021: an offset of 0 marks the start of a node that need not have a value', () => {
    const cell = '/children/0/children/0/children/0/children/0'
    expect(entry('| |\n+ *b* |', cell)?.wraps).toEqual([{ line: 1, path: `${cell}/children/0/children/0`, offset: 0 }])
    expect(format('| |\n+ *b* |')).toBe('| |\n+ *b* |\n')
    expect(format('| a | x |\n+ *b* | /y/ |')).toBe('| a | x |\n+ *b* | /y/ |\n')
  })

  it('C2-L-048: a cell that spans rows has row on its wraps, the number of rows below its own', () => {
    const wraps = entry('| a | b |\n|^ | c |\n+ x | d |', '/children/0/children/0/children/0/children/0')?.wraps
    expect(wraps).toEqual([{ line: 1, path: '/children/0/children/0/children/0/children/0/children/0/children/0', offset: 2, row: 1 }])
  })

  it('C2-L-045, C2-L-054: a comment inside a quote has the column of the quote mark, and none when its line lacks the mark', () => {
    expect(entry('> a\n>\n> %% c', '/children/0/children/1')?.markerColumn).toBe(0)
    expect(entry('  > a\n  >\n  > %% c', '/children/0/children/1')?.markerColumn).toBe(2)
    expect(entry('> a\n>\n%% c', '/children/0/children/1')).not.toHaveProperty('markerColumn')
  })
})
