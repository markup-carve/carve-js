// The clauses the simplifications and rulings of 16 November 2026 changed, reader side.
import { describe, expect, it } from 'vitest'
import { parse, render } from '../src/index.ts'

describe('C2-B-190, C2-I-118: block and inline depth are limited each by itself', () => {
  it('C2-B-190: Example 247, of 201 quote marks the last is text', () => {
    const html = render(`${'> '.repeat(201)}x`)
    expect(html.split('<blockquote>').length - 1).toBe(200)
    expect(html).toContain('<p>&gt; x</p>')
    expect(render(`${'> '.repeat(200)}x`)).toContain('<blockquote><p>x</p></blockquote>')
  })

  it('C2-I-118: behind 197 quote marks a list item forms its link, and the star that never pairs stays text', () => {
    expect(render(`${'> '.repeat(197)}- *[x](u)`)).toContain('<li>*<a href="u">x</a></li>')
  })

  it('C2-I-118: the count starts at zero in each content, so a quote leaves room for 200 superscripts', () => {
    const html = render(`> ${'{^'.repeat(201)}x${'^}'.repeat(201)}`)
    expect(html).toBe(`<blockquote><p>${'<sup>'.repeat(200)}{^x${'</sup>'.repeat(200)}^}</p></blockquote>`)
  })

  it('C2-I-118: a content of a cell, a heading and a caption each counts from zero', () => {
    const deep = `${'{^'.repeat(200)}x${'^}'.repeat(200)}`
    for (const src of [`${'> '.repeat(150)}| ${deep} |`, `${'> '.repeat(150)}# ${deep}`, `${'> '.repeat(150)}![a](b)\n${'> '.repeat(150)}^ ${deep}`]) {
      expect(render(src).split('<sup>').length - 1, src.slice(300, 320)).toBe(200)
    }
  })

  it('C2-I-118: an unpaired delimiter opener counts until the end of its content, a closed one stops counting', () => {
    const open = parse(`${'{^'.repeat(199)}*[x](u)`).children[0]
    expect(JSON.stringify(open)).not.toContain('"link"')
    const closed = parse(`${'{^a^} '.repeat(300)}*[x](u)`).children[0]
    expect(JSON.stringify(closed)).toContain('"link"')
  })
})

describe('C2-B-137: a comment-only line is invisible to block structure', () => {
  const shape = (src: string): unknown => JSON.parse(JSON.stringify(parse(src).children, (key, value: unknown) => key === 'pos' ? undefined : value))

  it('C2-B-137, C2-B-154: Example 248, a comment-only line at column 0 does not close the heading', () => {
    expect(render('= Title\n%% note\n  continues')).toBe('<section id="Title-continues">\n  <h1>Title\ncontinues</h1>\n</section>')
    expect(shape('= Title\n%% note\n  continues')).toEqual([{
      type: 'heading', level: 1, generatedId: 'Title-continues', children: [
        { type: 'text', value: 'Title' }, { type: 'soft_break' }, { type: 'comment', form: 'line', value: 'note' },
        { type: 'soft_break' }, { type: 'text', value: 'continues' },
      ],
    }])
  })

  it('C2-B-138: below a heading the comment is the last child of the heading, and the heading spans its line', () => {
    const node = parse('= Title\n%% note\ntext').children[0]
    expect(node).toMatchObject({ type: 'heading', pos: { startLine: 1, endLine: 2 } })
    expect(node?.type === 'heading' ? node.children.at(-1) : null).toMatchObject({ type: 'comment', value: 'note' })
    expect(render('= Title\n%% note\ntext')).toBe('<section id="Title">\n  <h1>Title</h1>\n  <p>text</p>\n</section>')
  })

  it('C2-B-137: whatever its indent it closes no container and no table, and a pending attribute line waits', () => {
    expect(render('- a\n%% c\n  b')).toBe('<ul>\n  <li>a\nb</li>\n</ul>')
    expect(render('| a |\n%% c\n| b |')).toContain('<tr><td>b</td></tr>')
    expect(render('{.x}\n%% c\npara')).toBe('<p class="x">para</p>')
  })
})

