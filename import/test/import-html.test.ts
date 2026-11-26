// The clauses of spec/0.2/import-html.md, each test named by the clause it proves.
import { describe, expect, it } from 'vitest'
import { encodeTree, parse, render, validateTree } from '../../src/index.ts'
import { importDocument } from '../src/index.ts'

const children = (html: string, rawHtml?: boolean): unknown => {
  const result = importDocument(html, rawHtml === undefined ? { from: 'html' } : { from: 'html', rawHtml })
  validateTree(result.document)
  const tree = JSON.parse(encodeTree(result.document), (key, value: unknown) => key === 'pos' ? undefined : value) as { children: unknown }
  return tree.children
}
const codes = (html: string, rawHtml?: boolean): string[] =>
  importDocument(html, rawHtml === undefined ? { from: 'html' } : { from: 'html', rawHtml }).diagnostics.map(entry => entry.code)
const source = (html: string, rawHtml?: boolean): string =>
  importDocument(html, rawHtml === undefined ? { from: 'html' } : { from: 'html', rawHtml }).source
const paragraphOf = (...inline: unknown[]): unknown => ({ type: 'paragraph', children: inline })
const text = (value: string): unknown => ({ type: 'text', value })

describe('scope and input', () => {
  it('C2-M-004: an explicit body in a fragment reports dropped attributes', () => {
    const result = importDocument('<body class="page"><p>a</p></body>', { from: 'html' })
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: 'import-attribute-dropped',
      range: { startOffset: 0, endOffset: 34 } }))
  })

  it('C2-M-002: an input that starts with <header is a fragment read with a body context', () => {
    expect(children('<header class="top"><h1>Site</h1></header>')).toEqual([{ type: 'div', attrs: { classes: ['top'] },
      children: [{ type: 'heading', level: 1, children: [text('Site')] }] }])
    expect(children('<li>stray</li>')).toEqual([paragraphOf(text('stray'))])
  })

  it('C2-M-002: a document after leading whitespace and comments starts with <!doctype or <html', () => {
    const result = importDocument(' <!-- c --> <HTML lang="de"><body><p>x</p></body></HTML>', { from: 'html' })
    expect(result.document.lang).toBe('de')
  })

  it('C2-M-004, C2-M-005: the doctype and the head are dropped once each, a body class is a dropped attribute', () => {
    const html = '<!DOCTYPE html>\n<html lang="de">\n<head><title>T</title><script>x()</script></head>\n'
      + '<body class="page"><p>Hallo</p></body>\n</html>'
    const result = importDocument(html, { from: 'html' })
    expect(result.diagnostics.map(entry => [entry.code, entry.foreignType])).toEqual([
      ['import-element-dropped', '#doctype'], ['import-element-dropped', 'head'], ['import-attribute-dropped', 'body'],
      ['field-unspellable', undefined],
    ])
  })

  it('C2-M-005: a parser-implied empty head is not dropped content', () => {
    const headless = '<html><body><p>x</p></body></html>'
    expect(source(headless)).toBe('x\n')
    expect(codes(headless)).toEqual([])
    expect(codes('<html><head></head><body><p>x</p></body></html>')).toEqual(['import-element-dropped'])
  })
})

describe('whitespace', () => {
  it('C2-M-018: whitespace at the edges of the inline content of a block is removed', () => {
    expect(children('<p>  lead <b>x</b> </p>')).toEqual([paragraphOf(text('lead '), { type: 'strong', children: [text('x')] })])
    expect(codes('<p>  lead <b>x</b> </p>')).toContain('import-whitespace-normalized')
  })

  it('C2-M-018: a no-break space at an edge stays', () => {
    expect(children('<p>&nbsp;a&nbsp;</p>')).toEqual([paragraphOf(text(' a '))])
  })

  it('C2-M-019: a <br> at the end of the inline content of a block is removed', () => {
    expect(children('<p>a<br></p>')).toEqual([paragraphOf(text('a'))])
  })

  it('C2-M-020: import-whitespace-normalized has the severity hint', () => {
    const entry = importDocument('<p> a</p>', { from: 'html' }).diagnostics.find(row => row.code === 'import-whitespace-normalized')
    expect(entry?.severity).toBe('hint')
  })
})

