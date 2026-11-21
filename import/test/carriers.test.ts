import { describe, expect, it } from 'vitest'
import type { DocumentNode, Inline } from '../../src/index.ts'
import { importDocument } from '../src/index.ts'
import { harnessInputs, roundTrip } from '../scripts/roundtrip-harness.ts'

function read(html: string): { document: DocumentNode, messages: string[] } {
  // C2-M-090: the carriers of a `roundtrip` render are read with `rawHtml` on.
  const result = importDocument(html, { from: 'html', rawHtml: true })
  return { document: result.document, messages: result.diagnostics.map(entry => entry.message) }
}

function first(html: string): DocumentNode['children'][number] | undefined {
  return read(html).document.children[0]
}

function inlines(html: string): Inline[] {
  const block = first(html)
  return block?.type === 'paragraph' ? block.children : []
}

function ignored(html: string, name: string): boolean {
  return read(html).messages.some(message => message.startsWith(`Carrier ${name} ignored`))
}

function back(source: string): string[] {
  const outcome = roundTrip(source)
  return outcome.equal ? [] : outcome.classes
}

const examples = harnessInputs(0, 1, 2048).examples
const rendered = examples.map(source => ({ source, html: roundTrip(source).html }))

// The differences of a declared head row count, which is a sidecar fact (C2-A-088), and of the old column field.
const GAPS = ['table_column.authored: lost', 'table_body.headRows: lost']

/**
 * Examples whose difference no carrier of C2-H-011 can carry: a key typed in another normal form than the id it names
 * (C2-I-097), the bodies and row header columns of `body-rows` (C2-B-230), and attribute name case (C2-H-195 row 13).
 */
const HELD_SOURCES: ReadonlyMap<string, readonly string[]> = new Map([
  ['# Caf\u00e9\n\nSee </#Cafe\u0301>.', ['xref.key']],
  ['{body-rows=1,1 body-header-rows=0,1 body-header-cols=1,0 footer-rows=1}\n|= Item |= Qty |\n| tea | 2 |\n| Later | |\n'
    + '| milk | 1 |\n| Total | 3 |', ['table_body.rowHeadColumns: lost', 'table_cell.header']],
  // C2-H-195 row 13: HTML lowers KBD and ABBR, and KBD then selects the semantic span key of C2-H-075.
  ['[x]{KBD} and [y]{abbr="a" ABBR="b"}', ['span.attrs.keyValues: lost object', 'span.attrs.keyValues: value']],
])

/** Every example whose `roundtrip` render holds `marker` imports back to its tree, after the specified losses and gaps. */
function examplesWith(marker: string): { count: number, failing: string[] } {
  const hits = rendered.filter(entry => entry.html.includes(marker))
  const failing = hits.filter(entry => roundTrip(entry.source).classes.some(name => !GAPS.includes(name)
    && !(HELD_SOURCES.get(entry.source)?.includes(name) ?? false)))
  return { count: hits.length, failing: failing.map(entry => entry.source) }
}

