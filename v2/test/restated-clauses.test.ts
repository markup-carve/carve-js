// The clauses that restate rules 0.2 first took from 0.1: the heading slug, the include directive,
// caption numbering, the table attributes, admonitions and directives, the URL filter, the
// profiles, autolinks, and comments that tools read. One test per clause, named with its id.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { generateRenderTables } from '../scripts/generate-render-tables.ts'
import {
  type AstNode, CarveInputError, CarveRenderError, parse, parseWithDiagnostics, render, type RenderOptions, renderWithDiagnostics,
} from '../src/index.ts'
import { type Diagnostic, locateFindings } from '../src/diagnostics.ts'
import { escapeText } from '../src/html-attributes.ts'
import { slugify } from '../src/slug.ts'
import { block, blocks, documentOf, paragraph, resolved, text } from './support/tree.ts'

const root = join(import.meta.dirname, '..')
const read = (path: string): string => readFileSync(join(root, path), 'utf8')
const FENCE = '```'

type Case = readonly [string, string, string, RenderOptions?]

function check(cases: readonly Case[]): void {
  for (const [name, src, html, options] of cases) {
    it(name, () => {
      expect(render(src, options)).toBe(html)
    })
  }
}

function ids(src: string, options?: RenderOptions): string[] {
  return [...render(src, options).matchAll(/<(?:section|h\d)[^>]* id="([^"]*)"/g)].map((match) => match[1]!)
}

function headingId(node: AstNode): string | undefined {
  const document = documentOf({ type: 'heading', level: 1, children: [node] })
  render(document)
  return document.children![0]!.generatedId
}

it('src/render-tables.ts is what scripts/generate-render-tables.ts writes', () => {
  expect(read('src/render-tables.ts')).toBe(generateRenderTables(read('data/heading-slug.json'), read('data/url-policy.json'), read('data/include-options.json')))
})

describe('the heading slug', () => {
  it('C2-H-143: each node type gives its text, a comment and a note give none, and an index entry gives nothing', () => {
    expect(ids('# a `b` !`c` $`d` e\\ f')).toEqual(['a-b-c-d-e f'])
    expect(ids('# a\n  b\\\n  c')).toEqual(['a-b-c'])
    expect(ids('# ![alt *x*](i.png) <https://a.b> @user #tag')).toEqual(['alt-x-https-a-b-user-tag'])
    expect(ids('# a{% c %}b[^n] ^[note] </#x> :sym: `<b>`{=html} {# cc #}\n\n[^n]: n')).toEqual(['ab'])
    expect(ids('# *a* _b_ {+c+} [d]{.e} [f](g) :x[h] :index[i]')).toEqual(['a-b-c-d-f-h'])
    expect(headingId({ type: 'mention', target: 't', kind: 'user', label: 'Shown' })).toBe('t')
    expect(headingId({ type: 'ruby', pairs: [{ type: 'rubyPair', base: [text('b')], annotation: [text('a')] }] })).toBe('b-a')
    expect(headingId({ type: 'abbreviation', key: 'HTML', namespace: 'abbr', expansion: 'x' })).toBe('HTML')
    expect(headingId({ type: 'citation_group', raw: '[@a]', children: [] })).toBe('s')
  })

  it('C2-H-144: the text is normalized to NFC, and the characters of the list `removed` are dropped', () => {
    expect(slugify('é', 'keep-case')).toBe('é')
    expect(slugify('a­b​c‍d‮e⁦f﻿f⁠g', 'keep-case')).toBe('abcdeffg')
    // U+200E is no entry of the list.
    expect(slugify('a‎b', 'keep-case')).toBe('a‎b')
  })

  it('C2-H-145: each glyph of the list `reversed` is its ASCII source, typed or written by smart typography', () => {
    expect(ids('# a -> b ... c')).toEqual(['a-b-c'])
    expect(slugify('it’s → x', 'keep-case')).toBe('it-s-x')
    expect(slugify('a™', 'keep-case')).toBe('a-tm')
    expect(slugify('x±y≠z', 'keep-case')).toBe('x-y-z')
    // U+201B is no entry of the list and stays.
    expect(slugify('a‛b', 'keep-case')).toBe('a‛b')
  })

  it('C2-H-146: each run of other ASCII characters is one hyphen, the ends are trimmed, and every character from U+0080 stays', () => {
    expect(slugify('  Hello,  World!  ', 'keep-case')).toBe('Hello-World')
    expect(slugify('a_b~c', 'keep-case')).toBe('a-b-c')
    expect(slugify('Ärger § 日本  x', 'keep-case')).toBe('Ärger-§-日本- x')
  })

  it('C2-H-147: `lower` maps each character on its own, and `ascii` transliterates and trims again', () => {
    expect(slugify('ΣΑΣ', 'lower')).toBe('σασ')
    expect(slugify('İstanbul', 'lower')).toBe('i̇stanbul')
    expect(slugify('Ärger § Straße', 'ascii')).toBe('arger-strasse')
    expect(slugify('ABC', 'keep-case')).toBe('ABC')
  })

  it('C2-H-148: a leading Unicode number gets the prefix `s-`, an empty result is `s`, and the suffix follows the prefix', () => {
    expect(slugify('1 a', 'keep-case')).toBe('s-1-a')
    expect(slugify('٣', 'keep-case')).toBe('s-٣')
    expect(slugify('½', 'keep-case')).toBe('s-½')
    expect(slugify('!!!', 'keep-case')).toBe('s')
    expect(ids('# 1\n\n# 1')).toEqual(['s-1', 's-1-2'])
  })
})