describe('block elements', () => {
  it('C2-M-027: other attributes of a section that opens with a heading are dropped and reported', () => {
    expect(children('<section class="c" id="s"><h2>T</h2></section>')).toEqual([
      { type: 'heading', level: 2, children: [text('T')], attrs: { id: 's' } }])
    expect(codes('<section class="c" id="s"><h2>T</h2></section>')).toEqual(['import-attribute-dropped'])
  })

  it('C2-M-028: a section that opens with no heading is a div, reported as mapped', () => {
    expect(children('<section><p>no heading</p></section>')).toEqual([{ type: 'div', children: [paragraphOf(text('no heading'))] }])
    expect(codes('<section><p>no heading</p></section>')).toEqual(['import-element-mapped'])
  })

  it('C2-M-026: a heading id of its own that differs wins, and the id of the section is dropped and reported', () => {
    expect(source('<section id="outer"><h1 id="inner">H</h1></section>')).toBe('{#inner}\n= H\n')
    expect(codes('<section id="outer"><h1 id="inner">H</h1></section>')).toEqual(['import-attribute-dropped'])
    expect(source('<section><h1 id="i">H</h1></section>')).toBe('{#i}\n= H\n')
    expect(codes('<section id="s"><h1 id="s">H</h1></section>')).toEqual([])
    expect(source('<section id="s"><h1>H</h1></section>')).toBe('{#s}\n= H\n')
  })

  it('C2-M-012: comments in a run with inline content are raw inline; a run of only comments gives raw blocks', () => {
    expect(source('<div>x<!--c-->y</div>', true)).toBe(':::\nx`<!--c-->`{=html}y\n:::\n')
    expect(source('<div><!--c--> <!--d--></div>', true)).toBe(':::\n```=html\n<!--c-->\n```\n\n```=html\n<!--d-->\n```\n:::\n')
    expect(source('<p>a</p><!--c--> <p>b</p>', true)).toBe('a\n\n```=html\n<!--c-->\n```\n\nb\n')
  })
})

describe('lists', () => {
  it('C2-M-031: <menu> is a bullet list', () => {
    expect(children('<menu><li>a</li></menu>')).toEqual([{ type: 'list', marker: { kind: 'bullet', char: '-' }, spacing: 'tight',
      children: [{ type: 'list_item', children: [paragraphOf(text('a'))] }] }])
  })

  it('C2-M-032: an unknown task state is dropped and reported; the box gives the mark', () => {
    const html = '<ul><li data-task-state="q"><input type="checkbox"> x</li></ul>'
    expect(children(html)).toEqual([{ type: 'list', marker: { kind: 'bullet', char: '-' }, spacing: 'tight',
      children: [{ type: 'list_item', task: { mark: ' ' }, children: [paragraphOf(text('x'))] }] }])
    expect(codes(html)).toEqual(['import-attribute-dropped'])
  })

  it('C2-M-032: a known task state gives the mark', () => {
    const list = children('<ul><li data-task-state="?"><input type="checkbox"> x</li></ul>') as { children: { task: unknown }[] }[]
    expect(list[0]?.children[0]?.task).toEqual({ mark: '?' })
  })

  it('C2-M-032: each box after the first is dropped and reported, also with rawHtml on', () => {
    const html = '<ul><li><input type="checkbox"><input type="checkbox" checked> x</li></ul>'
    for (const rawHtml of [false, true]) {
      expect(source(html, rawHtml)).toBe('- [ ] x\n')
      expect(codes(html, rawHtml)).toEqual(['import-element-dropped', 'import-whitespace-normalized'])
    }
  })

  it('C2-M-033: a list with one item is tight', () => {
    const list = children('<ul><li><p>only</p></li></ul>') as { spacing: string }[]
    expect(list[0]?.spacing).toBe('tight')
  })

  it('C2-M-034: stray text in a list is dropped and reported', () => {
    expect(codes('<ul><li>a</li>stray<p>p</p></ul>')).toEqual(['import-structure-repaired', 'import-structure-repaired'])
  })

  it('C2-M-036: a div child of a dl is read as the children it holds', () => {
    expect(source('<dl><div><dt>a</dt><dd>b</dd></div></dl>')).toBe(':: a\n: b\n')
  })

  it('C2-M-036, C2-M-070: a dl with no entry is dropped and reported', () => {
    expect(children('<dl><span>x</span></dl>')).toEqual([])
    expect(codes('<dl><span>x</span></dl>')).toEqual(['import-structure-repaired', 'import-structure-repaired'])
  })
})