describe('C2-H-186 carriers', () => {
  it('C2-H-195 row 16: the space at the edge of a delimited-table cell is a listed loss', () => {
    const outcome = roundTrip('{table}\n```csv\na,"b ""q"" c", d\n```\n')
    expect(outcome.html).toContain('<th scope="col"> d</th>')
    expect(outcome.equal).toBe(true)
    expect(outcome.losses).toEqual(['C2-H-195 row 16 cell edge whitespace'])
  })

  it('C2-H-186 data-marker gives the bullet character', () => {
    expect(back('* a\n* b\n')).toEqual([])
    const list = first('<ul data-marker="+"><li>a</li></ul>')
    expect(list?.type === 'list' ? list.marker : undefined).toEqual({ kind: 'bullet', char: '-' })
    expect(ignored('<ul data-marker="+"><li>a</li></ul>', 'data-marker')).toBe(true)
  })

  it('C2-H-186 data-carve-tight gives a tight list, ignored where an item writes a bare paragraph element', () => {
    expect(back('- a\n- b\n')).toEqual([])
    expect(back('- a\n\n- b\n')).toEqual([])
    const html = '<ul data-carve-tight><li><p>a</p></li><li>b</li></ul>'
    const list = first(html)
    expect(list?.type === 'list' ? list.spacing : undefined).toBe('loose')
    expect(ignored(html, 'data-carve-tight')).toBe(true)
  })

  it('C2-H-186 data-carve-explicit-id gives the authored heading id', () => {
    expect(back('{#x}\n# A\n')).toEqual([])
    const heading = first('<h2 data-carve-explicit-id id="y">A</h2>')
    expect(heading?.type === 'heading' ? heading.attrs?.id : undefined).toBe('y')
  })

  it('C2-H-186 data-carve-generated-id gives a heading without an authored id', () => {
    expect(back('# A\n\n## B\n')).toEqual([])
    const heading = first('<section data-carve-generated-id id="A"><h1>A</h1></section>')
    expect(heading?.type === 'heading' ? heading.attrs : 'none').toBeUndefined()
  })

  it('C2-H-185 C2-H-186 an id carrier without an id, with its opposite, or on a section without a heading is ignored', () => {
    expect(ignored('<h2 data-carve-explicit-id>A</h2>', 'data-carve-explicit-id')).toBe(true)
    const both = '<section data-carve-explicit-id data-carve-generated-id id="x"><h1>A</h1></section>'
    expect(ignored(both, 'data-carve-explicit-id')).toBe(true)
    expect(ignored('<section data-carve-generated-id id="x"><p>a</p></section>', 'data-carve-generated-id')).toBe(true)
  })

  const misplaced = ['data-carve-source-level', 'data-carve-tight', 'data-carve-ref']
  it.each(misplaced)('C2-M-009 %s on a section that opens at a heading is reported as ignored', (name) => {
    const html = `<section ${name}="1" id="t"><h2>T</h2><p>x</p></section>`
    expect(ignored(html, name)).toBe(true)
    const heading = first(html)
    expect(heading?.type === 'heading' ? heading.level : 'none').toBe(2)
  })

  it('C2-M-009 the id carriers of a section that opens at a heading are read, not reported', () => {
    expect(read('<section data-carve-generated-id id="t"><h2>T</h2></section>').messages).toEqual([])
  })

  it('C2-H-120 data-carve-src on a section that opens at a heading is removed without a report', () => {
    expect(read('<section data-carve-src="3:1" id="t"><h2>T</h2></section>').messages).toEqual([])
  })

  it('C2-H-186 data-carve-ref gives a full reference and its key', () => {
    expect(back('[a][b]\n\n[b]: /u\n')).toEqual([])
    expect(ignored('<p><a href="/u" data-carve-ref="a  b">x</a></p>', 'data-carve-ref')).toBe(true)
    const link = inlines('<p><a href="/u" data-carve-ref="a  b">x</a></p>')[0]
    expect(link?.type === 'link' ? link.key : 'none').toBeUndefined()
  })

  it('C2-H-186 data-carve-ref-collapsed gives the collapsed form', () => {
    expect(back('[b][]\n\n[b]: /u\n')).toEqual([])
  })

  it('C2-H-186 data-carve-ref-shortcut gives the shortcut form', () => {
    expect(back('[b]\n\n[b]: /u\n')).toEqual([])
    expect(back('![b]\n\n[b]: /i.png\n')).toEqual([])
  })

  it('C2-H-185 both reference forms are ignored, and the key is still read', () => {
    const html = '<p><a href="/u" data-carve-ref="b" data-carve-ref-collapsed data-carve-ref-shortcut>x</a></p>'
    const link = inlines(html)[0]
    expect(link?.type === 'link' ? [link.key, link.refForm] : undefined).toEqual(['b', 'full'])
    expect(ignored(html, 'data-carve-ref-collapsed') && ignored(html, 'data-carve-ref-shortcut')).toBe(true)
  })

  it('C2-H-186 data-carve-autolink gives an autolink, ignored on an element that holds an element', () => {
    expect(back('<https://x.y>\n')).toEqual([])
    expect(back('<mailto:a@b.c>\n')).toEqual([])
    const html = '<p><a href="/u" data-carve-autolink><b>x</b></a></p>'
    expect(inlines(html)[0]?.type).toBe('link')
    expect(ignored(html, 'data-carve-autolink')).toBe(true)
  })

  it('C2-H-185 a reference, an autolink and a cross-reference exclude each other', () => {
    const html = '<p><a href="#a" data-carve-autolink data-carve-xref>x</a></p>'
    expect(inlines(html)[0]?.type).toBe('link')
    expect(ignored(html, 'data-carve-autolink') && ignored(html, 'data-carve-xref')).toBe(true)
    const ref = '<p><a href="/u" data-carve-ref="b" data-carve-autolink>/u</a></p>'
    const link = inlines(ref)[0]
    expect(link?.type === 'link' ? link.key : 'autolink').toBeUndefined()
  })

  it('C2-H-186 data-carve-xref gives a cross-reference, ignored where the target is no id', () => {
    expect(back('{#intro}\n# Intro\n\nSee </#intro>.\n')).toEqual([])
    const html = '<p><a href="#a b" data-carve-xref>x</a></p>'
    expect(inlines(html)[0]?.type).toBe('link')
    expect(ignored(html, 'data-carve-xref')).toBe(true)
  })

  it('C2-H-186 data-carve-footnote-label gives the footnote key', () => {
    expect(back('a[^note]\n\n[^note]: The note.\n')).toEqual([])
    const html = '<p><a id="fnref1" href="#fn1" role="doc-noteref" data-carve-footnote-label=" n"><sup>1</sup></a></p>'
    expect(ignored(html, 'data-carve-footnote-label')).toBe(true)
  })

  it('C2-H-186 data-carve-inline-footnote gives an inline footnote, ignored for a note of two paragraphs', () => {
    expect(back('a^[the *note*]\n')).toEqual([])
    expect(back('a^[outer ^[inner]]\n')).toEqual([])
    const html = '<p><a id="fnref1" href="#fn1" role="doc-noteref"><sup>1</sup></a></p><section role="doc-endnotes"><ol>' +
      '<li id="fn1" data-carve-inline-footnote><p>a</p><p>b</p></li></ol></section>'
    expect(inlines(html)[0]?.type).toBe('footnote_ref')
    expect(ignored(html, 'data-carve-inline-footnote')).toBe(true)
  })

  it('C2-H-186 data-carve-raw gives a raw span, ignored for a malformed format or element content', () => {
    expect(back('`<b>x</b>`{=html}\n')).toEqual([])
    expect(inlines('<p><span data-carve-raw="1x">a</span></p>')[0]?.type).toBe('span')
    expect(ignored('<p><span data-carve-raw="1x">a</span></p>', 'data-carve-raw')).toBe(true)
    expect(ignored('<p><span data-carve-raw="html"><b>a</b></span></p>', 'data-carve-raw')).toBe(true)
  })

  it('C2-H-186 data-carve-label gives the fence label, ignored where a fence cannot hold it', () => {
    expect(back('```js [Tab]\nx\n```\n')).toEqual([])
    const html = '<pre data-carve-label="a]b"><code>x</code></pre>'
    const code = first(html)
    expect(code?.type === 'code_block' ? code.groupLabel : 'none').toBeUndefined()
    expect(ignored(html, 'data-carve-label')).toBe(true)
  })

  it('C2-H-186 data-carve-caption-number gives the caption mark, ignored outside a caption', () => {
    expect(back('![a](/i.png)\n^ Figure #: cap\n')).toEqual([])
    const html = '<p>a <span data-carve-caption-number>1</span></p>'
    expect(inlines(html).some(node => node.type === 'caption_number')).toBe(false)
    expect(ignored(html, 'data-carve-caption-number')).toBe(true)
  })

  it('C2-H-186 data-carve-div gives a div, ignored where the div has other attributes', () => {
    expect(back(':::\na\n:::\n')).toEqual([])
    expect(ignored('<div data-carve-div class="c"><p>a</p></div>', 'data-carve-div')).toBe(true)
  })

  it('C2-H-186 data-carve-line-block gives a line block, ignored without its class', () => {
    expect(back('::: |\none\n  two\n\nthree\n:::\n')).toEqual([])
    const html = '<div data-carve-line-block><p>a</p></div>'
    expect(first(html)?.type).toBe('div')
    expect(ignored(html, 'data-carve-line-block')).toBe(true)
  })

  it('C2-H-186 data-carve-src sets nothing and is removed', () => {
    const paragraph = first('<p data-carve-src="3:1">a</p>')
    expect(paragraph?.type === 'paragraph' ? paragraph.attrs : 'none').toBeUndefined()
  })

  it('C2-H-186 a reserved name is never kept as an authored attribute, also when it is ignored', () => {
    const paragraph = first('<div data-carve-div class="c"><p>a</p></div>')
    expect(JSON.stringify(paragraph)).not.toContain('data-carve')
  })
})