describe('the include directive', () => {
  const kind = (src: string): string => block(src).type

  it('C2-B-201: braces, spaces, a path, a section, options, spaces and braces; a tab is no such space', () => {
    expect(block('{{ a.crv#s@shift:1 }}')).toEqual({ type: 'include', path: 'a.crv', section: 's', options: [['shift', '1']] })
    expect(block('{{   a.crv   }} \t')).toEqual({ type: 'include', path: 'a.crv' })
    const refused = ['{{\ta.crv }}', '{{a.crv }}', '{{ a.crv}}', '{{ a.crv\t}}', '{{ a.crv }} x', '{{ }}', '{{}}', '{{ a.crv x}', '{  a.crv }}', '{{ a.crv }']
    expect(refused.map(kind)).toEqual(Array(10).fill('paragraph'))
    // The closing braces are the first ones outside a quoted run.
    expect(block('{{ "a }} b" @rows:"1 }} 2" }}')).toEqual({ type: 'include', path: 'a }} b', options: [['rows', '1 }} 2']] })
  })

  it('C2-B-202: a bare, a double-quoted and a curly-quoted path, and an empty one makes the line text', () => {
    expect(block('{{ a/b.crv }}').path).toBe('a/b.crv')
    expect(block('{{ "a\\.crv" }}').path).toBe('a.crv')
    expect(block('{{ "notes\\new.crv" }}').path).toBe('notes\\new.crv')
    expect(block('{{ "a \\" b" }}').path).toBe('a " b')
    expect(block('{{ “a\\.b c” }}').path).toBe('a\\.b c')
    expect(block('{{ "a" }}').path).toBe('a')
    expect(block('{{ a.crv@code }}')).toEqual({ type: 'include', path: 'a.crv', options: [['code', '']] })
    const refused = ['{{ "" }}', '{{ “” }}', '{{ “”x” }}', '{{ a"b }}', '{{ a“b }}', '{{ "a }}', '{{ a}b }}', '{{ #s }}', '{{ @code }}']
    expect(refused.map(kind)).toEqual(Array(9).fill('paragraph'))
  })

  it('C2-B-203: a section is `#` and a name, and a directive holds at most one', () => {
    expect(block('{{ a.crv #_s-1 }}').section).toBe('_s-1')
    expect(block('{{ a.crv #1a }}').section).toBe('1a')
    expect(block('{{ a.crv #z9Z0 }}').section).toBe('z9Z0')
    expect(['{{ a.crv #-s }}', '{{ a.crv # }}', '{{ a.crv #s.t }}', '{{ a.crv #s #t }}'].map(kind)).toEqual(Array(4).fill('paragraph'))
  })

  it('C2-B-204: an option is an at-sign, a key and an optional value; an unquoted value ends at the next option', () => {
    expect(block('{{ a.crv @shift:1@lines:1-8 }}').options).toEqual([['lines', '1-8'], ['shift', '1']])
    expect(block('{{ a.crv @lines:"1-2" @code:\'c\' }}').options).toEqual([['lines', '1-2'], ['code', 'c']])
    expect(block('{{ a.crv @rows:"a @ b }} c" }}').options).toEqual([['rows', 'a @ b }} c']])
    expect(['{{ a.crv @ }}', '{{ a.crv @1k }}', '{{ a.crv @rows: }}', '{{ a.crv @rows:"x }}'].map(kind)).toEqual(Array(4).fill('paragraph'))
  })

  it('C2-B-205: the shape of the value of each of the six keys', () => {
    const valid = [
      '@lines:1-1', '@lines:2-10', '@rows:3-4', '@region:_r-1', '@cols:1-2', '@cols:"a,b c"', '@cols:"a\\,b"', '@shift:auto', '@shift:+2',
      '@shift:-3', '@shift:007', '@code', '@code:c++', '@code:a-b_c#d.e/f',
    ]
    for (const option of valid) expect([option, kind(`{{ a.crv ${option} }}`)]).toEqual([option, 'include'])
    // Outside its shape, an option of `shift`, `region` and `code` makes the line a paragraph.
    const refused = ['@shift:x', '@shift:+', '@shift:1.5', '@region:1r', '@region:"r 1"', '@code:c!', '@code:""']
    for (const option of refused) expect([option, kind(`{{ a.crv ${option} }}`)]).toEqual([option, 'paragraph'])
  })

  it('C2-B-206: a second section, an unknown key, and what the table sends to `paragraph` make a paragraph; the rest leaves an include node', () => {
    expect(['{{ a.crv @foo:1 }}', '{{ a.crv @lines }}', '{{ a.crv @region }}', '{{ a.crv @shift }}'].map(kind)).toEqual(Array(4).fill('paragraph'))
    expect(['{{ a.crv @lines:1-2 @lines:3-4 }}', '{{ a.crv @code @code }}', '{{ a.crv @shift:1 @shift:2 }}'].map(kind)).toEqual(Array(3).fill('paragraph'))
    // Outside its shape, `lines`, `rows` and `cols` leave a node that an expansion reports.
    expect(block('{{ a.crv @lines:5-1 @rows:01-2 @cols:x }}').options).toEqual([['lines', '5-1'], ['rows', '01-2'], ['cols', 'x']])
    expect(block('{{ a.crv @rows @cols }}').options).toEqual([['rows', ''], ['cols', '']])
  })

  it('C2-A-181: the options stand in the fixed order, a repeated `rows` or `cols` keeps the first, and a list of names keeps its quotes', () => {
    expect(block('{{ a.crv @code @shift:1 @cols:"a,b" @rows:1-2 @region:r @lines:1-2 }}').options).toEqual([
      ['lines', '1-2'], ['region', 'r'], ['rows', '1-2'], ['cols', '"a,b"'], ['shift', '1'], ['code', ''],
    ])
    expect(block('{{ a.crv @rows:1-2 @rows:3-4 @cols:"a\\,b" @cols:1-2 }}').options).toEqual([['rows', '1-2'], ['cols', '"a\\,b"']])
    // A quoted value that is no list of names is a value like any other: its quotes go and its escapes are read.
    const cols = (written: string): unknown => block(`{{ a.crv @cols:${written} }}`).options
    expect(cols('"\\,"')).toEqual([['cols', '"\\,"']])
    expect(cols('"a,,b"')).toEqual([['cols', 'a,,b']])
    expect(cols('"a,"')).toEqual([['cols', 'a,']])
    expect(cols('",a"')).toEqual([['cols', ',a']])
    expect(cols('""')).toEqual([['cols', '']])
    expect(cols("'a,b'")).toEqual([['cols', 'a,b']])
  })

  it('C2-A-182: an include node spans the directive from its opening braces to its closing braces', () => {
    const node = parse('  {{ a.crv }}  ').children![0]!
    expect([node.type, node.pos!.startOffset, node.pos!.endOffset]).toEqual(['include', 2, 13])
  })

  check([
    ['C2-H-133, C2-W-058: an unexpanded directive is written with one space between its parts, and a path is quoted where the bare form does not hold it',
      '{{ "my file.crv"   #Intro @shift:1 @lines:1-5 }}', '<p>{{ "my file.crv" #Intro @lines:1-5 @shift:1 }}</p>'],
    ['C2-H-133: an option with no value is its key, a list of names keeps its quotes, and a value with a space is quoted',
      '{{ a.crv @code @cols:"a,b" @rows:"1 2" }}', '<p>{{ a.crv @rows:"1 2" @cols:"a,b" @code }}</p>'],
    ['C2-B-206: a line that is no directive is a paragraph, and its at-sign reads as a mention',
      '{{ a.crv @shift:x }}', '<p>{{ a.crv <span class="mention"><strong>@shift</strong></span>:x }}</p>'],
  ])
})

