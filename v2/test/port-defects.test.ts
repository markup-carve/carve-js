import { describe, expect, it } from 'vitest'
import { AST_VERSION, type DocumentNode, parse, parseTree, parseWithDiagnostics, render, renderTree, resolveTree } from '../src/index.ts'

const FENCE = '```'

const types = (src: string): string[] => parse(src).children.map((node) => node.type)
const first = (src: string): Record<string, unknown> => {
  const { pos: _pos, ...rest } = parse(src).children[0] as unknown as Record<string, unknown>
  return rest
}
const findings = (src: string): string[] => parseWithDiagnostics(src).diagnostics.map((finding) => finding.code)

describe('C2-B-166/167: a trailing line comment on a row', () => {
  it('C2-B-166: a commented row stays a row when a later line holds a pipe', () => {
    expect(types('| a | b | %% note\n| c | d |\n')).toEqual(['table'])
    expect(render('| a | b | %% note\n| c | d |\n')).toContain('<tr><td>a</td><td>b</td></tr>')
    expect(types('| a | b | %% note\n\nx|\n')).toEqual(['table', 'paragraph'])
    expect(types('|a| %%\n|\n')).toEqual(['table', 'paragraph'])
    expect(types('> | a | %% n\n> | b |\n')).toEqual(['block_quote'])
    expect(render('> | a | %% n\n> | b |\n')).toContain('<tr><td>a</td></tr>\n      <tr><td>b</td></tr>')
  })
})