describe('C2-B-184, C2-I-120: each fragment of a continuation row is an inline content of its own', () => {
  // The children of the paragraph of the first cell of the first table.
  const cell = (src: string): unknown => {
    type Branch = { type: string, children?: Branch[] }
    let node = parse(src, { positions: false }).children.find((child) => child.type === 'table') as Branch | undefined
    while (node !== undefined && node.type !== 'cell_paragraph') node = node.children?.[0]
    return node?.children ?? null
  }

  it('C2-B-184: Example 249 and a strong span that would cross the row are text, joined by one space', () => {
    expect(render('| `a | 1 |\n+ b` | 2 |')).toContain('<tr><td>`a b`</td><td>1 2</td></tr>')
    expect(render('| *a |\n+ b* |')).toContain('<tr><td>*a b*</td></tr>')
    expect(cell('| *a* |\n+ *b* |')).toEqual([
      { type: 'strong', children: [{ type: 'text', value: 'a' }] }, { type: 'text', value: ' ' },
      { type: 'strong', children: [{ type: 'text', value: 'b' }] },
    ])
  })

  it('C2-I-102: a backslash at the end of a fragment is a hard break, followed by the joining space', () => {
    expect(cell('| a\\ |\n+ b |')).toEqual([{ type: 'text', value: 'a' }, { type: 'hard_break' }, { type: 'text', value: ' b' }])
  })

  it('C2-I-098: an abbreviation term split across two rows does not match across the join', () => {
    expect(cell('*[HT]: Hyper Text\n\n| H |\n+ T |')).toEqual([{ type: 'text', value: 'H T' }])
    expect(JSON.stringify(cell('*[HT]: Hyper Text\n\n| HT |\n+ x |'))).toContain('"abbreviation"')
  })

  it('C2-B-184: an empty fragment adds nothing, and a cell that starts in a continuation row has no joining space', () => {
    expect(cell('| a |\n+ |\n+ c |')).toEqual([{ type: 'text', value: 'a c' }])
    expect(cell('| |\n+ b |')).toEqual([{ type: 'text', value: 'b' }])
  })
})

describe('C2-I-017, C2-I-119: a backtick run with no closing run is text', () => {
  it('C2-I-017: the run is text and the scan goes on behind it, so later forms are read', () => {
    expect(render('see `unclosed *x* and [y](/u)')).toBe('<p>see `unclosed <strong>x</strong> and <a href="/u">y</a></p>')
    expect(render('b* and `c\n\nd`')).toBe('<p>b* and `c</p>\n<p>d`</p>')
    expect(render('a `` b `c` d')).toBe('<p>a `` b <code>c</code> d</p>')
  })

  it('C2-I-017: a `!`, `$` or `$$` glued before an unclosed run is text with it', () => {
    expect(render('the sum $`a + b')).toBe('<p>the sum $`a + b</p>')
    expect(render('x $$`a and !``b')).toBe('<p>x $$`a and !``b</p>')
    expect(parse('x !`b').children[0]).toMatchObject({ type: 'paragraph', children: [{ type: 'text', value: 'x !`b' }] })
  })

  it('C2-I-017, C2-B-118: a fence-like line whose info holds a backtick is a paragraph, and its run is text', () => {
    expect(render('```a`b\nx')).toBe('<p>```a`b\nx</p>')
  })

  it('C2-I-017: many unclosed runs of different lengths each find no closer', () => {
    const src = Array.from({ length: 300 }, (_, at) => '`'.repeat(at + 1)).join(' a ')
    expect(render(src)).toBe(`<p>${src}</p>`)
  })
})

describe('C2-I-104, C2-I-105: a straight quote is read from its neighbor before it alone', () => {
  it('C2-I-104: behind a hard break a quote opens, the hard break being whitespace', () => {
    expect(render("a\\\n'b'")).toBe('<p>a<br>\n‘b’</p>')
  })

  it('C2-I-104: behind a closing mark, a closing bracket and an atom a quote closes; a braced comment is transparent', () => {
    expect(render("*'a'* and `x`'s and [b](/u)'s and {%c%}'d' and x{%c%}'s")).toBe(
      '<p><strong>‘a’</strong> and <code>x</code>’s and <a href="/u">b</a>’s and ‘d’ and x’s</p>',
    )
  })

  it('C2-I-105: a single quote before an ASCII digit closes, also where it would open', () => {
    expect(render("'90s and ('5) and \"'7\"")).toBe('<p>’90s and (’5) and “’7”</p>')
  })

  it('C2-I-104: arrows and the plus-minus sign do not change', () => {
    expect(render('a --> b <=> c +- d C++-e')).toBe('<p>a → b ⇔ c ± d C++-e</p>')
  })
})