describe('caption numbering', () => {
  const captions = (src: string, options?: RenderOptions): string[] => [...render(src, options).matchAll(/<(?:fig)?caption>(.*)<\/(?:fig)?caption>/g)].map((match) => match[1]!)
  const figure = (caption: string): string => `![a](a.png)\n^ ${caption}\n`

  it('C2-B-207: the mark is the first `#` of the top-level text that no tag-name character follows', () => {
    expect(captions([figure('A #: x'), figure('A #. y'), figure('A #'), figure('A # z'), figure('A #é')].join('\n'))).toEqual(['A 1: x', 'A 2. y', 'A 3', 'A 4 z', 'A 5é'])
    expect(captions(figure('A #1 and # and #'))).toEqual(['A #1 and 1 and #'])
    expect(captions(figure('A \\# and #'))).toEqual(['A # and 1'])
    expect(captions(figure('A *#* [#](u) #'))).toEqual(['A <strong>#</strong> <a href="u">#</a> 1'])
    expect(captions(figure('A #tag'))).toEqual(['A <span class="tag"><strong>#tag</strong></span>'])
  })

  it('C2-B-208: the key is the plain text of the label, a comment changes none, a symbol gives what the caption writes, and case counts', () => {
    expect(captions([figure('*Figure* #'), figure('Figure{% c %} #'), figure('Figure #'), figure('figure #'), figure('Fig. #'), figure('#'), figure('#')].join('\n'))).toEqual([
      '<strong>Figure</strong> 1', 'Figure 2', 'Figure 3', 'figure 1', 'Fig. 1', '1', '2',
    ])
    expect(captions([figure(':fig: #'), figure('#'), figure('*:fig:* #'), figure('#')].join('\n'))).toEqual([':fig: 1', '1', '<strong>:fig:</strong> 2', '2'])
    // An index entry in the label gives nothing, as in a heading.
    expect(captions([figure('Figure :index[e] #'), figure('Figure #')].join('\n'))).toEqual(['Figure <span class="ext-index">e</span> 1', 'Figure 2'])
    expect(captions([figure(':fig: #'), figure('Figure #')].join('\n'), { symbols: { fig: 'Figure' } })).toEqual(['Figure 1', 'Figure 2'])
  })

  it('C2-H-149: each key has its own count from 1, the block under the caption selects nothing, and a caption without a mark takes none', () => {
    const src = [figure('Table #'), '| a |\n^ Table #\n', `${FENCE}\nx\n${FENCE}\n^ Listing #\n`, figure('Table'), figure('Table #')].join('\n')
    expect(captions(src)).toEqual(['Table 1', 'Table 2', 'Listing 1', 'Table', 'Table 3'])
  })

  it('C2-H-150: the captions of footnote bodies take their numbers after the document body, and an unused definition takes none', () => {
    const src = `a[^n]\n\n${figure('F #: body')}\n[^n]: note\n\n    ![b](b.png)\n    ^ F #: in the note\n\n[^u]: unused\n\n    ![c](c.png)\n    ^ F #: unused\n\n${figure('F #: after')}`
    expect(captions(src)).toEqual(['F 1: body', 'F 2: after', 'F 3: in the note'])
    const unused = parse(src, { positions: false }).children!.find((node) => node.key === 'u')!
    expect(JSON.stringify(unused)).toContain('{"type":"caption_number"}')
  })

  it('C2-H-151: in a supplied tree a display equation with a prefix takes the next number of that key, and a figure whose caption has a mark owns it', () => {
    const math = (extra: Partial<AstNode> = {}): AstNode => ({ type: 'math', display: true, value: 'x', numberPrefix: 'Eq.', ...extra })
    const caption = (...children: AstNode[]): AstNode => ({ type: 'caption', children: [{ type: 'paragraph', children }] })
    const numbered: AstNode = { type: 'figure', children: [paragraph(math())], caption: caption(text('Eq. '), { type: 'caption_number' }) }
    const plain: AstNode = { type: 'figure', children: [paragraph(math())], caption: caption(text('no mark')) }
    const document = documentOf(paragraph(math()), numbered, plain, paragraph(math({ display: false })), paragraph(math({ numberPrefix: 'Other' })))
    const html = render(document)
    expect([...html.matchAll(/class="equation-number">([^<]*)</g)].map((match) => match[1])).toEqual(['Eq. 1', 'Eq. 3', 'Other 1'])
    expect(html).toContain('<p><span class="math display" role="math">\\[x\\]</span> <span class="equation-number">Eq. 1</span></p>')
    expect(html).toContain('<figcaption>Eq. 2</figcaption>')
    expect(render('$$`x`\n^ Equation #')).toContain('<figcaption>Equation 1</figcaption>')
    // A figure group owns the number like a figure, and a table does not.
    const group: AstNode = { type: 'figure_group', children: [paragraph(math())], caption: caption(text('Eq. '), { type: 'caption_number' }) }
    const cell: AstNode = { type: 'table_cell', header: false, children: [paragraph(math())] }
    const table: AstNode = {
      type: 'table', columns: [{ type: 'table_column' }], children: [{ type: 'table_body', children: [{ type: 'table_row', children: [cell] }] }],
      caption: caption(text('Eq. '), { type: 'caption_number' }),
    }
    const second = render(documentOf(group, table))
    expect([...second.matchAll(/class="equation-number">([^<]*)</g)].map((match) => match[1])).toEqual(['Eq. 3'])
    expect([...second.matchAll(/<(?:fig)?caption>([^<]*)</g)].map((match) => match[1])).toEqual(['Eq. 1', 'Eq. 2'])
  })
})