describe('C2-B-117/119: an opener word is the longest run of its characters', () => {
  it('C2-B-119: a div name ends at the first character outside `div_name`', () => {
    for (const glued of ['>', '\\', '{', '|n', ')te', '"t"', '[l]', '.x', '#i', '�']) {
      expect(first(`::: glossary${glued}\nq\n:::\n`)).toMatchObject({ type: 'directive', kind: 'glossary' })
      expect(first(`::: box${glued}\nq\n:::\n`)).toMatchObject({ type: 'div', attrs: { classes: ['box'] } })
      expect(findings(`::: box${glued}\nq\n:::\n`)).toContain('fence-title-syntax')
    }
    expect(first('::: a-b_C9\nq\n:::\n')).toMatchObject({ type: 'div', attrs: { classes: ['a-b_C9'] } })
  })

  it('C2-B-105: an attribute block glued to an admonition name does not stop the admonition', () => {
    expect(first('::: note{start=9}\ntext\n:::\n')).toMatchObject({ type: 'admonition', kind: 'note' })
    expect(first('::: note{start=9}\ntext\n:::\n')).not.toHaveProperty('attrs')
    expect(first('::: note {start=9}\ntext\n:::\n')).toMatchObject({ type: 'admonition', kind: 'note' })
    expect(findings('::: note{start=9}\ntext\n:::\n')).toEqual(['fence-opener-fallback'])
    expect(findings('::: tip {.x}\ntext\n:::\n')).toEqual(['fence-opener-fallback'])
    expect(first('::: toc{x}\n:::\n')).toMatchObject({ type: 'directive', kind: 'toc' })
  })

  it('C2-B-119/196: a character that is no name and no lone sigil gives no name', () => {
    for (const word of ['>a', '|n', '\\x', '{', '{.x}', ')']) {
      const div = first(`::: ${word}\nq\n:::\n`)
      expect(div).toMatchObject({ type: 'div' })
      expect(div).not.toHaveProperty('attrs')
    }
    expect(first('::: >\nq\n:::\n')).toMatchObject({ type: 'block_quote' })
    expect(first('::: |\nq\n:::\n')).toMatchObject({ type: 'line_block' })
  })

  it('C2-B-117: a fence language ends at the first character outside `language_word`', () => {
    const cases: [string, string | undefined][] = [
      ['js}', 'js'], ['c}', 'c'], ['{}', undefined], ['py{.x}', 'py'], ['�', undefined], ['a:b', 'a'], ['c++', 'c++'],
      ['objective-c', 'objective-c'], ['x/y.z#1_A', 'x/y.z#1_A'], ['js"t"', 'js'], ['js[l]', 'js'], ['r,s', 'r'],
    ]
    for (const [info, syntax] of cases) {
      const code = first(`${FENCE}${info}\ncode\n${FENCE}\n`)
      expect(code.type).toBe('code_block')
      expect(code.syntax).toBe(syntax)
      expect(code).not.toHaveProperty('title')
    }
    expect(findings(`${FENCE}py{.x}\ncode\n${FENCE}\n`)).toEqual(['fence-opener-fallback'])
    expect(findings(`${FENCE}js}\ncode\n${FENCE}\n`)).toEqual(['fence-title-syntax'])
  })

  it('C2-B-116: a raw format ends where the name ends, after no space or one', () => {
    expect(first(`${FENCE}=html\nx\n${FENCE}\n`)).toEqual({ type: 'raw_block', format: 'html', value: 'x\n' })
    expect(first(`${FENCE} =html\nx\n${FENCE}\n`)).toEqual({ type: 'raw_block', format: 'html', value: 'x\n' })
    expect(first(`${FENCE}=html}\nx\n${FENCE}\n`)).toEqual({ type: 'raw_block', format: 'html', value: 'x\n' })
    expect(first(`${FENCE}=x-y_1\nx\n${FENCE}\n`)).toMatchObject({ type: 'raw_block', format: 'x-y_1' })
    expect(first(`${FENCE}  =html\nx\n${FENCE}\n`)).toEqual({ type: 'code_block', value: 'x\n' })
    expect(first(`${FENCE}=1\nx\n${FENCE}\n`)).toEqual({ type: 'code_block', value: 'x\n' })
  })

  it('C2-B-180: a delimited table reads the language as the fence does', () => {
    expect(first(`{table}\n${FENCE} csv\na,b\n${FENCE}\n`)).toMatchObject({ type: 'table' })
    expect(first(`{table}\n${FENCE}tsv}\na\tb\n${FENCE}\n`)).toMatchObject({ type: 'table', columns: [{}, {}] })
    expect(first(`{table}\n${FENCE}  csv\na,b\n${FENCE}\n`)).toMatchObject({ type: 'code_block' })
  })

  it('C2-B-117: at most one space stands before the info string of a fence', () => {
    for (const info of ['  b', '   b', '\tb', ' \tb', '  "t"', '  [l]', '  =html']) {
      expect(first(`${FENCE}${info}\nx\n${FENCE}\n`)).toEqual({ type: 'code_block', value: 'x\n' })
    }
    expect(render(`${FENCE}  b\nx\n${FENCE}\n`)).toBe('<pre><code>x\n</code></pre>')
    expect(first(`${FENCE} b\nx\n${FENCE}\n`)).toMatchObject({ syntax: 'b' })
    expect(first(`${FENCE} "t"\nx\n${FENCE}\n`)).toMatchObject({ title: [{ type: 'text', value: 't' }] })
    expect(first(`${FENCE} [l]\nx\n${FENCE}\n`)).toMatchObject({ groupLabel: 'l' })
    expect(findings(`${FENCE}  b\nx\n${FENCE}\n`)).toEqual(['fence-title-syntax'])
  })

  it('C2-B-119: spaces separate the parts, so a part glued to the one before is further words', () => {
    expect(first(`${FENCE} js "t"[l]\nx\n${FENCE}\n`)).toMatchObject({ syntax: 'js', title: [{ value: 't' }] })
    expect(first(`${FENCE} js "t"[l]\nx\n${FENCE}\n`)).not.toHaveProperty('groupLabel')
    expect(first('::: box"t"\nq\n:::\n')).not.toHaveProperty('title')
    expect(first('::: box "t" [l]\nq\n:::\n')).toMatchObject({ title: [{ value: 't' }], groupLabel: 'l' })
  })
})