describe('figures', () => {
  it('C2-M-043: a figure that holds a table and a figcaption is the table with its caption', () => {
    expect(source('<figure><table><tr><td>a</td></tr></table><figcaption>T</figcaption></figure>')).toBe('| a |\n^ T\n')
  })

  it('C2-M-043: a block without a caption slot, or with a caption already, is a figure group; a lone image is its paragraph', () => {
    expect(source('<figure><p>x</p><figcaption>y</figcaption></figure>')).toBe('::: figure\nx\n:::\n^ y\n')
    expect(source('<figure><img src="i.png" alt="a"></figure>')).toBe('![a](i.png)\n')
    expect(source('<figure><pre><code>x</code></pre><figcaption>y</figcaption></figure>')).toBe('```\nx\n```\n^ y\n')
    const nested = '<figure><figure><pre><code>x</code></pre><figcaption>a</figcaption></figure><figcaption>y</figcaption></figure>'
    expect(source(nested)).toBe('::: figure\n```\nx\n```\n^ a\n:::\n^ y\n')
  })

  it('C2-M-041: the first caption is the caption of the table, and each further one is dropped and reported', () => {
    const html = '<table><caption>A</caption><caption>B</caption><tr><td>x</td></tr></table>'
    expect(source(html)).toBe('| x |\n^ A\n')
    expect(codes(html)).toEqual(['import-element-dropped'])
  })
})

  it('C2-M-068: the render of a div of the class footnotes imports to a directive whose list reads back', () => {
    const imported = importDocument(render('{.footnotes}\n:::\n1. a\n:::'), { from: 'html' })
    expect(imported.source).toBe('::: footnotes\n. a\n:::\n')
    expect(parse(imported.source).children[0]).toMatchObject({ type: 'directive', kind: 'footnotes', children: [{ type: 'list' }] })
  })

describe('inline elements', () => {
  it('C2-M-047: a time without datetime and an abbr without title are spans with an empty value', () => {
    expect(source('<p><time>today</time> <abbr>HTML</abbr> <time datetime="2020">t</time> <abbr title="T">A</abbr></p>'))
      .toBe('[today]{time} [HTML]{abbr} [t]{time=2020} [A]{abbr=T}\n')
  })

  it('C2-M-046: <wbr> is dropped and reported', () => {
    expect(children('<p>a<wbr>b</p>')).toEqual([paragraphOf(text('ab'))])
    expect(codes('<p>a<wbr>b</p>')).toEqual(['import-element-dropped'])
  })

  it('C2-M-048: <rp> and the children of <rt> give no entry', () => {
    expect(codes('<p><ruby>字<rp>(</rp><rt>ji</rt><rp>)</rp></ruby></p>').filter(code => code.startsWith('import-'))).toEqual([])
  })

  it('C2-M-049: the children of a <math> with a TeX source give no entry', () => {
    const html = '<p><math display="block"><semantics><mi>x</mi>'
      + '<annotation encoding="application/x-tex">x^2</annotation></semantics></math></p>'
    expect(codes(html)).toEqual([])
  })
})