describe('the table attributes', () => {
  const rows = (src: string): string => render(src).replaceAll(/\n */g, '').replaceAll(/<\/?table>/g, '')
  const csv = (attributes: string, ...lines: string[]): string => `${attributes}\n${FENCE}csv\n${lines.join('\n')}\n${FENCE}`

  it('C2-B-209: the first row of a delimited table is its head, a count sets it, and a count past the last row gives no head and header cells', () => {
    expect(rows(csv('{table}', 'a', 'b'))).toBe('<thead><tr><th scope="col">a</th></tr></thead><tbody><tr><td>b</td></tr></tbody>')
    expect(rows(csv('{table header-rows=2}', 'a', 'b'))).toBe('<thead><tr><th scope="col">a</th></tr><tr><th scope="col">b</th></tr></thead>')
    expect(rows(csv('{table header-rows=0}', 'a', 'b'))).toBe('<tbody><tr><td>a</td></tr><tr><td>b</td></tr></tbody>')
    expect(rows(csv('{table header-rows=3}', 'a', 'b'))).toBe('<tbody><tr><th scope="row">a</th></tr><tr><th scope="row">b</th></tr></tbody>')
  })

  it('C2-B-210: a count is one or more digits, an empty value counts as 1, and any other value has no effect', () => {
    const one = rows(csv('{table}', 'a', 'b'))
    for (const value of ['header-rows', 'header-rows=""', 'header-rows="1"', 'header-rows=01', 'header-rows=x', 'header-rows=1x', 'header-rows=-1', 'header-rows=1.0']) {
      expect([value, rows(csv(`{table ${value}}`, 'a', 'b'))]).toEqual([value, one])
    }
    // The last key of a name counts, and one that is no count leaves the default.
    expect(rows(csv('{table header-rows=0 header-rows=x}', 'a', 'b'))).toBe(one)
    const foot = '<tbody><tr><td>a</td></tr></tbody><tfoot><tr><td>b</td></tr></tfoot>'
    for (const value of ['footer-rows', 'footer-rows=1', 'footer-rows="1"', 'footer-rows=001']) expect([value, rows(`{${value}}\n| a |\n| b |`)]).toEqual([value, foot])
    for (const value of ['footer-rows=x', 'footer-rows=1x', 'footer-rows=-1', 'title="footer-rows=1"']) {
      expect([value, rows(`{${value}}\n| a |\n| b |`).includes('tfoot')]).toEqual([value, false])
    }
    expect(rows('{footer-rows=99999999999}\n|= h |\n| a |\n| b |')).toBe('<thead><tr><th scope="col">h</th></tr></thead><tfoot><tr><td>a</td></tr><tr><td>b</td></tr></tfoot>')
    expect(rows(csv('{table footer-rows=1}', 'a', 'b', 'c'))).toBe('<thead><tr><th scope="col">a</th></tr></thead><tbody><tr><td>b</td></tr></tbody><tfoot><tr><td>c</td></tr></tfoot>')
  })

  it('C2-A-088: a body whose partition the source declared carries headRows, and a value that is no count declares none', () => {
    const body = (attributes: string): AstNode | undefined => block(csv(attributes, 'a', 'b')).children!.find((group) => group.type === 'table_body')
    expect(body('{table}')!.headRows).toBeUndefined()
    expect(body('{table header-rows=x}')!.headRows).toBeUndefined()
    expect(body('{table header-rows=1}')!.headRows).toBe(1)
    expect(body('{table header-rows=0}')!.headRows).toBe(0)
    expect(body('{table header-rows=5}')!.headRows).toBe(5)
  })

  it('C2-B-211: an entry of `aligns` that is left, right or center sets the column, and any other leaves it unset', () => {
    expect(block('{aligns=" left ,x,,RIGHT,center,right,left"}\n| a | b | c | d | e | f |').columns).toEqual([
      { type: 'table_column', align: 'left', authored: true }, { type: 'table_column' }, { type: 'table_column' }, { type: 'table_column' },
      { type: 'table_column', align: 'center', authored: true }, { type: 'table_column', align: 'right', authored: true },
    ])
    expect(block('{aligns="l,r,c"}\n| a | b | c |').columns).toEqual([{ type: 'table_column' }, { type: 'table_column' }, { type: 'table_column' }])
  })

  it('C2-B-212: an entry of `widths` above 0 and at most 100 sets the width to a hundredth of it', () => {
    const widths = (value: string): (number | undefined)[] => block(`{widths="${value}"}\n| a | b | c | d |`).columns!.map((column) => column.width)
    expect(widths('25, 30.5 ,100,0.5')).toEqual([0.25, 0.305, 1, 0.005])
    expect(widths('0,101,-5,x')).toEqual([undefined, undefined, undefined, undefined])
    expect(widths('.5,5.,1e1,+5')).toEqual([undefined, undefined, undefined, undefined])
    expect(widths('50,,50,10,10')).toEqual([0.5, undefined, 0.5, 0.1])
    expect(widths('60,60')).toEqual([0.6, 0.6, undefined, undefined])
  })

  it('C2-B-213: the mark of the cell, then that of the head cell that starts in its column, then the entry of `aligns`', () => {
    const src = '{aligns="left,left,center"}\n|={>} A | < |= C |\n|={~} D |= E |= F |\n| a |{<} b | c |'
    expect(rows(src)).toBe([
      '<thead><tr><th colspan="2" scope="col" style="text-align: right;">A</th><th scope="col" style="text-align: center;">C</th></tr>',
      '<tr><th scope="col" style="text-align: center;">D</th><th scope="col" style="text-align: left;">E</th><th scope="col" style="text-align: center;">F</th></tr></thead>',
      '<tbody><tr><td style="text-align: center;">a</td><td style="text-align: left;">b</td><td style="text-align: center;">c</td></tr></tbody>',
    ].join(''))
    // A mark on a body cell applies to that cell only.
    expect(rows('|{>} a |\n| b |')).toBe('<tbody><tr><td style="text-align: right;">a</td></tr><tr><td>b</td></tr></tbody>')
  })

  it('C2-B-213: in a supplied tree the vertical axis resolves on its own, and a row of counts marks the column its cell starts in', () => {
    const cell = (value: string, extra: Partial<AstNode> = {}): AstNode => ({ type: 'table_cell', header: false, children: [{ type: 'cell_paragraph', children: [text(value)] }], ...extra })
    const table: AstNode = {
      type: 'table', columns: [{ type: 'table_column' }, { type: 'table_column', valign: 'bottom' }, { type: 'table_column' }],
      children: [
        { type: 'table_head', children: [{ type: 'table_row', children: [cell('h', { header: true, colspan: 2, valign: 'top' }), cell('i', { header: true, align: 'right', valign: 'middle' })] }] },
        { type: 'table_body', children: [{ type: 'table_row', children: [cell('a'), cell('b'), cell('c', { valign: 'baseline' })] }] },
      ],
    }
    // A head cell that spans two rows covers its column in the second head row, so the cell of that row starts in the next one.
    const spanned: AstNode = {
      type: 'table', columns: [{ type: 'table_column' }, { type: 'table_column' }],
      children: [{
        type: 'table_head', children: [
          { type: 'table_row', children: [cell('h', { header: true, rowspan: 2 }), cell('i', { header: true, align: 'right' })] },
          { type: 'table_row', children: [cell('j', { header: true, align: 'center' })] },
        ],
      }],
    }
    render(documentOf(spanned))
    expect(spanned.columns!.map((column) => column.resolvedAlign)).toEqual([undefined, 'center'])
    const html = render(documentOf(table))
    expect(html).toContain('<tr><td style="vertical-align: top;">a</td><td style="vertical-align: bottom;">b</td><td style="text-align: right; vertical-align: baseline;">c</td></tr>')
  })

  check([
    ['C2-H-152: a colgroup with one col per column when a column has a width, written as a percentage without trailing zeros',
      '{widths="30.5,,7"}\n| a | b | c |', '<table>\n  <colgroup>\n    <col style="width: 30.5%;">\n    <col>\n    <col style="width: 7%;">\n  </colgroup>\n  <tbody>\n    <tr><td>a</td><td>b</td><td>c</td></tr>\n  </tbody>\n</table>'],
    ['C2-H-152: a table where no column has a width has no colgroup', '{widths="x,0"}\n| a | b |', '<table>\n  <tbody>\n    <tr><td>a</td><td>b</td></tr>\n  </tbody>\n</table>'],
    ['C2-H-153, C2-B-214: the four keys are read and not written, also where a value is invalid, and header-cols is an ordinary key',
      '{aligns=x widths=y header-rows=z footer-rows=w header-cols=1 k=v}\n| a |', '<table header-cols="1" k="v">\n  <tbody>\n    <tr><td>a</td></tr>\n  </tbody>\n</table>'],
  ])

  it('C2-H-152: a supplied width is written with at most ten decimal places', () => {
    const table: AstNode = { type: 'table', columns: [{ type: 'table_column', width: 0.07 }, { type: 'table_column', width: 1 / 3 }], children: [] }
    expect(render(documentOf(table))).toBe('<table>\n  <colgroup>\n    <col style="width: 7%;">\n    <col style="width: 33.3333333333%;">\n  </colgroup>\n</table>')
    expect(() => render(documentOf({ type: 'table', columns: [{ type: 'table_column', width: 1.5 }], children: [] }))).toThrow('not a fraction')
  })
})