describe('C2-I-098: abbreviations in every inline flow', () => {
  const abbr = '<abbr title="Hyper">HT</abbr>'

  it('C2-I-098: a table cell is inline flow', () => {
    const html = render('|= HT | b |\n| x HT y | *HT* |\n\n*[HT]: Hyper\n')
    expect(html).toContain(`<th scope="row">${abbr}</th>`)
    expect(html).toContain(`<td>x ${abbr} y</td><td><strong>${abbr}</strong></td>`)
    expect(render('| HT |\n+ HT |\n\n*[HT]: Hyper\n')).toContain(`<td>${abbr} ${abbr}</td>`)
    expect(render('| HT |\n^ HT\n\n*[HT]: Hyper\n')).toContain(`<caption>${abbr}</caption>`)
  })

  it('C2-I-098: the title of a div, an admonition and a directive is inline flow', () => {
    expect(render('::: note "HT x"\nq\n:::\n\n*[HT]: Hyper\n')).toContain(`id="adm-1">${abbr} x</p>`)
    expect(render('::: box "HT"\nq\n:::\n\n*[HT]: Hyper\n')).toContain(abbr)
  })
})

describe('C2-I-034/040: an invalid or empty brace block in a block prefix is text', () => {
  const INVALID = ['{2}', '{ }', '{.}', '{0}', '{x<}', '{k<}', '{#/$x}', '{*}', '{##}', '{=/}', '{.a}{x<}', '{x<}{.a}', '{-i}', '{.i#}', '{+}']

  it('C2-B-171: the braces stay cell text, after the pipe and after the header mark', () => {
    for (const block of INVALID) {
      expect(render(`|${block} 1 |\n`)).toContain(`<tr><td>${block.replaceAll('<', '&lt;')} 1</td></tr>`)
      expect(render(`|=${block} 1 |\n`)).toContain(`<th scope="col">${block.replaceAll('<', '&lt;')} 1</th>`)
    }
    expect(render('|{ }| b |\n')).toContain('<tr><td>{ }</td><td>b</td></tr>')
    expect(render('|{=/}{|\n')).toContain('<td>{=/}{</td>')
    expect(render('|{##}\\-\\+ |\n')).toContain('<td>{##}-+</td>')
  })

  it('C2-B-182: a valid cell prefix and a prefix of the alignment mark alone still apply', () => {
    expect(render('|{<} 1 |\n')).toContain('<td style="text-align: left;">1</td>')
    expect(render('|={> .c} 1 |\n')).toContain('<th scope="col" class="c" style="text-align: right;">1</th>')
    expect(render('|{.a}{#i} 1 |\n')).toContain('<td id="i" class="a">1</td>')
  })

  it('C2-B-034/101: a bullet or ordered marker with an invalid block is no marker', () => {
    for (const block of INVALID) {
      for (const marker of ['-', '*', '1.', '1)', 'a)', '.']) {
        expect(types(`${marker}${block} b\n`)).toEqual(['paragraph'])
      }
    }
    expect(render('-{blank.i} b\n')).toBe('<p>-{blank.i} b</p>')
    expect(parse('-{.i} b\n').children[0]).toMatchObject({ type: 'list', children: [{ attrs: { classes: ['i'] } }] })
    expect(parse('1.{#x} b\n').children[0]).toMatchObject({ type: 'list', children: [{ attrs: { id: 'x' } }] })
  })

  it('C2-B-167: an invalid block glued behind the row attribute ends no row', () => {
    expect(types('| a |{.r}{x<}\n')).toEqual(['paragraph'])
    expect(types('| a |{.r}{#i}\n')).toEqual(['table'])
  })

  it('C2-B-197/198: a block image or display math line takes only valid glued blocks', () => {
    expect(types('![a](u){x<}\n^ c\n')).toEqual(['paragraph'])
    expect(types('![a](u){.x}\n^ c\n')).toEqual(['figure'])
    expect(types('$$`m`{x<}\n^ c\n')).toEqual(['paragraph'])
    expect(types('$$`m`{.x}\n^ c\n')).toEqual(['figure'])
  })
})