describe('attributes', () => {
  it('C2-M-054: a name that is no key is dropped and reported; srcdoc and formaction are dropped', () => {
    const html = '<p><span x:y="1" srcdoc="a" formaction="b" data-k="2">t</span></p>'
    expect(children(html)).toEqual([paragraphOf({ type: 'span', children: [text('t')], attrs: { keyValues: [['data-k', '2']] } })])
    expect(codes(html)).toEqual(['import-attribute-dropped', 'import-attribute-dropped', 'import-attribute-dropped'])
  })

  it('C2-M-055: a style is a key as written and gives no other tree fact', () => {
    const [first] = children('<p style="text-align:right ;color:red">x</p>') as { data?: unknown, attrs: unknown }[]
    expect(first?.data).toBeUndefined()
    expect(first?.attrs).toEqual({ keyValues: [['style', 'text-align:right ;color:red']] })
  })

  it('C2-M-075: an exact alignment declaration on a paragraph is the key align', () => {
    const [first] = children('<p style="text-align: center;">x</p>') as { attrs: unknown }[]
    expect(first?.attrs).toEqual({ keyValues: [['align', 'center']] })
  })

  it('C2-M-047, C2-A-035: an attribute named like the key of its semantic element is that key in upper case, unreported', () => {
    const [first] = children('<p><abbr title="a" ABBR="b">y</abbr></p>') as { children: { attrs: unknown }[] }[]
    expect(first?.children[0]?.attrs).toEqual({ keyValues: [['abbr', 'a'], ['ABBR', 'b']] })
    expect(codes('<p><abbr title="a" ABBR="b">y</abbr></p>')).not.toContain('import-attribute-dropped')
  })

  it('C2-M-047, C2-H-075: the upper-case key renders as an attribute that imports back to the same tree', () => {
    for (const html of ['<p><abbr title="a" abbr="b">y</abbr></p>', '<p><kbd kbd="z" class="c">k</kbd></p>',
      '<p><time data-x="1" time="t" datetime="d">x</time></p>']) {
      const tree = children(html)
      expect(children(render(parse(source(html))))).toEqual(tree)
    }
  })

  it('C2-M-075, C2-H-015: the declared value is trimmed and folded to lower case', () => {
    const [first] = children('<p style="text-align:  Right ;">x</p>') as { attrs: unknown }[]
    expect(first?.attrs).toEqual({ keyValues: [['align', 'right']] })
  })
})

describe('elements without a counterpart', () => {
  it('C2-M-059: <details> is a div whose first block is the summary paragraph', () => {
    const html = '<details><summary>More</summary><p>Body</p></details>'
    expect(children(html)).toEqual([{ type: 'div', children: [paragraphOf(text('More')), paragraphOf(text('Body'))] }])
    expect(codes(html)).toEqual(['import-element-mapped'])
  })

  it('C2-M-057: a span row and an unknown element are spans reported as mapped', () => {
    expect(codes('<p><small>a</small> <my-tag>b</my-tag></p>')).toEqual(['import-element-mapped', 'import-element-mapped'])
  })

  it('C2-M-014: a block element in inline content is a span reported as mapped', () => {
    expect(children('<em><p>x</p></em>')).toEqual([paragraphOf({ type: 'emphasis',
      children: [{ type: 'span', children: [text('x')] }] })])
    expect(codes('<em><p>x</p></em>')).toEqual(['import-element-mapped'])
  })
})

describe('footnotes', () => {
  it('C2-M-062, C2-M-063: a GFM reference in <sup> is the reference alone and the backlink is dropped with its space', () => {
    const html = '<p>x<sup><a href="#fn-1" id="fnref-1" data-footnote-ref>1</a></sup></p>\n'
      + '<section class="footnotes"><ol><li id="fn-1"><p>Note <a href="#fnref-1" data-footnote-backref class="footnote-backref">↩</a></p>'
      + '</li></ol></section>'
    expect(source(html)).toBe('x[^1]\n\n[^1]: Note\n')
  })
})

