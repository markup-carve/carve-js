// The clauses that the specification commits "decide the cases the three engine lanes logged" and
// "fix what the review of today's clauses found" added or changed, one test per clause id.
import { describe, expect, it } from 'vitest'
import { format, parse, parseWithLayout, render, type RenderOptions } from '../src/index.ts'
import { documentOf, paragraph, text } from './support/tree.ts'

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