describe('C2-H-145: every reversed glyph is written as its source in a slug', () => {
  const id = (src: string): unknown => (parse(src).children[0] as unknown as Record<string, unknown>).generatedId

  it('C2-H-145: both guillemets, in any position', () => {
    expect(id('# x→y «q»\n')).toBe('x-y-q')
    expect(id('# «q» a\n')).toBe('q-a')
    expect(id('# a »q« b\n')).toBe('a-q-b')
    expect(id('# a ± b\n')).toBe('a-b')
    expect(id('# a­b\n')).toBe('ab')
  })
})

describe('C2-I-002: spaces and tabs at the end of every line of a content are not part of it', () => {
  const nodes = (src: string): unknown[] => {
    const strip = (value: unknown): unknown => JSON.parse(JSON.stringify(value, (key, inner: unknown) => (key === 'pos' ? undefined : inner)))
    return strip((parse(src).children[0] as unknown as { children: unknown[] }).children) as unknown[]
  }

  it('C2-I-002: a verbatim value loses the spaces before an inner line end', () => {
    expect(nodes('`a  \n  b` x\n')[0]).toEqual({ type: 'code', value: 'a\nb' })
    expect(nodes('`a \t\nb`\n')[0]).toEqual({ type: 'code', value: 'a\nb' })
    expect(nodes('{# \n#}\n')[0]).toEqual({ type: 'critic_comment', value: '\n' })
    expect(nodes('$`a \nb`\n')[0]).toEqual({ type: 'math', display: false, value: 'a\nb' })
    expect(nodes('$$`a \nb`\n')[0]).toEqual({ type: 'math', display: true, value: 'a\nb' })
    expect(nodes('!`a \nb`\n')[0]).toEqual({ type: 'literal_inline', value: 'a\nb' })
    expect(nodes('![a \nb](u)\n')[0]).toEqual({ type: 'image', src: 'u', alt: 'a\nb' })
    expect(nodes('a {% x \ny %} b\n')[1]).toEqual({ type: 'comment', form: 'braced', value: 'x\ny' })
    expect(nodes('a %% x  \nb\n')[1]).toEqual({ type: 'comment', form: 'line', value: 'x' })
  })

  it('C2-I-011: an escaped space at the end of a line stays, on every line', () => {
    expect(nodes('a\\ \nb\n')).toEqual([
      { type: 'text', value: 'a' }, { type: 'non_breaking_space' }, { type: 'soft_break' }, { type: 'text', value: 'b' },
    ])
    expect(nodes('a\\  \nb\n')[1]).toEqual({ type: 'non_breaking_space' })
    expect(nodes('a\\\\ \nb\n')).toEqual([{ type: 'text', value: 'a\\' }, { type: 'soft_break' }, { type: 'text', value: 'b' }])
  })

  it('C2-I-102: a backslash before trailing tabs ends the line, on every line', () => {
    expect(nodes('Qz a\\\t\nb\n')).toEqual([{ type: 'text', value: 'Qz a' }, { type: 'hard_break' }, { type: 'text', value: 'b' }])
    expect(nodes('Qz a\\\t \t\nb\n')[1]).toEqual({ type: 'hard_break' })
    expect(nodes('Qz a\\\t\n')).toEqual([{ type: 'text', value: 'Qz a' }, { type: 'hard_break' }])
    expect(nodes('- a\\\t\n  b\n')).toEqual([expect.objectContaining({ type: 'list_item' })])
    expect(render('- a\\\t\n  b\n')).toContain('a<br>\n')
  })
})

describe('C2-I-111: a hyphen run is decided as a whole', () => {
  const dashes = (length: number): string => {
    const html = render(`a ${'-'.repeat(length)} b`)
    return html.slice(html.indexOf('a ') + 2, html.lastIndexOf(' b'))
  }
  const expected = (length: number): string => {
    if (length % 3 === 0) return '—'.repeat(length / 3)
    if (length % 2 === 0) return '–'.repeat(length / 2)
    return `—${expected(length - 3)}`
  }

  it('C2-I-111: runs of 2 to 40 hyphens', () => {
    for (let length = 2; length <= 40; length++) expect(dashes(length), `run of ${length}`).toBe(expected(length))
    expect(dashes(8)).toBe('––––')
    expect(dashes(10)).toBe('–––––')
    expect(dashes(11)).toBe('—––––')
    expect(dashes(14)).toBe('–––––––')
    expect(dashes(16)).toBe('––––––––')
  })
})