describe('C2-B-206, C2-A-181: a malformed include is still an include', () => {
  const node = (src: string): unknown => JSON.parse(JSON.stringify(parse(src).children[0], (key, value: unknown) => key === 'pos' ? undefined : value))

  it('C2-B-206: invalid options go to `invalid` as written, in source order, and render as the tree holds them', () => {
    expect(node('{{ a.crv @shift:x @size:2 }}')).toEqual({ type: 'include', path: 'a.crv', invalid: ['@shift:x', '@size:2'] })
    expect(render('{{ a.crv @shift:x @size:2 }}')).toBe('<p>{{ a.crv @shift:x @size:2 }}</p>')
    expect(node('{{ t.csv @rows:9-1 @cols:"a,,b" @rows }}')).toEqual({ type: 'include', path: 't.csv', invalid: ['@rows:9-1', '@cols:"a,,b"', '@rows'] })
    expect(render('{{ t.csv @rows:9-1 @cols:"a,,b" @rows }}')).toBe('<p>{{ t.csv @rows:9-1 @cols:"a,,b" @rows }}</p>')
  })

  it('C2-B-206: a key that stood earlier is invalid, and the first one keeps its effect', () => {
    expect(node('{{ a.crv @lines:2-3 @lines:1-2 }}')).toEqual({ type: 'include', path: 'a.crv', options: { lines: '2-3' }, invalid: ['@lines:1-2'] })
  })

  it('C2-B-203: a second section is outside the basic shape, so the line is text', () => {
    expect(node('{{ a.crv#s#t }}')).toMatchObject({ type: 'paragraph' })
  })

  it('C2-H-133: the unexpanded include is reported include-unresolved, and lint reports each invalid option', async () => {
    const { renderWithDiagnostics } = await import('../src/index.ts')
    const { lint } = await import('../lint/lint.ts')
    expect(renderWithDiagnostics('{{ a.crv @shift:x @size:2 }}').diagnostics.map((item) => item.code)).toEqual(['include-unresolved'])
    expect(lint('{{ a.crv @shift:x @size:2 }}').filter((item) => item.code === 'include-option-invalid').map((item) => item.range))
      .toEqual([{ startOffset: 9, endOffset: 17 }, { startOffset: 18, endOffset: 25 }])
  })
})

describe('C2-B-172 to C2-B-174: a span mark that cannot join is literal, and no span crosses a group', () => {
  it('C2-B-173: Examples 209 and 210, the mark is the text of its cell', () => {
    expect(render('| a | b |\n| < | c |')).toContain('<tr><td>&lt;</td><td>c</td></tr>')
    expect(render('|= H |\n| ^ |\n| a |')).toContain('<tbody>\n    <tr><td>^</td></tr>\n    <tr><td>a</td></tr>')
  })

  it('C2-B-174: `|=|^|` is no head row: the first-row mark counts as the body cell it is', () => {
    expect(render('|=|^|\n| 1 | 2 |')).toBe(
      '<table>\n  <tbody>\n    <tr><th scope="row"></th><td>^</td></tr>\n    <tr><td>1</td><td>2</td></tr>\n  </tbody>\n</table>',
    )
  })

  it('C2-B-173, C2-B-174: Example 250, a header mark on a literal mark, and a mark in the first foot row', () => {
    expect(render('{footer-rows=1}\n|= ^ |= A |\n| 1 | 2 |\n| ^ | 3 |')).toContain('<tfoot>\n    <tr><td>^</td><td>3</td></tr>\n  </tfoot>')
  })

  it('C2-B-172: unchanged, a colspan in the head, a row span inside the head and spans inside one body', () => {
    expect(render('|= A | < |\n| 1 | 2 |')).toContain('<th colspan="2" scope="col">A</th>')
    expect(render('|= A |\n|= ^ |')).toContain('<th rowspan="2" scope="col">A</th>')
    expect(render('| a | < |\n| ^ | d |')).toContain('<td colspan="2">a</td>')
  })

  it('C2-B-184: a continuation fragment under a mark that joins nothing joins that cell', () => {
    expect(render('| ^ |\n+ more |')).toContain('<td>^ more</td>')
  })

  it('C2-A-093: a reader refuses a supplied rowspan that reaches past the last row of its group', async () => {
    const { validateTree } = await import('../src/index.ts')
    const cell = (value: string, rowspan?: number): unknown => ({
      type: 'table_cell', header: false, ...(rowspan === undefined ? {} : { rowspan }), children: [{ type: 'cell_paragraph', children: [{ type: 'text', value }] }],
    })
    const table = (rowspan: number): unknown => ({ type: 'document', astVersion: '2.0', children: [{ type: 'table', columns: [{ type: 'table_column' }], children: [
      { type: 'table_body', children: [{ type: 'table_row', children: [cell('a', rowspan)] }, { type: 'table_row', children: [] }] },
      { type: 'table_foot', children: [{ type: 'table_row', children: [cell('b')] }] },
    ] }] })
    expect(() => validateTree(table(2))).not.toThrow()
    expect(() => validateTree(table(3))).toThrow(/past the last row of its group/)
  })

  it('C2-B-173: lint reports every mark that joins nothing, also behind a header mark', async () => {
    const { lint } = await import('../lint/lint.ts')
    const codes = (src: string): number => lint(src).filter((item) => item.code === 'table-span-marker-blocked').length
    expect([codes('|= ^ |= A |\n| 1 | 2 |'), codes('| a |\n| ^ |'), codes('| \\^ |'), codes('|=|^|')]).toEqual([1, 0, 0, 1])
  })
})