describe('admonitions and directives', () => {
  check([
    ['C2-H-154: an admonition is an aside with the classes admonition, its kind and the authored ones; its title and its label are written when written',
      '{.x #i}\n::: note "T *b*" [L]\nB\n:::', '<aside id="i" class="admonition note x" aria-labelledby="adm-1">\n  <p class="admonition-title" id="adm-1">T <strong>b</strong></p>\n  <p class="div-label">L</p>\n  <p>B</p>\n</aside>'],
    ['C2-H-154: an empty quoted title still gives an empty title paragraph, and no title is made from the kind',
      '::: tip ""\n:::\n\n::: tip\n:::', '<aside class="admonition tip" aria-labelledby="adm-1">\n  <p class="admonition-title" id="adm-1"></p>\n</aside>\n<aside class="admonition tip" aria-label="Tip">\n\n</aside>'],
    ['C2-H-155: without a title the label string of the kind names the admonition', '::: danger\nx\n:::', '<aside class="admonition danger" aria-label="Gefahr">\n  <p>x</p>\n</aside>', { labels: { admonitionDanger: 'Gefahr' } }],
    ['C2-H-155: an authored aria-label or aria-labelledby, in any case, stops the name and the id',
      '{ARIA-Label="mine"}\n::: note "T"\n:::\n\n{aria-labelledby=x}\n::: note\n:::\n\n::: note "U"\n:::',
      '<aside class="admonition note" ARIA-Label="mine">\n  <p class="admonition-title">T</p>\n</aside>\n<aside class="admonition note" aria-labelledby="x">\n\n</aside>\n<aside class="admonition note" aria-labelledby="adm-1">\n  <p class="admonition-title" id="adm-1">U</p>\n</aside>'],
    ['C2-H-156: an id that is taken by an authored id or by a heading id gets a suffix',
      '# adm-1\n\n{#adm-2}\n::: note "A"\n:::\n\n::: note "B"\n:::',
      '<section id="adm-1">\n  <h1>adm-1</h1>\n  <aside id="adm-2" class="admonition note" aria-labelledby="adm-1-2">\n    <p class="admonition-title" id="adm-1-2">A</p>\n  </aside>\n  <aside class="admonition note" aria-labelledby="adm-2-2">\n    <p class="admonition-title" id="adm-2-2">B</p>\n  </aside>\n</section>'],
    ['C2-H-157: a plain div writes its title and its label and carries no name and no id',
      '::: box "T" [L]\nx\n:::', '<div class="box">\n  <p class="admonition-title">T</p>\n  <p class="div-label">L</p>\n  <p>x</p>\n</div>'],
    ['C2-H-157: a label is written as text', '::: box [a *b* <c>]\n:::', '<div class="box">\n  <p class="div-label">a *b* &lt;c&gt;</p>\n</div>'],
    ['C2-H-158: the other five directives place nothing and are a div of their kind',
      '::: toc "C" [L]\nx\n:::\n\n::: glossary\n:::', '<div class="toc">\n  <p class="admonition-title">C</p>\n  <p class="div-label">L</p>\n  <p>x</p>\n</div>\n<div class="glossary">\n\n</div>'],
    ['C2-H-158: a footnotes directive with no note to place is a div',
      '::: footnotes "N"\n:::', '<div class="footnotes">\n  <p class="admonition-title">N</p>\n</div>'],
  ])

  it('C2-H-156: the ids count in document order and then through the footnote bodies in the order of their numbers', () => {
    const src = 'a[^2] b[^1]\n\n::: note "A"\n:::\n\n[^1]: one\n\n    ::: note "in one"\n    :::\n\n[^2]: two\n\n    ::: note "in two"\n    :::\n\n[^3]: unused\n\n    ::: note "unused"\n    :::\n\n::: note "B"\n:::'
    const html = render(src)
    expect([...html.matchAll(/id="(adm-[^"]*)">([^<]*)</g)].map((match) => [match[1], match[2]])).toEqual([
      ['adm-1', 'A'], ['adm-2', 'B'], ['adm-3', 'in two'], ['adm-4', 'in one'],
    ])
  })

  it('C2-H-158: a top-level footnotes directive places the section; its title and its label stand before the rule, and a title names it', () => {
    const notes = '\n  <hr>\n  <ol>\n    <li id="fn1">\n      <p>n<a href="#fnref1" role="doc-backlink" aria-label="Back to reference">↩</a></p>\n    </li>\n  </ol>\n</section>'
    const first = '<p>a<a id="fnref1" href="#fn1" role="doc-noteref"><sup>1</sup></a></p>\n'
    expect(render('a[^n]\n\n::: footnotes "N" [L]\n:::\n\n[^n]: n\n\n::: note "T"\n:::')).toBe(
      `${first}<section role="doc-endnotes" aria-labelledby="adm-1">\n  <p class="admonition-title" id="adm-1">N</p>\n  <p class="div-label">L</p>${notes}\n<aside class="admonition note" aria-labelledby="adm-2">\n  <p class="admonition-title" id="adm-2">T</p>\n</aside>`,
    )
    expect(render('a[^n]\n\n::: footnotes [L]\n:::\n\n[^n]: n')).toBe(`${first}<section role="doc-endnotes" aria-label="Footnotes">\n  <p class="div-label">L</p>${notes}`)
    // Another directive before it, and a footnotes directive inside a container, do not take its place.
    expect(render('::: toc "C"\n:::\n\n> ::: footnotes "Q"\n> :::\n\na[^n]\n\n::: footnotes "N"\n:::\n\n[^n]: n')).toContain('<section role="doc-endnotes" aria-labelledby="adm-1">\n  <p class="admonition-title" id="adm-1">N</p>')
    // A directive with no note to place counts no id.
    expect(render('::: footnotes "N"\n:::\n\n::: note "T"\n:::')).toContain('<p class="admonition-title" id="adm-1">T</p>')
    // Inside a container the directive places nothing, and its title takes no id.
    expect(render('a[^n]\n\n> ::: footnotes "N"\n> :::\n\n[^n]: n')).toContain('<div class="footnotes">\n    <p class="admonition-title">N</p>\n  </div>')
  })
})