describe('C2-B-017/197: only a block image line takes a caption below a paragraph', () => {
  it('C2-B-197: a tail the inline pass rejects makes no block image line, so the caption is a lazy line', () => {
    for (const line of ['![]( )', '![alt](  *****a.png)', '![alt](a b)', '![a](u  "t")', '![a](u "t)', '![a](u(x)', '![a](u\tv)']) {
      expect(types(`${line}\n^ C\n`), line).toEqual(['paragraph'])
    }
  })

  it('C2-B-197: every tail of the inline form still makes one', () => {
    for (const line of ['![a](u)', '![a]()', '![a](u "t")', "![a](u 't')", '![a](u "t"  )', '![a](u(x))', '![a](u\\))', '![a](u){.c}']) {
      expect(types(`${line}\n^ C\n`), line).toEqual(['figure'])
    }
    expect(types('![a][l]\n^ C\n\n[l]: u\n')).toEqual(['figure', 'link_reference_definition'])
  })
})

describe('C2-I-014/119: a failed opener in a cell is the whole run', () => {
  const cell = (content: string): string => {
    const html = render(`| ${content} | b |\n`)
    return html.slice(html.indexOf('<td>') + 4, html.indexOf('</td>'))
  }

  it('C2-B-223: an unclosed run of two does not restart at its second backtick', () => {
    expect(cell('a ``x`y')).toBe('a ``x`y')
    expect(cell('a !``x`y')).toBe('a !``x`y')
    expect(cell('a $``x`y')).toBe('a $``x`y')
    expect(cell('a $$``x`y')).toBe('a $$``x`y')
    expect(cell('a ```x``y`')).toBe('a ```x``y`')
    expect(cell('``x`y`` z')).toBe('<code>x`y</code> z')
    expect(cell('a `x')).toBe('a `x')
  })
})

describe('C2-I-025/060: a later unclosed braced opener does not reach back', () => {
  const kinds = (src: string): string[] => (parse(src).children[0] as unknown as { children: { type: string }[] }).children
    .map((node) => node.type)

  it('C2-I-025: a closed braced comment before an unclosed one forms, after any delimiter', () => {
    for (const before of ['Q*', '*', 'Qz /', 'Q`!`/', 'Q_', 'Q~', 'Q^', 'Q=', 'Q+', 'Q-']) {
      expect(kinds(`${before}{%%}{%\n`), before).toContain('comment')
    }
    expect(kinds('Q*{#x#}{#\n')).toContain('critic_comment')
    expect(kinds('Q*{%a%} b {%\n')).toContain('comment')
  })

  it('C2-I-106: the quote look-ahead skips a closed comment whatever follows', () => {
    for (const tail of ['{%', '{', '{% %}', '']) {
      expect(render(`-'{%%}:${tail}\n`), tail).toContain('’')
      expect(render(`-"{%%}:${tail}\n`), tail).toContain('”')
    }
  })

  it('C2-I-076: a later unclosed label does not stop an earlier footnote reference', () => {
    expect(render('*[^a] [^\n\n[^a]: n\n')).toContain('role="doc-noteref"')
  })
})

describe('C2-H-016: the paragraph of an unexpanded include carries its source line', () => {
  it('C2-H-016/133: at the top level and inside a container', () => {
    const html = render('para\n\n{{ x.crv }}\n\n# h\n', { sourceLines: true })
    expect(html).toContain('<p data-source-line="3">{{ x.crv }}</p>')
    expect(render('- a\n\n  {{ x.crv }}\n', { sourceLines: true })).toContain('<p data-source-line="3">{{ x.crv }}</p>')
    expect(render('> {{ x.crv }}\n', { sourceLines: true })).toContain('<p data-source-line="1">{{ x.crv }}</p>')
    expect(render('{{ x.crv }}\n')).toBe('<p>{{ x.crv }}</p>')
  })
})