describe('C2-H-031, C2-H-032: facts every render writes', () => {
  it('C2-H-033 data-task-state and C2-H-032 the task-list class give task items', () => {
    expect(back('- [ ] a\n- [x] b\n')).toEqual([])
  })

  it('C2-H-031 data-delim gives the delimiter of an ordered list', () => {
    expect(back('1) a\n2) b\n')).toEqual([])
  })
})

describe('C2-H-187 abbreviation templates', () => {
  it('C2-H-187 a template at the top level gives its definitions at its place', () => {
    const html = '<template data-carve-abbreviations>*[HTML]: HyperText\n\n{.x}\n*[CSS]: Style</template>' +
      '<p><abbr title="HyperText">HTML</abbr></p>'
    const { document } = read(html)
    expect(document.children.map(node => node.type)).toEqual(['abbreviation_def', 'abbreviation_def', 'paragraph'])
    const paragraph = document.children[2]
    expect(paragraph?.type === 'paragraph' ? paragraph.children[0]?.type : undefined).toBe('abbreviation')
  })

  it('C2-H-187 a template whose text gives another block, or that stands inside a block, gives no definition', () => {
    const other = '<template data-carve-abbreviations>*[HTML]: HyperText\n\ntext</template>'
    expect(read(other).document.children.some(node => node.type === 'abbreviation_def')).toBe(false)
    expect(ignored(other, 'data-carve-abbreviations')).toBe(true)
    const nested = '<div><template data-carve-abbreviations>*[HTML]: HyperText</template></div>'
    expect(JSON.stringify(read(nested).document)).not.toContain('abbreviation_def')
    expect(ignored(nested, 'data-carve-abbreviations')).toBe(true)
  })
})