describe('the URL filter', () => {
  const href = (destination: string, options?: RenderOptions): string => /href="([^"]*)"/.exec(render(documentOf(paragraph({ type: 'link', href: destination, children: [text('t')] })), options))![1]!
  const attribute = (key: string, value: string): string => {
    const html = render(documentOf({ type: 'paragraph', attrs: { keyValues: [[key, value]] }, children: [text('t')] }))
    return html.slice(2, html.indexOf('>'))
  }

  it('C2-H-159: the scheme is read after the characters of `probe_removes` are removed, without case; a destination with no scheme passes', () => {
    const blockedList = [
      'javascript:x', 'JaVaScRiPt:x', ' javascript:x', 'java\u0001script:x', 'java\tscr\nipt:x', 'java script:x', 'java script:x',
      'java　script:x', 'java﻿script:x', 'java script:x', 'java script:x', 'java script:x', 'java script:x',
      'java\u007fscript:x', 'data:x', 'vbscript:x', 'file:///x', 'ms-word:x', 'search-ms:x',
    ]
    for (const blocked of blockedList) expect([blocked, href(blocked)]).toEqual([blocked, ''])
    const passingList = [
      'https://a.b', '/a#b', '#f', 'a/javascript:x', '1javascript:x', '?q=javascript:x', 'java​script:x', 'java_script:x', ':javascript:',
      'mailto:a@b.c', 'x-javascript:y',
    ]
    for (const passing of passingList) expect([passing, href(passing)]).toEqual([passing, passing])
  })

  it('C2-H-160: a deny list fails the schemes it names and an allow list every other scheme; a failed destination is empty and reported once', () => {
    expect(href('ftp://x', { urlPolicy: { deny: ['FTP'] } })).toBe('')
    expect(href('javascript:x', { urlPolicy: { deny: ['ftp'] } })).toBe('javascript:x')
    expect(href('ftp://x', { urlPolicy: { allow: ['https'] } })).toBe('')
    expect(href('HTTPS://x', { urlPolicy: { allow: ['https'] } })).toBe('HTTPS://x')
    expect(href('a/b', { urlPolicy: { allow: [] } })).toBe('a/b')
    const output = renderWithDiagnostics('[a *b*](javascript:x){href=/y} ![alt](data:x){src=/z} <vbscript:q>')
    expect(output.html).toBe('<p><a href="">a <strong>b</strong></a> <img src="" alt="alt"> <a href="">vbscript:q</a></p>')
    expect(output.diagnostics.map((entry) => [entry.code, entry.severity, entry.path])).toEqual([
      ['destination-denied', 'error', '/children/0/children/0'], ['destination-denied', 'error', '/children/0/children/2'],
      ['destination-denied', 'error', '/children/0/children/4'],
    ])
  })

  it('C2-H-159: a URL that a social template gives is a sink', () => {
    expect(render('@a', { social: { mentionUrl: 'javascript:{name}' } })).toBe('<p><a class="mention" href=""><strong>@a</strong></a></p>')
  })

  it('C2-H-161: a name that starts with `on`, `srcdoc` and `formaction` are not written, in any case', () => {
    expect(render('{onclick=x ONLOAD=y on=z srcdoc=a FormAction=b once=c k=v}\nt')).toBe('<p k="v">t</p>')
  })

  it('C2-H-161: a value whose text before the first colon is a default-denied scheme is written empty, whatever urlPolicy holds', () => {
    expect(attribute('title', 'Shell: bash')).toBe(' title=""')
    expect(attribute('title', 'JAVA\tSCRIPT:x')).toBe(' title=""')
    expect(attribute('data-x', ' data :x')).toBe(' data-x=""')
    expect(attribute('title', 'a shell: bash')).toBe(' title="a shell: bash"')
    expect(attribute('title', 'https://x')).toBe(' title="https://x"')
    expect(attribute('title', 'no colon javascript')).toBe(' title="no colon javascript"')
    expect(render('{title="ftp:x" data-u="javascript:x"}\nt', { urlPolicy: { deny: ['ftp'] } })).toBe('<p title="ftp:x" data-u="">t</p>')
    expect(render('{title="javascript:x"}\nt', { urlPolicy: { allow: ['javascript'] } })).toBe('<p title="">t</p>')
  })

  it('C2-H-161: a list of URLs is written empty when one of its entries fails, split at its separators', () => {
    expect(attribute('srcset', 'a.png 1x, javascript:x 2x')).toBe(' srcset=""')
    expect(attribute('srcset', 'a.png 1x,data:x')).toBe(' srcset=""')
    expect(attribute('srcset', 'a.png 1x, b.png 2x')).toBe(' srcset="a.png 1x, b.png 2x"')
    expect(attribute('imagesrcset', 'a,file:x')).toBe(' imagesrcset=""')
    expect(attribute('ping', '/a\tvbscript:x')).toBe(' ping=""')
    expect(attribute('ping', '/a\rvbscript:x')).toBe(' ping=""')
    // A comma is no separator of `ping`, so the text before the first colon is not a scheme.
    expect(attribute('ping', '/a,vbscript:x')).toBe(' ping="/a,vbscript:x"')
    expect(attribute('attributionsrc', '/a /b')).toBe(' attributionsrc="/a /b"')
    // A value the renderer takes from text is not tested.
    expect(render('[t](/u "javascript: no")')).toBe('<p><a href="/u" title="javascript: no">t</a></p>')
    expect(render('x ![javascript: alt](/i)')).toBe('<p>x <img src="/i" alt="javascript: alt"></p>')
  })

  it('C2-H-162: a style that holds a pattern, after its escapes are decoded, its whitespace removed and its letters lowered, is written empty', () => {
    const blockedList = [
      'color: u\\72l(a)', 'background: URL (x)', 'x: u\\000072 l(a)', 'x: \\75 rl(a)', 'x: u\\r\\l(a)', 'width: EXPRESSION(1)', '@im\\port "x"',
      'behavior : x', '-MOZ-binding: x', 'x: u\\\nrl(a)', 'x:ur\\6c(a)', '@\\69mport "x"', '@imp\\6frt "x"', 'behavior\\3a x',
      // An escape takes at most six digits, so the `e` behind these six is a character of its own.
      'width: exp\\000072ession(1)',
    ]
    for (const blocked of blockedList) expect([blocked, attribute('style', blocked)]).toEqual([blocked, ' style=""'])
    for (const passing of ['color: red', 'COLOR: Red', 'x: curl', 'x: u\\0000720l(a)', 'x: \\110000rl(']) {
      expect([passing, attribute('style', passing)]).toEqual([passing, ` style="${passing}"`])
    }
    expect(render('{style="color: red" align=center}\nt')).toBe('<p style="color: red; text-align: center;">t</p>')
  })
})

describe('text of 24 characters or more', () => {
  const long = 'twenty-four characters. '

  it('C2-H-002: is escaped like shorter text, also where the character stands first or last', () => {
    for (const [char, entity] of [['&', '&amp;'], ['<', '&lt;'], ['>', '&gt;'], ['\u00a0', '&nbsp;']] as const) {
      expect([char, escapeText(`${char}${long}`), escapeText(`${long}${char}`), escapeText(`${long}${char}${long}`)]).toEqual([
        char, `${entity}${long}`, `${long}${entity}`, `${long}${entity}${long}`,
      ])
    }
    expect(escapeText(long)).toBe(long)
    expect(escapeText(`<${long.slice(0, 22)}`)).toBe(`&lt;${long.slice(0, 22)}`)
  })
})