describe('C2-B-218: an unpaired surrogate is read as U+FFFD in every value', () => {
  const json = (src: string): string => JSON.stringify(parse(src))

  it('C2-B-218: in text, code, math, attributes, a heading id and a destination', () => {
    for (const src of ['a\ud800b', '`x\udc00`', '$`\ud800`', '{k="\udc00"}\npara', '# \udc00h', '[a](u\ud800)', 'a\udc00\ud800b']) {
      const tree = json(src)
      expect(tree, JSON.stringify(src)).not.toMatch(/\\ud[89a-f][0-9a-f]{2}/u)
      expect(tree).toContain('�')
    }
    expect(json('😀')).toContain('😀')
  })

  it('C2-B-218: it counts three bytes, so the offsets stay those of the source', () => {
    expect(parse('a\ud800b').children[0]!.pos).toMatchObject({ startOffset: 0, endOffset: 5 })
    expect(parse('\ud800\n\nb').children[1]!.pos).toMatchObject({ startOffset: 5, startLine: 3 })
  })
})

describe('C2-B-133/167: a trailing line comment of a row stands after whitespace', () => {
  it('C2-B-133: `%%` glued to the closing pipe or to the row attribute is text, so the line is no row', () => {
    for (const line of ['||%%', '| a |%%', '| a |%% x', '| a |{.r}%% c', '| a | {.r}%% c']) {
      expect(types(`${line}\n`), line).toEqual(['paragraph'])
    }
    for (const line of ['| a | %% c', '| a |\t%% c', '| a |{.r} %% c', '| a | {.r}  %% c', '|| %%']) {
      expect(types(`${line}\n`), line).toEqual(['table'])
    }
  })
})

describe('C2-I-032: an unquoted value may hold an opening brace in every block brace block', () => {
  it('C2-I-032: on an attribute line, after a marker, in a cell prefix, behind a row and a block image', () => {
    expect(parse('{s={}\nx\n').children[0]).toMatchObject({ type: 'paragraph', attrs: { keyValues: [['s', '{']] } })
    expect(parse('{s=a{b c=d}\nx\n').children[0]).toMatchObject({ attrs: { keyValues: [['s', 'a{b'], ['c', 'd']] } })
    expect(parse('-{s={} x\n').children[0]).toMatchObject({ type: 'list', children: [{ attrs: { keyValues: [['s', '{']] } }] })
    expect(render('|{s={} a |\n')).toContain('<td s="{">a</td>')
    expect(render('| a |{s={}\n')).toContain('<tr s="{">')
    expect(types('![a](u){s={}\n^ c\n')).toEqual(['figure'])
  })

  it('C2-I-029/034: a brace inside a part that is no value still makes no block', () => {
    expect(types('{.a{.b}\nx\n')).toEqual(['paragraph'])
    expect(types('{#a{b}\nx\n')).toEqual(['paragraph'])
    expect(types('{a{=b}\nx\n')).toEqual(['paragraph'])
  })
})

describe('C2-H-069: a comment-only line is a line of the leaf, not of an inline node', () => {
  it('C2-H-069: the opener or the closer of a span on the line keeps its line break', () => {
    expect(render('{* %%\n*}\n')).toBe('<p><strong>\n</strong></p>')
    expect(render('{={%%}\n=}\n')).toBe('<p><mark>\n</mark></p>')
    expect(render('{* a\n{%%}*}\n')).toBe('<p><strong> a\n</strong></p>')
    expect(render('[ %%\nx](u)\n')).toContain('<a href="u">\nx</a>')
  })

  it('C2-H-069: a comment-only line inside a span still takes one break', () => {
    expect(render('{* a\n%%\n*}\n')).toBe('<p><strong> a\n</strong></p>')
    expect(render('*a\n%% c\nb*\n')).toBe('<p><strong>a\nb</strong></p>')
    expect(render('a\n%% c\nb\n')).toBe('<p>a\nb</p>')
    expect(render('a\n%% c\n')).toBe('<p>a</p>')
  })
})

