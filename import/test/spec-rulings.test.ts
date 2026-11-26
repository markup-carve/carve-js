// The rulings of the 0.2 specification that the HTML importer follows, each test named by its clause.
import { describe, expect, it } from 'vitest'
import { importDocument } from '../src/index.ts'

describe('block images', () => {
  it('C2-H-020: a paragraph of one image with attributes is a block image paragraph that keeps them', () => {
    const result = importDocument('<p id="i" class="c"><img src="x.png" alt="a"></p>\n<p lang="de"><img src="y.png" alt="b"></p>\n',
      { from: 'html' })
    expect(result.document.children).toMatchObject([
      { type: 'paragraph', role: 'image', attrs: { id: 'i', classes: ['c'] } },
      { type: 'paragraph', role: 'image', lang: 'de' },
    ])
    expect(result.diagnostics.map((entry) => entry.code)).toEqual([])
  })
})

describe('destinations the importer cannot keep', () => {
  it('C2-W-011: a link or image whose URL is denied becomes its text, so the writer has a spelling and reports no loss', () => {
    const cases: [string, 'html' | 'markdown' | 'djot', string][] = [
      ['<p><a href="javascript:x">t</a></p>\n', 'html', 't\n'],
      ['<p>a <img src="javascript:x" alt="i"> <a>t</a></p>\n', 'html', 'a i t\n'],
      ['[t](javascript:x) and ![i](javascript:y)\n', 'markdown', 't and i\n'],
      ['[t](javascript:x)\n\n![i](javascript:y)\n', 'djot', 't\n\ni\n'],
    ]
    for (const [input, from, source] of cases) {
      const result = importDocument(input, { from })
      expect(result.source, input).toBe(source)
      expect(result.diagnostics.map((entry) => entry.code), input).not.toContain('field-unspellable')
    }
  })

  it('C2-W-011: attributes of a link with no destination stay on a span', () => {
    const result = importDocument('<p><a id="k" href="javascript:x">t</a></p>\n', { from: 'html' })
    expect(result.document.children[0]).toMatchObject({ type: 'paragraph', children: [{ type: 'span', attrs: { id: 'k' } }] })
  })
})

describe('images in a bare tight-item paragraph', () => {
  it('C2-H-020: an image beside text of the same bare paragraph stays inline; bare images alone are block image paragraphs', () => {
    const inline = importDocument('<ul data-carve-tight>\n  <li><img src="a.png" alt="a">\n-\n&gt; ^ cap</li>\n</ul>\n', { from: 'html' })
    const list = inline.document.children[0]
    const item = list?.type === 'list' ? list.children[0] : undefined
    const types = item?.children[0]?.type === 'paragraph' ? item.children[0].children.map((node) => node.type) : []
    expect(types).toEqual(['image', 'soft_break', 'text', 'soft_break', 'text'])
    expect(item?.children[0]).not.toHaveProperty('role')
    const html = '<ul>\n  <li>\n    <img src="c.png" alt="c">\n    <img src="d.png" alt="d">\n  </li>\n</ul>\n'
    const bare = importDocument(html, { from: 'html' })
    const second = bare.document.children[0]
    const blocks = second?.type === 'list' ? second.children[0]?.children : undefined
    expect(blocks).toMatchObject([{ type: 'paragraph', role: 'image' }, { type: 'paragraph', role: 'image' }])
  })
})

describe('carriers that disagree', () => {
  it('C2-H-186: a reference and its note that carry different footnote keys are both read as they stand', () => {
    const html = '<p>a<a href="#fn1" data-carve-footnote-label="x" role="doc-noteref">1</a></p>' +
      '<section role="doc-endnotes"><ol><li id="fn1" data-carve-footnote-label="y"><p>n</p></li></ol></section>'
    const result = importDocument(html, { from: 'html' })
    expect(result.document.children).toMatchObject([
      { type: 'paragraph', children: [{ type: 'text' }, { type: 'footnote_ref', key: '1' }] },
      { type: 'footnote', key: '1' },
    ])
    expect(result.diagnostics.filter((entry) => entry.code === 'import-carrier-ignored')).toHaveLength(2)
  })

  it('C2-H-172, C2-H-187: a template keeps a bidirectional control in the expansion it gives', () => {
    const html = '<template data-carve-abbreviations>*[A]: x‮y</template>\n<p><abbr title="x‮y">A</abbr>.</p>\n'
    expect(importDocument(html, { from: 'html' }).document.children[0]).toMatchObject({ type: 'abbreviation_def', expansion: 'x‮y' })
  })
})