describe('the profiles', () => {
  const degraded = (src: string, profile: NonNullable<RenderOptions['profile']>): string[] => renderWithDiagnostics(src, { profile }).diagnostics.map((entry) => `${entry.code}: ${entry.message}`)

  check([
    ['C2-H-163: article accepts everything but raw content', `# h\n\n| a |\n\n\`<b>\`{=html} x\n\n${FENCE}=html\n<i>\n${FENCE}`,
      '<section id="h">\n  <h1>h</h1>\n  <table>\n    <tbody>\n      <tr><td>a</td></tr>\n    </tbody>\n  </table>\n  <p>&lt;b&gt; x</p>\n  <p>&lt;i&gt;</p>\n</section>', { profile: 'article', rawHtml: true }],
    ['C2-H-163: comment accepts the listed types and writes rel on every link', `See [docs](https://x.org "t"){rel="me nofollow"} and *bold* \`c\`.\n\n> q\n\n- i\n\n${FENCE}js\nx\n${FENCE}`,
      '<p>See <a href="https://x.org" title="t" rel="me nofollow ugc">docs</a> and <strong>bold</strong> <code>c</code>.</p>\n<blockquote><p>q</p></blockquote>\n<ul>\n  <li>i</li>\n</ul>\n<pre><code class="language-js">x\n</code></pre>', { profile: 'comment' }],
    ['C2-H-163: minimal degrades a link, a quote, a heading, a code block and a rule to their text', `See [docs *x*](https://x.org).\n\n> q *r*\n\n## h\n\n${FENCE}\nc\n${FENCE}\n\n***`,
      '<p>See docs x.</p>\n<p>&gt; q r</p>\n<p>## h</p>\n<p>c</p>\n<p>---</p>', { profile: 'minimal' }],
    ['C2-H-163: a table degrades to one line per row, an image to its alt text, and a note reference to its source', '| a | b |\n| c | d |\n\n![alt](i.png) x[^n] :s: $`m`\n\n[^n]: note',
      '<p>a | b<br>\nc | d</p>\n<p>[img: alt] x[^n] :s: m</p>', { profile: 'comment' }],
    ['C2-H-163: a definition is no construct that renders, so a reference through it still resolves', '[a][r]\n\n[r]: /u\n\n%% c',
      '<p><a href="/u" rel="nofollow ugc">a</a></p>', { profile: 'comment' }],
    ['C2-H-164: a literal-text span stands where code stands', '!`a` `b`', '<p>a <code>b</code></p>', { profile: 'minimal' }],
    ['C2-H-163: a node deeper than max_nesting is outside the profile, and an item stays an item', '- a\n  - b `c`\n    - d',
      '<ul>\n  <li>a\n    <ul>\n      <li>b c - d</li>\n    </ul>\n  </li>\n</ul>', { profile: 'minimal' }],
    ['C2-H-163: the full profile accepts every type', '`<b>`{=html}', '<p><b></p>', { profile: 'full', rawHtml: true }],
  ])

  it('C2-H-129: each construct outside the profile is reported with profile-construct-degraded, on the node that stands for it', () => {
    expect(degraded('# h\n\na [b](c)', 'minimal')).toEqual([
      'profile-construct-degraded: Degraded a construct the profile "minimal" does not allow: heading',
      'profile-construct-degraded: Degraded a construct the profile "minimal" does not allow: link',
    ])
    expect(renderWithDiagnostics('a [b](c)', { profile: 'minimal' }).diagnostics[0]).toEqual({
      code: 'profile-construct-degraded', severity: 'warning', channel: 'render-loss',
      message: 'Degraded a construct the profile "minimal" does not allow: link', path: '/children/0/children/1',
    })
    expect(() => render('# h', { profile: 'minimal', strictLosses: true })).toThrow('profile-construct-degraded')
    expect(degraded('a *b*', 'minimal')).toEqual([])
  })

  it('C2-H-163: a denied reference takes no footnote number, and a note body is filtered like the document', () => {
    expect(render('a[^n]\n\n[^n]: note', { profile: 'comment' })).toBe('<p>a[^n]</p>')
    expect(render('a[^n]\n\n[^n]: x `<b>`{=html}', { profile: 'article', rawHtml: true })).toContain('<p>x &lt;b&gt;<a href="#fnref1"')
  })

  it('C2-H-163: an input longer than max_length bytes is refused before it is parsed', () => {
    expect(render('a'.repeat(10000), { profile: 'minimal' })).toHaveLength(10007)
    expect(() => render('a'.repeat(10001), { profile: 'minimal' })).toThrow(CarveInputError)
    // The bound counts UTF-8 bytes.
    expect(() => render('é'.repeat(5001), { profile: 'minimal' })).toThrow('longer than the 10000 bytes the profile minimal accepts')
    expect(render('é'.repeat(5000), { profile: 'minimal' })).toHaveLength(5007)
    expect(() => render('a'.repeat(100001), { profile: 'comment' })).toThrow(CarveInputError)
    expect(render('a'.repeat(100001), { profile: 'article' })).toHaveLength(100008)
  })

  it('C2-H-163: the body of a note is not filtered where the profile has no notes, so nothing in it is reported', () => {
    expect(degraded('a[^n]\n\n[^n]: note\n\n    # heading in the note', 'comment')).toEqual([
      'profile-construct-degraded: Degraded a construct the profile "comment" does not allow: footnote_ref',
    ])
  })

  it('C2-H-163: a supplied tree is filtered on a copy, and the tree of the caller keeps its nodes', () => {
    const document = documentOf({ type: 'heading', level: 1, children: [text('h')] })
    expect(render(document, { profile: 'minimal' })).toBe('<p># h</p>')
    expect(document.children![0]!.type).toBe('heading')
  })
})

describe('autolinks', () => {
  const isAutolink = (body: string): boolean => render(`<${body}>`).startsWith('<p><a href=')

  it('C2-I-122: the URL characters of ASCII, and outside ASCII every character that is no whitespace, control or format character', () => {
    const allowed = "-._~:/?#[]@!$&'()*+,;=%"
    for (let code = 0x20; code < 0x7f; code++) {
      const char = String.fromCharCode(code)
      // The first `>` ends the body, so it is no character of one.
      if (char === '>') continue
      const expected = /[A-Za-z0-9]/.test(char) || allowed.includes(char)
      expect([char, isAutolink(`http://a${char}b`)]).toEqual([char, expected])
    }
    expect(['http://ä.de/ü', 'http://a日b', 'http://a§b'].map(isAutolink)).toEqual([true, true, true])
    expect(['http://a b', 'http://a b', 'http://a\u0085b', 'http://a‍b', 'http://a­b', 'http://a b'].map(isAutolink)).toEqual(Array(6).fill(false))
    // The scheme holds ASCII only and starts with a letter.
    expect(['1a:x', 'äb:x', 'aä:x', ':x'].map(isAutolink)).toEqual(Array(4).fill(false))
  })

  it('C2-I-123: the local part and the domain of an email address, a dot and one or more ASCII letters', () => {
    expect(['a@b.cd', 'a+b.c_d-e@x-y.z_w.com', 'a@b.c'].map(isAutolink)).toEqual([true, true, true])
    expect(['a@b', 'a@b.c1', 'ä@b.cd', 'a@ä.cd', 'a@b.cä', '@b.cd', 'a@.cd', 'a@b.', 'a b@c.de'].map(isAutolink)).toEqual(Array(9).fill(false))
  })

  check([
    ['C2-I-124: the destination of a URL autolink is its body, and that of an email autolink is mailto: and its body',
      '<https://a.b/c?d=e#f> <a@b.cd>', '<p><a href="https://a.b/c?d=e#f">https://a.b/c?d=e#f</a> <a href="mailto:a@b.cd">a@b.cd</a></p>'],
    ['C2-I-124: a body that is no URL and no address leaves the angle brackets as text, read as inline content',
      '<http://a *b*> <a@b>', '<p>&lt;http://a <strong>b</strong>&gt; &lt;a@b&gt;</p>'],
    ['C2-I-124: an attribute block glued to the closing bracket attaches to the autolink', '<https://a.b>{.c #i}', '<p><a href="https://a.b" id="i" class="c">https://a.b</a></p>'],
  ])
})

describe('comments that tools read', () => {
  check([
    ['C2-B-215: a lint control comment is a comment like any other, on its own line or behind content', 'a %% carve-lint-disable-line x, y\n%% carve-lint-disable-next-line\nb\n\n%% carve-lint-disable\n\n%% carve-lint-enable x', '<p>a\nb</p>'],
    ['C2-B-215: text of that shape in a code span and in a code block controls nothing and stays', `\`%% carve-lint-disable\`\n\n${FENCE}\n%% carve-lint-disable\n${FENCE}`, '<p><code>%% carve-lint-disable</code></p>\n<pre><code>%% carve-lint-disable\n</code></pre>'],
    ['C2-B-217: a region marker renders nothing, with any spacing, and so does a malformed one', '%% #region intro\ntext\n  %%   #endregion   intro  \n\n%% #region-x\n\n%% #regional', '<p>text</p>'],
    ['C2-B-217: a run of three percent signs opens a comment block and is no marker', '%%% #region x\ntext\n%%%\n\nafter', '<p>after</p>'],
  ])

  it('C2-B-217: a marker is a comment node of the block it stands in', () => {
    expect(blocks('%% #region a\n\n- x\n  %% #endregion a').map((node) => node.type)).toEqual(['comment', 'list'])
    expect(block('%% #region a').value).toBe('#region a')
  })
})