describe('raw content', () => {
  const html = '<!-- note --><p>a<!-- inline -->b</p><script>run()</script>\n<p>Video: <iframe src="/v"></iframe></p>'

  it('C2-M-066: with rawHtml off every comment and raw element is dropped and reported once', () => {
    expect(children(html)).toEqual([paragraphOf(text('ab')), paragraphOf(text('Video:'))])
    const dropped = importDocument(html, { from: 'html' }).diagnostics.filter(entry => entry.code === 'import-element-dropped')
    expect(dropped.map(entry => entry.foreignType)).toEqual(['#comment', '#comment', 'script', 'iframe'])
  })

  it('C2-M-066: with rawHtml off a data-carve-raw span is dropped with one entry for the span', () => {
    const result = importDocument('<p>a<span data-carve-raw="html">&lt;script&gt;x()&lt;/script&gt;</span>b</p>', { from: 'html' })
    expect(result.source).toBe('ab\n')
    expect(result.diagnostics.map(entry => [entry.code, entry.foreignType])).toEqual([['import-element-dropped', 'span']])
  })

  it('C2-M-065: with rawHtml on a comment and a raw element are raw nodes whose block value ends with a line feed', () => {
    expect(children(html, true)).toEqual([
      { type: 'raw_block', format: 'html', value: '<!-- note -->\n' },
      paragraphOf(text('a'), { type: 'raw_inline', format: 'html', value: '<!-- inline -->' }, text('b')),
      { type: 'raw_block', format: 'html', value: '<script>run()</script>\n' },
      paragraphOf(text('Video: '), { type: 'raw_inline', format: 'html', value: '<iframe src="/v"></iframe>' }),
    ])
    expect(codes(html, true)).toEqual([])
  })

  it('C2-M-066: an input that is no task box is raw', () => {
    expect(children('<p>a <input type="text"></p>')).toEqual([paragraphOf(text('a'))])
    expect(children('<p>a <input type="text"></p>', true)).toEqual([paragraphOf(text('a '),
      { type: 'raw_inline', format: 'html', value: '<input type="text">' })])
  })

  it('C2-M-067: a reserved name is removed before an element is serialized as raw content', () => {
    expect(children('<template data-carve-src="x"><b>t</b></template>', true)).toEqual([
      { type: 'raw_block', format: 'html', value: '<template><b>t</b></template>\n' }])
  })
})

describe('normalization', () => {
  it('C2-M-069: an empty paragraph and an empty strong are dropped; an empty span with attributes stays', () => {
    expect(children('<p></p><p><b></b>x<span id="a"></span></p>')).toEqual([
      paragraphOf(text('x'), { type: 'span', children: [], attrs: { id: 'a' } })])
    expect(codes('<p></p><p><b></b>x<span id="a"></span></p>')).toEqual([])
  })

  it('C2-M-069: a drop that loses an attribute is reported', () => {
    expect(codes('<p class="c"></p>')).toEqual(['import-structure-repaired'])
  })
})

describe('diagnostics', () => {
  it('C2-M-080, C2-M-081: every entry is on the render-loss channel with a byte range and a foreign type', () => {
    const result = importDocument('é<wbr>', { from: 'html' })
    expect(result.diagnostics).toEqual([{ code: 'import-element-dropped', severity: 'warning', channel: 'render-loss',
      message: expect.any(String) as unknown, foreignType: 'wbr', range: { startOffset: 2, endOffset: 7 } }])
  })
})

describe('strict import losses', () => {
  it('C2-M-082, C2-H-130: strictLosses promotes all render-loss diagnostics', () => {
    const input = '<p><a href="javascript:x">t</a></p>'
    const ordinary = importDocument(input, { from: 'html' })
    const strict = importDocument(input, { from: 'html', strictLosses: true })
    expect(strict.source).toBe(ordinary.source)
    expect(strict.diagnostics.filter(entry => entry.channel === 'render-loss').every(entry => entry.severity === 'error')).toBe(true)
    expect(strict.diagnostics.some(entry => entry.code === 'import-destination-denied')).toBe(true)
  })
})