describe('C2-H-064: every panel of a figure group has a panel figure', () => {
  it('C2-A-084, C2-H-064: a table panel, captioned or not, is wrapped; its caption and attributes stay on the table', () => {
    const html = render(':::: figure\n![a](a.png)\n^ First\n\n{.t}\n| t |\n^ Second\n::::\n^ Group #: G\n')
    expect(html).toContain('  <figure class="carve-figure-panel">\n    <table class="t">\n      <caption>Second</caption>')
    expect(html).toContain('</table>\n  </figure>\n  <figcaption>Group 1: G</figcaption>')
    expect(render(':::: figure\n| t |\n\n| u |\n::::\n')).toContain('<figure class="carve-figure-panel">\n    <table>')
    expect(render(':::: figure\n| t |\n::::\n', { sourceLines: true })).toContain('<figure class="carve-figure-panel" data-source-line="2">')
    expect(render('| t |\n^ Alone\n')).toMatch(/^<table>/)
  })
})

describe('C2-A-138: the text beside a caption number keeps its position', () => {
  type Caption = { caption: { children: { children: Record<string, unknown>[] }[] } }
  const captionText = (src: string, options?: { positions: boolean }): Record<string, unknown>[] =>
    (parseTree(src, options).document.children[0] as unknown as Caption).caption.children[0]!.children

  it('C2-A-138/158: below a table, an image, code, a quote fence and a group', () => {
    const sources = [
      '| a |\n^ Table #: one\n', '![i](a.png)\n^ Figure #: one\n', '```\nx\n```\n^ Listing #: one\n', '::: >\nq\n:::\n^ Quote #: one\n',
      ':::: figure\n![i](a.png)\n::::\n^ Group #: one\n',
    ]
    for (const src of sources) {
      const [before, mark, after] = captionText(src)
      const line = src.split('\n').findIndex((text) => text.startsWith('^ ')) + 1
      expect(mark).toEqual({ type: 'caption_number' })
      expect(before!.pos, src).toMatchObject({ startLine: line, startColumn: 3 })
      expect(after!.pos, src).toMatchObject({ startLine: line, endColumn: (before!.value as string).length + 3 + 6 })
    }
  })

  it('C2-A-138: an escape before the mark still gives the source slice', () => {
    const [before, , after] = captionText('| a |\n^ Fig\\. #: c\n')
    expect(before).toMatchObject({ value: 'Fig. ', pos: { startOffset: 8, endOffset: 14 } })
    expect(after).toMatchObject({ value: ': c', pos: { startOffset: 15, endOffset: 18 } })
    expect(captionText('| a |\n^ Table #: one\n', { positions: false }).every((node) => node.pos === undefined)).toBe(true)
  })
})

describe('C2-A-213: a supplied shortcut reference with no definition stays unresolved', () => {
  const linkTo = (refForm: 'shortcut' | 'collapsed' | 'full'): DocumentNode => ({
    type: 'document', astVersion: AST_VERSION, children: [
      { type: 'heading', level: 1, children: [{ type: 'text', value: 'H' }] },
      { type: 'paragraph', children: [{ type: 'link', refForm, key: 'H', namespace: 'link', children: [{ type: 'text', value: 'H' }] }] },
    ],
  })

  it('C2-A-109/213: the heading lookup is for the full and the collapsed form only', () => {
    expect(renderTree(resolveTree(linkTo('shortcut')))).toContain('<p>[H]</p>')
    expect(renderTree(resolveTree(linkTo('collapsed')))).toContain('<a href="#H">H</a>')
    expect(renderTree(resolveTree(linkTo('full')))).toContain('<a href="#H">H</a>')
  })
})