describe('the start attribute of an ordered list', () => {
  const marker = (src: string): unknown => block(src).marker
  const keys = (src: string): unknown => block(src).attrs?.keyValues

  it('C2-B-045: the attribute sets the start value and is no key, so it gives the tree of a first marker with that number', () => {
    expect(block('{start=5}\n1. a\n2. b')).toEqual(block('5. a\n6. b'))
    expect(block('{start=5 .c}\n. a')).toEqual({ ...block('5. a'), attrs: { classes: ['c'] } })
    expect(marker('{start=3}\nb. x')).toEqual({ kind: 'ordered', style: 'a', delimiter: '.', start: 3 })
    expect(marker('{start="12"}\nI) x')).toEqual({ kind: 'ordered', style: 'I', delimiter: ')', start: 12 })
    // C2-A-058: a start of 1 is omitted.
    expect(marker('{start=1}\n7. a')).toEqual({ kind: 'ordered', style: '1', delimiter: '.' })
    expect(marker('{start=0}\n1. a')).toEqual({ kind: 'ordered', style: '1', delimiter: '.', start: 0 })
  })

  it('C2-B-045: where both are written the attribute decides', () => {
    expect(marker('{start=5}\n3. a')).toEqual({ kind: 'ordered', style: '1', delimiter: '.', start: 5 })
    expect(render('{start=5}\n3. a')).toBe('<ol start="5">\n  <li>a</li>\n</ol>')
  })

  it('C2-B-045: a value that is no unsigned decimal integer, and 0 on letters or roman numerals, is no start value and stays a key', () => {
    for (const value of ['x', '-1', '+2', '1.5', '', '1234567890']) {
      expect([value, marker(`{start="${value}"}\n3. a`), keys(`{start="${value}"}\n3. a`)]).toEqual([value, { kind: 'ordered', style: '1', delimiter: '.', start: 3 }, [['start', value]]])
    }
    expect([marker('{start=0}\nb. x'), keys('{start=0}\nb. x')]).toEqual([{ kind: 'ordered', style: 'a', delimiter: '.', start: 2 }, [['start', '0']]])
    expect(keys('{start=0}\nii. x')).toEqual([['start', '0']])
    // On a bullet list the key is an ordinary key.
    expect(keys('{start=5}\n- a')).toEqual([['start', '5']])
  })
})

describe('the byte-order mark', () => {
  check([
    ['C2-B-165: a byte-order mark at the start of the source is skipped before line 1 is read, whatever line 1 holds', '﻿# T', '<section id="T">\n  <h1>T</h1>\n</section>'],
    ['C2-B-165: the line behind the mark is read at column 0', '﻿  - a\n    b', '<ul>\n  <li>a\nb</li>\n</ul>'],
    ['C2-B-165: only the first mark is skipped, and one on a later line is content', '﻿﻿a\n\n﻿# b', '<p>﻿a</p>\n<p>﻿# b</p>'],
    ['C2-B-165: a source that holds only the mark is empty', '﻿', ''],
    ['C2-B-165: frontmatter still opens behind the mark', '﻿---\na: b\n---\nx', '<p>x</p>'],
  ])

  it('C2-A-141: offsets count the bytes of the mark, and the mark is no content of a node', () => {
    const document = parse('﻿# T\n\nx')
    const heading = document.children![0]!
    expect(document.srcByteLength).toBe(9)
    expect([heading.pos!.startOffset, heading.pos!.endOffset, heading.pos!.startLine]).toEqual([3, 6, 1])
    expect(heading.children).toEqual([{ type: 'text', value: 'T', pos: { startLine: 1, endLine: 1, startColumn: 4, endColumn: 5, startOffset: 5, endOffset: 6 } }])
    expect(document.children![1]!.pos!.startOffset).toBe(8)
  })
})

describe('the position of a diagnostic', () => {
  it('C2-A-173: an entry of a parse has the path of its node and its range in bytes', () => {
    const { diagnostics } = parseWithDiagnostics('{#a}\né\n\n> {#a}\n> y\n\n[l]: /a\n[l]: /b')
    expect(diagnostics).toEqual([
      {
        code: 'duplicate-link-reference-definition', severity: 'warning', channel: 'parse', message: 'l is defined more than once',
        path: '/children/3', range: { startOffset: 29, endOffset: 36 },
      },
      {
        code: 'duplicate-id', severity: 'warning', channel: 'parse', message: 'the id a is used more than once',
        path: '/children/1/children/0', range: { startOffset: 11, endOffset: 19 },
      },
    ])
  })

  it('C2-A-173: without positions an entry has the path alone, and a render loss points at the node that lost', () => {
    expect(parseWithDiagnostics('{#a}\nx\n\n{#a}\ny', { positions: false }).diagnostics.map((entry) => [entry.path, entry.range])).toEqual([['/children/1', undefined]])
    const output = renderWithDiagnostics('a\n\n> {{ x.crv }}\n\n::: note "t `r`{=tex}"\n:::\n\n| `c`{=tex} |\n^ `q`{=tex}')
    expect(output.diagnostics.map((entry) => [entry.code, entry.path])).toEqual([
      ['include-unresolved', '/children/1/children/0'], ['raw-format-dropped', '/children/2/title/1'],
      ['raw-format-dropped', '/children/3/caption/children/0/children/0'],
      ['raw-format-dropped', '/children/3/children/0/children/0/children/0/children/0/children/0'],
    ])
    const lines = renderWithDiagnostics('a\n\n{{ x.crv }}', { sourceLines: true }).diagnostics
    expect(lines.map((entry) => [entry.path, entry.range])).toEqual([['/children/1', { startOffset: 3, endOffset: 14 }]])
  })

  it('C2-A-173: a finding on a supplied tree has the path alone, also where its node is a copy the renderer made', () => {
    const span: AstNode = { type: 'span', attrs: { keyValues: [['kbd', ''], ['data-carve-ref', 'x']] }, children: [text('k')] }
    const ruby: AstNode = { type: 'ruby', pairs: [{ type: 'rubyPair', base: [{ type: 'raw_inline', format: 'tex', value: 'x' }], annotation: [text('a')] }] }
    const output = renderWithDiagnostics(documentOf(paragraph(span, ruby)), { roundtrip: true })
    expect(output.diagnostics.map((entry) => [entry.code, entry.path, entry.range])).toEqual([
      ['carrier-attribute-dropped', '/children/0/children/0', undefined], ['raw-format-dropped', '/children/0/children/1/pairs/0/base/0', undefined],
    ])
  })
})

describe('a loss that is thrown', () => {
  it('C2-A-173, C2-H-130: carries the position of its node', () => {
    let thrown: unknown = null
    try {
      render('a\n\n{{ x.crv }}', { strictLosses: true })
    } catch (error) {
      thrown = error
    }
    expect(thrown).toBeInstanceOf(CarveRenderError)
    expect((thrown as CarveRenderError).diagnostics.map((entry) => [entry.code, entry.path])).toEqual([['include-unresolved', '/children/1']])
    expect(renderWithDiagnostics('{{ x.crv }}', { strictLosses: true }).html).toBe('')
  })
})

describe('a finding on a node that is not in the tree', () => {
  it('C2-A-173: points at the document', () => {
    const document = documentOf(paragraph('a'))
    const stray = text('b')
    const entry: Diagnostic = { code: 'x', severity: 'warning', channel: 'lint', message: 'm' }
    expect(locateFindings(document, { entries: [entry], nodes: [stray] })).toEqual([{ ...entry, path: '' }])
    expect(locateFindings(document, { entries: [{ ...entry }], nodes: [null] })).toEqual([{ ...entry, path: '' }])
  })
})

describe('resolution of the restated rules', () => {
  it('C2-H-156: the label ids are a result of resolution, beside the tree', () => {
    const { document, resolution } = resolved('::: note "a"\n:::')
    expect(resolution.labelIds.get(document.children![0]!)).toBe('adm-1')
    expect(JSON.stringify(document)).not.toContain('adm-1')
  })
})