describe('C2-M-041: a col style read as declarations', () => {
  const table = (style: string): string =>
    `<table><colgroup><col style="${style}"><col></colgroup><tr><td>a</td><td>b</td></tr></table>`
  const width = (style: string): string | undefined => /\{widths=([^ }]+)/u.exec(source(table(style)))?.[1]

  it('skips empty and whitespace-only pieces and takes no report for a lone width', () => {
    expect(width(';; width:25% ;\t;')).toBe('25')
    expect(codes(table(';; width:25% ;\t;'))).not.toContain('import-attribute-dropped')
  })

  it('reads the property name without ASCII case and the value without surrounding whitespace', () => {
    expect(width('\nWiDtH\t:\t12.5%\n')).toBe('12.5')
  })

  it('takes the last width, so a later width that is no percentage gives no width, and reports the style', () => {
    expect(width('width: 30%; width: 40px')).toBeUndefined()
    expect(codes(table('width: 30%; width: 40px'))).toContain('import-attribute-dropped')
  })

  it('takes the last width marked important over any later width, and reports the mark (carve-js#5574)', () => {
    expect(width('width: 30% !important; width: 40%')).toBe('30')
    expect(width('width: 30%; width: 40%!Important')).toBe('40')
    expect(width('width: 30% ! important; width: 40% !important; width: 50%')).toBe('40')
    expect(width('width: 30% !important; width: 40px !important')).toBeUndefined()
    expect(width('width: 30%\t!\timportant')).toBe('30')
    expect(width('width: 30% important')).toBeUndefined()
    expect(codes(table('width: 30% !important'))).toContain('import-attribute-dropped')
    expect(codes(table('width: 30%'))).not.toContain('import-attribute-dropped')
  })

  it('gives no width for a piece without a colon, a spaced percent sign or a width out of range', () => {
    for (const style of ['width', 'width: 40 %', 'width: 0%', 'width: 101%', 'max-width: 40%']) {
      expect(width(style), style).toBeUndefined()
      expect(codes(table(style)), style).toContain('import-attribute-dropped')
    }
  })
})

describe('C2-M-037: leading column-heading rows of a table with no thead (carve#6623)', () => {
  const head = (html: string): { source: string, codes: string[] } => ({ source: source(html), codes: codes(html) })

  it('a leading th row in a direct, explicit or implied body is the head, unreported', () => {
    const expected = { source: '|= Name |= Value |\n| Alpha | b |\n', codes: [] }
    expect(head('<table><tr><th>Name</th><th>Value</th></tr><tr><td>Alpha</td><td>b</td></tr></table>')).toEqual(expected)
    expect(head('<table><tbody><tr><th>Name</th><th>Value</th></tr><tr><td>Alpha</td><td>b</td></tr></tbody></table>'))
      .toEqual(expected)
    expect(head('<table><tr><th scope="Col">Name</th><th>Value</th></tr><tr><td>Alpha</td><td>b</td></tr></table>'))
      .toEqual(expected)
  })

  it('every leading heading row moves, and a body left empty is dropped', () => {
    expect(head('<table><tr><th>A</th></tr><tr><th>B</th></tr><tr><td>1</td></tr></table>').source).toBe('|= A |\n|= B |\n| 1 |\n')
    const only = children('<table><tr><th>A</th></tr></table>') as { children: { type: string }[] }[]
    expect(only[0]?.children.map(group => group.type)).toEqual(['table_head'])
  })

  const groups = (html: string): string[] =>
    (children(html) as { children: { type: string }[] }[])[0]?.children.map(group => group.type) ?? []

  it('a row with a scope row, another scope or a td cell, and a th row after a body row stay in the body', () => {
    for (const cells of ['<th scope="row">A</th>', '<th scope="rowgroup">A</th>', '<td>A</td>']) {
      expect(groups(`<table><tr><th>X</th>${cells}</tr><tr><td>1</td><td>2</td></tr></table>`))
        .toEqual(['table_body'])
    }
    expect(source('<table><tr><td>1</td></tr><tr><th>A</th></tr></table>')).toBe('| 1 |\n|= A |\n')
  })

  const scopes = (html: string): (string | undefined)[][] =>
    ((children(html) as { children: { type: string, children: { children: { scope?: string }[] }[] }[] }[])[0]?.children
      .find(group => group.type === 'table_body')?.children ?? []).map(row => row.children.map(cell => cell.scope))

  it('an unscoped th of a leading th row that stays in the body takes scope col, which the writer reports', () => {
    const html = '<table><tr><th>A</th><th scope="row">B</th></tr><tr><th>C</th></tr><tr><td>1</td><th>D</th></tr></table>'
    expect(scopes(html)).toEqual([['col', undefined], ['col'], [undefined, undefined]])
    expect(codes(html).filter(code => code === 'field-unspellable')).toHaveLength(2)
    expect(scopes('<table><thead><tr><th>H</th></tr></thead><tbody><tr><th>A</th></tr><tr><td>1</td></tr></tbody></table>'))
      .toEqual([[undefined], [undefined]])
  })

  it('a thead keeps the rows of the first body where they are', () => {
    expect(source('<table><thead><tr><th>H</th></tr></thead><tr><th>A</th></tr><tr><td>1</td></tr></table>'))
      .toBe('{body-rows=1 body-header-rows=1}\n|= H |\n| A |\n| 1 |\n')
  })

  it('a row span in a moved row ends at the last head row', () => {
    const result = importDocument('<table><tr><th rowspan="3">A</th><th>B</th></tr><tr><td>1</td><td>2</td></tr></table>',
      { from: 'html' })
    expect(result.diagnostics.map(entry => entry.code)).toContain('import-structure-repaired')
  })
})