describe('C2-B-209, C2-B-221: a declared head-row count is clamped', () => {
  const FENCE = '```'

  it('C2-B-209: a count past the last row takes every row into the head, consumed from attrs, and lint names the count to write', async () => {
    const src = `{table header-rows=5}\n${FENCE}csv\na,b\nc,d\n${FENCE}`
    expect(render(src)).toBe(
      '<table>\n  <thead>\n    <tr><th scope="col">a</th><th scope="col">b</th></tr>\n'
      + '    <tr><th scope="col">c</th><th scope="col">d</th></tr>\n  </thead>\n</table>',
    )
    const { lint } = await import('../lint/lint.ts')
    const found = lint(src).filter((item) => item.code === 'table-row-count-clamped')
    expect(found.map((item) => [item.severity, item.range, item.message])).toEqual([
      ['hint', { startOffset: 7, endOffset: 20 }, 'header-rows=5 asks for more rows than the table has, so it takes 2. Write header-rows=2.'],
    ])
  })

  it('C2-B-187, C2-B-221: the head takes its rows first, and a clamped footer count is reported too', async () => {
    const src = `{table header-rows=2 footer-rows=2}\n${FENCE}csv\na\nb\nc\n${FENCE}`
    expect(render(src)).toContain('<tfoot>\n    <tr><td>c</td></tr>\n  </tfoot>')
    const { lint } = await import('../lint/lint.ts')
    expect(lint(src).filter((item) => item.code === 'table-row-count-clamped').map((item) => item.message)).toEqual([
      'footer-rows=2 asks for more rows than the table has, so it takes 1. Write footer-rows=1.',
    ])
    expect(lint('{footer-rows=1}\n| a |\n| b |').filter((item) => item.code === 'table-row-count-clamped')).toEqual([])
  })
})

describe('C2-B-015, C2-B-054, C2-B-228: a marker body closes before a list marker it does not own', () => {
  it('C2-B-228: Examples 242 and 243, a list marker left of a footnote body ends the body and opens a new list', () => {
    const html = render('Text[^n].\n\n[^n]: note\n  - one\n- x')
    expect(html).toContain('<p>Text<a id="fnref1" href="#fn1" role="doc-noteref"><sup>1</sup></a>.</p>\n<ul>\n  <li>x</li>\n</ul>')
    expect(html).toContain('<ul>\n        <li>one</li>\n      </ul>')
    expect(render('Text[^n].\n\n[^n]: note\n  1. one\n2. x')).toContain('<ol start="2">\n  <li>x</li>\n</ol>')
  })

  it('C2-B-228: Example 244, the same below a description body', () => {
    expect(render(':: t\n: d\n  - one\n- x')).toBe(
      '<dl>\n  <dt>t</dt>\n  <dd>\n    <p>d</p>\n    <ul>\n      <li>one</li>\n    </ul>\n  </dd>\n</dl>\n<ul>\n  <li>x</li>\n</ul>',
    )
  })

  it('C2-B-012, C2-B-022, C2-B-024: a line that is no interrupter stays lazy, and so does a marker where no list is open', () => {
    expect(render('Text[^n].\n\n[^n]: note\n  - one\nx')).toContain('<li>one\nx</li>')
    expect(render('Text[^n].\n\n[^n]: note\n- x')).toContain('<p>note\n- x')
    expect(render(':: t\n: d\n- x')).toContain('<dd>d\n- x</dd>')
  })
})

describe('the earlier settled entries of _TODO_B, kept', () => {
  it('C2-B-084: Example 241, the second space of an abbreviation definition is the first character of its expansion', () => {
    expect(parse('*[B]:  lead').children[0]).toMatchObject({ type: 'abbreviation_def', key: 'B', expansion: ' lead' })
  })

  it('C2-H-016, C2-H-166: a kept `<li>` under the minimal profile carries data-source-line like every other', () => {
    expect(render('- - -C2-A-034', { profile: 'minimal', sourceLines: true })).toContain('<li data-source-line="1">-C2-A-034</li>')
  })
})
