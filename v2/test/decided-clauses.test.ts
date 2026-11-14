// The clauses that the specification commits "decide the cases the three engine lanes logged" and
// "fix what the review of today's clauses found" added or changed, one test per clause id.
import { describe, expect, it } from 'vitest'
import {
  type AstNode, format, parse, parseWithLayout, render, type RenderOptions, write, writeWithDiagnostics,
} from '../src/index.ts'
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
    const paragraph = parse('\uFEFFab *c*').children![0]!
    expect(paragraph.pos).toEqual({ startLine: 1, startColumn: 1, startOffset: 3, endLine: 1, endColumn: 7, endOffset: 9 })
    expect(paragraph.children![1]!.pos).toMatchObject({ startColumn: 4, startOffset: 6 })
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
    expect(parse('{{ a.crv @code }}', { positions: false }).children).toEqual([{ type: 'include', path: 'a.crv', options: [['code', '']] }])
  })
})

describe('a start value of more than nine digits', () => {
  const list = (delimiter: string): AstNode => ({
    type: 'document', astVersion: '2.0', children: [{
      type: 'list', marker: { kind: 'ordered', style: '1', delimiter, start: 1234567890 }, spacing: 'tight',
      children: [{ type: 'list_item', children: [paragraph(text('a'))] }, { type: 'list_item', children: [paragraph(text('b'))] }],
    }],
  })

  it('C2-W-044: a supplied tree is written from 1 and reported with field-unspellable', () => {
    for (const [delimiter, carve] of [['.', '. a\n. b\n'], [')', '1) a\n2) b\n']]) {
      const output = writeWithDiagnostics(list(delimiter!))
      expect(output.source).toBe(carve)
      expect(output.diagnostics.map((entry) => entry.code)).toEqual(['field-unspellable'])
    }
  })

  it('C2-B-219: a start attribute of more than nine digits stays a key', () => {
    const list = parse('{start=1234567890}\n. a', { positions: false }).children![0]!
    expect(list.marker).toEqual({ kind: 'ordered', style: '1', delimiter: '.' })
    expect(list.attrs).toEqual({ keyValues: [['start', '1234567890']] })
  })
})

describe('tables', () => {
  it('C2-B-184: a code span across continuation rows keeps its line feed', () => {
    const cell = parse('| `a | x |\n+ b` | y |', { positions: false }).children![0]!.children![0]!.children![0]!.children![0]!
    expect(cell.children).toEqual([{ type: 'cell_paragraph', children: [{ type: 'code', value: 'a\nb' }] }])
    expect(render('| `a | x |\n+ b` | y |')).toBe('<table>\n  <tbody>\n    <tr><td><code>a\nb</code></td><td>x y</td></tr>\n  </tbody>\n</table>')
  })

  it('C2-B-221: headRows is the declared count also past the last row, and the writer writes it back', () => {
    const src = `{table header-rows=5}\n${FENCE}csv\na,b\nc,d\n${FENCE}`
    const document = parse(src, { positions: false })
    expect(document.children![0]!.children).toHaveLength(1)
    expect(document.children![0]!.children![0]!.headRows).toBe(5)
    expect(format(src)).toBe(`${src}\n`)
    expect(write(document)).toContain('header-rows=5')
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