describe('C2-H-184 C2-H-189 trust', () => {
  it('C2-H-184 a carrier written inside raw content is text and sets no fact', () => {
    expect(back('`<a href="/u" data-carve-autolink>/u</a>`{=html}\n')).toEqual([])
    const span = inlines('<p><span data-carve-raw="html">&lt;a data-carve-xref href="#x"&gt;</span></p>')[0]
    expect(span?.type).toBe('raw_inline')
  })

  it('C2-H-184 a template written inside raw content gives no definition', () => {
    expect(back('`<template data-carve-abbreviations>*[X]: y</template>`{=html}\n')).toEqual([])
    const { document } = read('<p><span data-carve-raw="html">&lt;template data-carve-abbreviations&gt;*[X]: y</span></p>')
    expect(document.children.some(node => node.type === 'abbreviation_def')).toBe(false)
  })

  it('C2-H-184 a raw block of HTML is code and its carriers are text', () => {
    expect(back('```=html\n<div data-carve-div><a data-carve-autolink href="/u">/u</a></div>\n```\n')).toEqual([])
  })
})

describe('C2-H-026 to C2-H-093 renderer structures read back', () => {
  it.each([
    ['C2-H-026 sections', '<section'],
    ['C2-H-062 figures', '<figure'],
    ['C2-H-064 figure groups and panels', 'carve-figure-group'],
    ['C2-H-089 the footnote section', 'doc-endnotes'],
    ['C2-H-055 table groups', '<thead>'],
    ['C2-H-042 admonitions', 'class="admonition'],
    ['C2-H-075 the time element', '<time'],
    ['C2-H-075 C2-H-178 the abbr element and the abbreviation template', '<abbr'],
    ['C2-H-114 divs', 'data-carve-div'],
  ])('%s: every example that writes it imports back', (_name, marker) => {
    const result = examplesWith(marker)
    expect(result.count).toBeGreaterThan(0)
    expect(result.failing).toEqual([])
  })
})
