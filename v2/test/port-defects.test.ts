import { describe, expect, it } from 'vitest'
import { parse, parseWithDiagnostics, render } from '../src/index.ts'

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