describe('C2-M-037: the data cells of a thead (carve#6663)', () => {
  const head = (html: string): { source: string, codes: string[] } => ({ source: source(html), codes: codes(html) })

  it('a td of the thead stays a data cell of the head, written with header-rows and not reported', () => {
    expect(head('<table><thead><tr><td>a</td><td>b</td></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody></table>'))
      .toEqual({ source: '{header-rows=1}\n| a | b |\n| 1 | 2 |\n', codes: [] })
    expect(head('<table><thead><tr><th>a</th><td>b</td></tr><tr><td>c</td></tr></thead></table>'))
      .toEqual({ source: '{header-rows=2}\n|= a | b |\n| c |\n', codes: [] })
    expect(head('<table><thead><tr><th>a</th></tr></thead><tr><td>1</td></tr></table>'))
      .toEqual({ source: '|= a |\n| 1 |\n', codes: [] })
  })

  it('an empty corner td of the thead stays an empty data cell', () => {
    const html = '<table><thead><tr><td></td><td>Q1</td><td>Q2</td></tr></thead>'
      + '<tbody><tr><th>North</th><td>1</td><td>2</td></tr></tbody></table>'
    expect(head(html))
      .toEqual({ source: '{header-rows=1}\n| | Q1 | Q2 |\n|= North | 1 | 2 |\n', codes: [] })
  })

  it('a thead of td rows above a header-cell foot reads back as head and foot', () => {
    expect(source('<table><thead><tr><td>a</td></tr></thead><tfoot><tr><th>F</th></tr></tfoot></table>'))
      .toBe('{header-rows=1 footer-rows=1}\n| a |\n|= F |\n')
  })

  it('a foot keeps its rows and cell kinds', () => {
    expect(source('<table><tr><td>1</td></tr><tfoot><tr><th>F</th></tr></tfoot></table>')).toBe('{footer-rows=1}\n| 1 |\n|= F |\n')
    // carve#6664: a table of only a foot led by a row of header cells is spelled with an empty body-rows.
    expect(head('<table><tfoot><tr><th scope="row">F</th></tr></tfoot></table>'))
      .toEqual({ source: '{footer-rows=1 body-rows}\n|= F |\n', codes: [] })
  })
})