describe('line block whitespace', () => {
  const lineBlock = (body: string): string => `<div class="line-block" data-carve-line-block>\n  <p>${body}</p>\n</div>\n`
  const imported = (body: string): string => importDocument(lineBlock(body), { from: 'html', rawHtml: true }).source

  it('C2-H-043: a run of no-break spaces inside a line reads back as the spaces that wrote it', () => {
    const nbsp = (count: number): string => '&nbsp;'.repeat(count)
    expect(imported(`tab gap<br>\nwide${nbsp(8)}gap<br>\n${nbsp(4)}lead<br>\nwide${nbsp(2)}two<br>\na b`))
      .toBe('::: |\ntab gap\nwide        gap\n    lead\nwide  two\na b\n:::\n')
  })

  it('C2-H-043: runs are read at any inline depth, and a code span keeps its text', () => {
    expect(imported('<em>a&nbsp;&nbsp;b</em> c')).toBe('::: |\n/a  b/ c\n:::\n')
    expect(imported('<code>a  b\tc</code>&nbsp;&nbsp;d')).toBe('::: |\n`a  b\tc`  d\n:::\n')
  })

  it('C2-H-043: a lone no-break space inside a line is no run the renderer writes, so it stays U+00A0', () => {
    expect(imported('a&nbsp;b c&nbsp; d')).toBe('::: |\na b c  d\n:::\n')
  })

  it('carve#6777: a no-break space run beside a space or tab was authored, so it stays U+00A0', () => {
    expect(imported('a&nbsp;&nbsp; b')).toBe('::: |\na\u00a0\u00a0 b\n:::\n')
    expect(importDocument(lineBlock('a&nbsp;&nbsp; b'), { from: 'html' }).document.children[0])
      .toMatchObject({ children: [{ children: [{ type: 'text', value: 'a\u00a0\u00a0 b' }] }] })
    expect(imported('&nbsp; x<br>\n&nbsp;&nbsp;\tx<br>\na &nbsp;&nbsp;b<br>\na\t&nbsp;&nbsp;&nbsp;b'))
      .toBe('::: |\n\u00a0 x\n\u00a0\u00a0\tx\na \u00a0\u00a0b\na\t\u00a0\u00a0\u00a0b\n:::\n')
    expect(imported('&nbsp;x<br>\na&nbsp;&nbsp;b')).toBe('::: |\n x\na  b\n:::\n')
  })

  it('carve#6786, C2-H-195 row 17: an empty line or one ending in a space or tab keeps its hard break (CC-2167 to 2171)', () => {
    expect(imported('a <br>\nb')).toBe('::: |\na \\\nb\n:::\n')
    expect(imported('a<br>\n<br>\nb')).toBe('::: |\na\n\\\nb\n:::\n')
    expect(imported('a <code>x</code> <br>\nb')).toBe('::: |\na `x` \\\nb\n:::\n')
    expect(imported('a&nbsp;&nbsp;&nbsp;<br>\nb')).toBe('::: |\na   \\\nb\n:::\n')
    expect(imported('a<br>\nb')).toBe('::: |\na\nb\n:::\n')
    expect(importDocument(lineBlock('a<br>\n<br>\nb'), { from: 'html' }).document.children[0]).toMatchObject({
      children: [
        { children: [{ type: 'text', value: 'a' }] }, { children: [{ type: 'hard_break' }] }, { children: [{ type: 'text', value: 'b' }] },
      ],
    })
  })

  it('carve#6785: a `<br>` with only whitespace after it is the hard break of the stanza\'s last line (CC-160)', () => {
    const html = '<div class="line-block" data-carve-line-block>\n  <p>a<br>\n</p>\n  <p>b</p>\n</div>\n'
    const result = importDocument(html, { from: 'html', rawHtml: true })
    expect(result.source).toBe('::: |\na\\\n\nb\n:::\n')
    expect(result.document.children[0]).toMatchObject({
      children: [
        { children: [{ type: 'text', value: 'a' }, { type: 'hard_break' }] },
        { children: [] }, { children: [{ type: 'text', value: 'b' }] },
      ],
    })
    expect(imported('a<br>\n')).toBe('::: |\na\\\n:::\n')
  })
})