describe('C2-I-118: an image and a link meet the depth cap alike', () => {
  const leaf = (depth: number, content: string): unknown[] => {
    let node = parse(`${'> '.repeat(depth)}${content}`) as unknown as { children: { type: string }[] }
    while (node.children[0]!.type !== 'paragraph') node = node.children[0] as unknown as typeof node
    return (node.children[0] as unknown as { children: { type: string }[] }).children.map((child) => child.type)
  }

  it('C2-I-118: an open delimiter entry counts for both bracket constructs', () => {
    expect(leaf(197, '- *![x](u)')).toEqual(leaf(197, '- *[x](u)'))
    expect(leaf(197, '- *![x](u)')).toEqual(['text'])
    expect(leaf(197, '- *a* ![x](u)')).toEqual(['strong', 'text', 'image'])
    expect(leaf(197, '- *a* [x](u)')).toEqual(['strong', 'text', 'link'])
    expect(leaf(197, '- ![x](u)')).toEqual(['image'])
    expect(leaf(197, '- [x](u)')).toEqual(['link'])
    expect(leaf(198, '- ![x](u)')).toEqual(['text'])
    expect(leaf(196, '- *![x](u)')).toEqual(['text', 'image'])
  })
})

describe('C2-H-165: a degraded inline node with no children is written as its source text', () => {
  it('C2-H-165: math, an autolink, raw content, code and a literal span keep their marks', () => {
    expect(render('a $`m` b <https://a.b> c {#cc#}', { profile: 'minimal' })).toBe('<p>a $`m` b &lt;https://a.b&gt; c </p>')
    expect(render('$$`m`', { profile: 'minimal' })).toBe('<p>$$`m`</p>')
    expect(render('a <x@y.z>', { profile: 'minimal' })).toBe('<p>a &lt;x@y.z&gt;</p>')
    expect(render('`<b>`{=html}', { profile: 'article' })).toBe('<p>`&lt;b&gt;`{=html}</p>')
    expect(render('a $``b`c`` d', { profile: 'minimal' })).toBe('<p>a $``b`c`` d</p>')
    expect(render('a $```` `b ```` d', { profile: 'minimal' })).toBe('<p>a $`` `b `` d</p>')
  })

  it('C2-H-165: a comment and an editorial comment give no text', () => {
    expect(render('a {#c#} b', { profile: 'minimal' })).toBe('<p>a  b</p>')
    expect(render('{#c#}', { profile: 'minimal' })).toBe('')
  })
})

describe('C2-H-121: the profile changes no tree', () => {
  const SRC = 'See [docs](https://x.org) and *bold*.'

  it('C2-H-121, C2-A-040: resolveTree under a profile keeps the link', () => {
    const resolved = resolveTree(parseTree(SRC), { profile: 'minimal' }).document
    const paragraph = resolved.children[0]
    if (paragraph?.type !== 'paragraph') throw new Error('no paragraph')
    expect(paragraph.children.map((node) => node.type)).toEqual(['text', 'link', 'text', 'strong', 'text'])
    expect(renderTree(resolveTree(parseTree(SRC), { profile: 'minimal' }))).toBe('<p>See docs and <strong>bold</strong>.</p>')
  })

  it('C2-H-121: a render under a profile leaves the resolved tree as it was, and renders again alike', () => {
    const resolved = resolveTree(parseTree(`# h\n\n${SRC}\n\n> q`), { profile: 'minimal' })
    const before = JSON.stringify(resolved.document)
    const html = renderTree(resolved)
    expect(JSON.stringify(resolved.document)).toBe(before)
    expect(renderTree(resolved)).toBe(html)
  })

  it('C2-H-121, C2-H-143: a degraded figure keeps the number of its caption', () => {
    expect(render('![i](a.png)\n^ Figure #: cap', { profile: 'comment' })).toBe('<p>[img: i]</p>\n<p>Figure 1: cap</p>')
    const table = render('| a |\n^ Table #: t\n\n![i](a.png)\n^ Figure #: cap', { profile: 'comment' })
    expect(table).toContain('Figure 1: cap')
  })

  it('C2-H-165: a degraded footnote reference writes no note, and a live one keeps its number', () => {
    expect(render('a[^n]\n\n[^n]: note', { profile: 'comment' })).toBe('<p>a[^n]</p>')
    const both = render('a[^n] *b*[^m]\n\n[^n]: x\n\n[^m]: y', { profile: 'comment' })
    expect(both).not.toContain('<section')
  })
})
