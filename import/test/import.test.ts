import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { format, validateTree } from '../../v2/src/index.ts'
import { ImportInputError, importDocument } from '../src/index.ts'

interface Fixture { name: string, html: string }
const fixtures = JSON.parse(readFileSync(join(import.meta.dirname, '../fixtures/html-shapes.json'), 'utf8')) as Fixture[]
const expectedHtmlSource: Record<string, string> = {
  'nested inline formatting': '*one /two `three`/*\n',
  'table groups and spans': '{footer-rows=1}\n|= Head |\n| A | B |\n| C |\n| Foot |\n',
  'definition list': ':: Term\n: Definition\n',
  'figure caption': '![Bars](chart.png)\n^ A chart\n',
  details: ':::\nMore\n\nHidden content\n:::\n',
  'language code': '```rust\nfn main() {}\n```\n',
  'GitHub task list': '{.contains-task-list}\n-{.task-list-item} [x] Done\n',
  'generated footnotes': 'Note[^1]\n\n[^1]: Text\n',
  'image descriptions': '![A dog](photo.jpg "Portrait")\n',
}

describe('Carve 0.2 importers', () => {
  it.each(['markdown', 'gfm', 'djot', 'html'] as const)(
    'C2-W-022 writes one line feed for empty and whitespace-only %s input', (from) => {
      for (const input of ['', ' ', '\t', '\n', ' \t\n']) {
        const result = importDocument(input, { from })
        validateTree(result.document)
        expect(result.source).toBe('\n')
      }
    })

  it('C2-A-167 keeps the saved inline importer case valid in every format', () => {
    const input = readFileSync(join(import.meta.dirname, '../../v2/proptest/regressions/import-inline-timeout.crv'), 'utf8')
    for (const from of ['markdown', 'gfm', 'djot', 'html'] as const) {
      const result = importDocument(input, { from })
      expect(() => validateTree(result.document)).not.toThrow()
      if (from === 'markdown') expect(format(result.source)).toBe(result.source)
    }
  })

  it('C2-W-134 returns writer refusal diagnostics with a valid imported tree', () => {
    const result = importDocument('``` \na\r\nb\n```', { from: 'djot' })
    expect(() => validateTree(result.document)).not.toThrow()
    expect(result.diagnostics.some((entry) => ['field-unspellable', 'structure-unspellable', 'writer-refused']
      .includes(entry.code))).toBe(true)
  })

  it('C2-W-022, C2-M-018 keeps one final line ending for imported HTML text', () => {
    const result = importDocument('a\n', { from: 'html' })
    expect(result.source).toBe('a\n')
    expect(result.diagnostics.some((entry) => entry.code === 'import-whitespace-normalized')).toBe(true)
  })

  it.each([
    '<p>\n    foo\n  </p>',
    '<p>\n \nfoo</p>',
    '<p><em>\nfoo</em></p>',
    '<ul><li><input type="checkbox"> foo\nbar\n</li></ul>',
    '<p>foo\n    bar</p>',
    '<p>a <b>b</b>\n  c</p>',
    '<p>a<br>\nb</p>',
    '<p>a<br>\n    b</p>',
    '<div>\n  foo\n\n  bar\n</div>',
    '<p> \nfoo</p>',
    '<ul>\n<li>a\n    b</li>\n</ul>',
  ])('C2-W-007 spells HTML line endings at inline edges: %s', (input) => {
    const result = importDocument(input, { from: 'html' })
    expect(result.diagnostics.some((entry) => ['field-unspellable', 'structure-unspellable', 'writer-refused']
      .includes(entry.code))).toBe(false)
    expect(result.source).not.toBe('')
  })

  it('C2-W-007 spells a nested HTML list with its supported spacing', () => {
    const result = importDocument('<ul><li>foo<ul><li>bar</li></ul></li></ul>', { from: 'html' })
    expect(result.diagnostics.some((entry) => ['field-unspellable', 'structure-unspellable', 'writer-refused']
      .includes(entry.code))).toBe(false)
    expect(result.source).toBe('- foo\n  - bar\n')
  })

  it('C2-W-007, C2-M-033 keeps a multi-paragraph list loose even with a nested list; a list of one item is tight', () => {
    const result = importDocument('<ul><li><p>a</p><p>b</p><ul><li>c</li></ul></li><li>d</li></ul>', { from: 'html' })
    const first = result.document.children[0]
    expect(first?.type === 'list' ? first.spacing : undefined).toBe('loose')
    const single = importDocument('<ul><li><p>a</p><p>b</p><ul><li>c</li></ul></li></ul>', { from: 'html' }).document.children[0]
    expect(single?.type === 'list' ? single.spacing : undefined).toBe('tight')
  })

  it.each(['<table><tr><td>a\nb</td></tr></table>',
    '<table><tr><td>a <b>x</b>\n b</td></tr></table>',
    '<table><tr><td><b>a\nb</b></td></tr></table>',
    '<table><tr><td><a href="http://x.y">a\nb</a></td></tr></table>',
    '<table><tr><td>a<br>t</td><td>b</td></tr></table>'])(
    'C2-W-007 spells an HTML table cell line ending: %s', (input) => {
      const result = importDocument(input, { from: 'html' })
      expect(result.diagnostics.some((entry) => ['field-unspellable', 'structure-unspellable', 'writer-refused']
        .includes(entry.code))).toBe(false)
      expect(result.diagnostics.some((entry) => entry.code === 'import-whitespace-normalized')).toBe(true)
      expect(format(result.source)).toBe(result.source)
    })

  it.each(['<pre>a\nb</pre>', '<pre><code>a</code></pre>'])(
    'C2-W-007 terminates an HTML preformatted code value: %s', (input) => {
      const result = importDocument(input, { from: 'html' })
      const first = result.document.children[0]
      expect(first?.type === 'code_block' ? first.value.endsWith('\n') : false).toBe(true)
      expect(result.diagnostics.some((entry) => ['field-unspellable', 'structure-unspellable', 'writer-refused']
        .includes(entry.code))).toBe(false)
    })

  it.each(['<p>\n&nbsp;foo</p>', '<p>foo&nbsp;\n</p>'])(
    'C2-W-007 preserves nonbreaking space at an HTML line edge: %s', (input) => {
      const result = importDocument(input, { from: 'html' })
      const first = result.document.children[0]
      expect(first?.type === 'paragraph' ? first.children.some((node) => node.type === 'text'
        && node.value.includes('\u00a0')) : false).toBe(true)
    })

  it('C2-W-134 names the refusal for an empty checkbox item', () => {
    const result = importDocument('<ul><li><input type="checkbox"> </li></ul>', { from: 'html' })
    const item = result.document.children[0]
    if (item?.type === 'list') expect(item.children[0]?.children).toEqual([])
    expect(result.diagnostics.some((entry) => entry.code === 'structure-unspellable')).toBe(true)
  })

  it('C2-W-134 names a writer refusal for an imported leading tab', () => {
    const result = importDocument('&#9;foo\n', { from: 'markdown' })
    validateTree(result.document)
    expect(result.diagnostics.some((entry) => entry.code === 'field-unspellable')).toBe(true)
  })

  it('C2-W-007 maps Markdown line breaks and code content to spellable nodes', () => {
    const lines = importDocument('line one\nline two\n', { from: 'markdown' })
    const paragraph = lines.document.children[0]
    expect(paragraph?.type).toBe('paragraph')
    if (paragraph?.type === 'paragraph') expect(paragraph.children.map((node) => node.type)).toEqual([
      'text', 'soft_break', 'text',
    ])
  })

  it.each([
    ['```js\nlet a = 1\n```\n', 'let a = 1\n'],
    ['```\na\n\n```\n', 'a\n\n'],
    ['```\n\n```\n', '\n'],
    ['> ```\n>\n> ```\n', '\n'],
    ['```\n\n', '\n'],
    ['```\r\r```', '\n'],
    ['> ```\n>\n>\n\nx\n', '\n\n'],
    ['- ```\n\n  \nx\n', '\n\n'],
  ])('C2-W-007 preserves Markdown fenced code lines: %s', (source, expected) => {
    const result = importDocument(source, { from: 'markdown' })
    const first = result.document.children[0]
    const code = first?.type === 'block_quote' ? first.children[0] :
      first?.type === 'list' ? first.children[0]?.children[0] : first
    expect(code?.type === 'code_block' ? code.value : undefined).toBe(expected)
  })

  it('C2-W-007 maps a lone carriage return to a soft break', () => {
    const result = importDocument('<p>a&#13;b</p>', { from: 'html' })
    const first = result.document.children[0]
    expect(first?.type === 'paragraph' ? first.children.map((node) => node.type) : []).toEqual([
      'text', 'soft_break', 'text',
    ])
  })
  it.each([
    ['C2-B-041', 'markdown', '0. zero\n'],
    ['C2-H-030', 'html', '<ol start="0"><li>zero</li></ol>'],
    ['C2-B-041', 'djot', '0. zero\n'],
  ] as const)('%s keeps a zero ordered-list start from %s', (_clause, from, input) => {
    const result = importDocument(input, { from })
    const first = result.document.children[0]
    expect(first?.type).toBe('list')
    if (first?.type === 'list') expect(first.marker.kind === 'ordered' ? first.marker.start : undefined).toBe(0)
    expect(result.source).toBe('{start=0}\n. zero\n')
  })

  it.each([
    ['<ol start=""><li>x</li></ol>', undefined, '. x\n'],
    ['<ol start="1"><li>x</li></ol>', undefined, '. x\n'],
    ['<ol start="2"><li>x</li></ol>', 2, '{start=2}\n. x\n'],
    ['<ol start="1e3"><li>x</li></ol>', undefined, '. x\n'],
    ['<ol start="0x10"><li>x</li></ol>', 0, '{start=0}\n. x\n'],
    ['<ol start=" -2junk"><li>x</li></ol>', undefined, '. x\n'],
  ] as const)('C2-H-030 distinguishes an HTML start attribute from zero: %s', (input, expected, source) => {
    const result = importDocument(input, { from: 'html' })
    const first = result.document.children[0]
    expect(first?.type).toBe('list')
    if (first?.type === 'list') expect(first.marker.kind === 'ordered' ? first.marker.start : undefined).toBe(expected)
    expect(result.source).toBe(source)
  })

  it('C2-A-098 gives a Djot smart punctuation node the glyph and the source of its kind', () => {
    const inlines = importDocument('a -- b ...', { from: 'djot' }).document.children[0]
    const smart = inlines?.type === 'paragraph' ? inlines.children.filter(node => node.type === 'smart_punctuation') : []
    expect(smart.map(node => [node.kind, node.glyph, node.source])).toEqual([
      ['en_dash', '\u2013', '--'], ['ellipsis', '\u2026', '...'],
    ])
  })

  it.each(['1234567890', '-3'])('C2-M-031 drops an ordered start outside 0 to 999999999: %s', (start) => {
    const result = importDocument(`<ol start="${start}"><li>a</li></ol>`, { from: 'html' })
    const first = result.document.children[0]
    expect(first?.type === 'list' && first.marker.kind === 'ordered' ? first.marker.start : 'none').toBeUndefined()
    expect(result.diagnostics.map(entry => entry.code)).toEqual(['import-attribute-dropped'])
  })

  it('C2-A-050 keeps numeric spans and heading levels without truthiness conversion', () => {
    const html = '<table><tr><td colspan="2" rowspan="2">A</td><td>B</td></tr><tr><td>C</td></tr></table>'
    const table = importDocument(html, { from: 'html' })
    const first = table.document.children[0]
    expect(first?.type).toBe('table')
    if (first?.type === 'table') {
      const group = first.children[0]
      if (group?.type === 'table_body') {
        const row = group.children[0]
        if (row?.type === 'table_row') expect([row.children[0]?.colspan, row.children[0]?.rowspan]).toEqual([2, 2])
      }
    }
    const headings = importDocument('<h1>One</h1><h6>Six</h6>', { from: 'html' })
    expect(headings.document.children.map(node => node.type === 'heading' ? node.level : undefined)).toEqual([1, 6])
    expect(headings.source).toBe('= One\n\n====== Six\n')
  })

  it('C2-M-039 reports HTML rowspan zero, whose end-of-group meaning has no direct count', () => {
    const input = '<table><tr><td rowspan="0">A</td></tr><tr><td>B</td></tr></table>'
    const result = importDocument(input, { from: 'html' })
    expect(result.diagnostics.some((entry) => entry.code === 'import-structure-repaired' && entry.foreignType === 'td')).toBe(true)
  })

  it('C2-A-050 keeps empty Djot link and image destinations as present fields', () => {
    const link = importDocument('[x]()\n', { from: 'djot' })
    const image = importDocument('![x]()\n', { from: 'djot' })
    const first = link.document.children[0]
    if (first?.type === 'paragraph' && first.children[0]?.type === 'link') expect(first.children[0].href).toBe('')
    const second = image.document.children[0]
    if (second?.type === 'paragraph' && second.children[0]?.type === 'image') expect(second.children[0].src).toBe('')
    expect([link.source, image.source]).toEqual(['[x]()\n', '![x]()\n'])
  })

  it('C2-A-050 keeps empty HTML link, title, id, and long description fields', () => {
    const result = importDocument('<div id=""><a href="" title="">x</a><img src="x" alt="A" longdesc=""></div>',
      { from: 'html' })
    const div = result.document.children[0]
    expect(div?.attrs?.id).toBe('')
    if (div?.type !== 'div') return
    const paragraph = div.children[0]
    if (paragraph?.type !== 'paragraph') return
    const link = paragraph.children[0]
    if (link?.type === 'link') expect([link.href, link.tooltip]).toEqual(['', ''])
    const imageParagraph = div.children[1]
    const image = imageParagraph?.type === 'paragraph' ? imageParagraph.children[0] : undefined
    if (image?.type === 'image') expect(image.longDescription?.[0]?.type).toBe('paragraph')
  })

  it.each(['html', 'markdown', 'djot'] as const)('C2-A-026 bounds 10,000 nested %s levels', from => {
    const input = from === 'html' ? '<div>'.repeat(10000) + 'x' + '</div>'.repeat(10000) :
      from === 'markdown' ? '> '.repeat(10000) + 'x\n' : '::: div\n'.repeat(10000) + 'x\n' + ':::\n'.repeat(10000)
    expect(() => importDocument(input, { from })).toThrow(ImportInputError)
    try { importDocument(input, { from }) } catch (error) {
      expect(error).toBeInstanceOf(ImportInputError)
      expect((error as Error).message).toMatch(/depth|nested/i)
    }
  })

  it('C2-W-101 reports an unreadable file as a categorized input error', () => {
    const missing = join(import.meta.dirname, 'missing-input.crv')
    const result = spawnSync(process.execPath, ['import/src/cli.ts', '--from', 'markdown', missing],
      { cwd: join(import.meta.dirname, '../..'), encoding: 'utf8' })
    expect(result.status).toBe(2)
    expect(result.stderr).toContain('carve[input-unreadable]:')
    expect(result.stderr).not.toContain('    at ')
  })

  it.each([
    ['markdown', '## Heading\n', '== Heading\n'],
    ['gfm', '- [x] done\n', '- [x] done\n'],
    ['djot', '*bold*\n', '*bold*\n'],
    ['html', '<p>Plain</p>', 'Plain\n'],
  ] as const)('C2-A-050 uses a hand-written source oracle for %s', (from, input, expected) => {
    expect(importDocument(input, { from }).source).toBe(expected)
  })
  it('C2-A-008 validates every imported root and writes stable source', () => {
    for (const from of ['markdown', 'gfm', 'djot', 'html'] as const) {
      const result = importDocument('<b>Hi</b>', { from })
      validateTree(result.document)
      expect(result.document.astVersion).toBe('2.0')
      expect(format(result.source)).toBe(result.source)
    }
  })

  it('C2-A-049 maps Markdown frontmatter and raw HTML to typed nodes', () => {
    const result = importDocument('---\ntitle: A\n---\n\n<div>\nHi\n</div>\n', { from: 'markdown' })
    expect(result.document.children[0]?.type).toBe('frontmatter')
    expect(result.document.children[1]?.type).toBe('raw_block')
    expect(result.source).toBe('---\ntitle: A\n---\n\n```=html\n<div>\nHi\n</div>\n```\n')
  })

  it('C2-A-060 maps GFM task status to task.mark', () => {
    const result = importDocument('- [x] done\n', { from: 'gfm' })
    const first = result.document.children[0]
    expect(first?.type).toBe('list')
    if (first?.type === 'list') expect(first.children[0]?.task?.mark).toBe('x')
    expect(result.source).toBe('- [x] done\n')
  })

  it('C2-A-066 maps GitHub alert quotes to admonitions', () => {
    const result = importDocument('> [!NOTE]\n> message\n', { from: 'gfm' })
    const first = result.document.children[0]
    expect(first?.type).toBe('admonition')
    if (first?.type === 'admonition') expect(first.kind).toBe('note')
    expect(result.source).toBe('::: note\nmessage\n:::\n')
  })

  it('C2-A-066 uses the typed admonition slot for a Markdown directive', () => {
    const result = importDocument(':::note\nhello\n:::\n', { from: 'markdown' })
    expect(result.document.children[0]?.type).toBe('admonition')
    expect(result.source).toBe('::: note\nhello\n:::\n')
  })

  it('C2-A-050 gives display math its paragraph role', () => {
    const result = importDocument('$$\nx + y\n$$\n', { from: 'markdown' })
    const first = result.document.children[0]
    if (first?.type === 'paragraph') expect(first.role).toBe('math')
    else expect(first?.type).toBe('paragraph')
    expect(result.source).toBe('$$`x + y`\n')
  })

  it('C2-A-050 maps Djot inline formatting and code blocks', () => {
    const result = importDocument('```js\nx\n```\n\n*bold*\n', { from: 'djot' })
    expect(result.document.children.some(node => node.type === 'code_block')).toBe(true)
    expect(result.source).toContain('js')
    expect(result.source).toBe('```js\nx\n```\n\n*bold*\n')
  })

  it('C2-A-050 maps every real-world HTML fixture to a valid tree', () => {
    for (const fixture of fixtures) {
      const result = importDocument(fixture.html, { from: 'html' })
      validateTree(result.document)
      expect(format(result.source), fixture.name).toBe(result.source)
      expect(result.source, fixture.name).toBe(expectedHtmlSource[fixture.name])
    }
  })

  it('C2-A-050 preserves HTML table groups and spanning facts', () => {
    const result = importDocument(fixtures[1]?.html ?? '', { from: 'html' })
    const table = result.document.children[0]
    expect(table?.type).toBe('table')
    if (table?.type !== 'table') return
    expect(table.children.map(group => group.type)).toEqual(['table_head', 'table_body', 'table_foot'])
    const head = table.children[0]
    if (head?.type === 'table_head') {
      const first = head.children[0]
      if (first?.type === 'table_row') expect(first.children[0]?.colspan).toBe(2)
    }
  })

  it('C2-A-050 keeps block content inside table cells even when source cannot spell it', () => {
    const result = importDocument('<table><tr><td><p>one</p><ul><li>two</li></ul></td></tr></table>', { from: 'html' })
    const table = result.document.children[0]
    if (table?.type !== 'table') return
    const body = table.children[0]
    if (body?.type !== 'table_body') return
    const row = body.children[0]
    if (row?.type !== 'table_row') return
    expect(row.children[0]?.children.map(node => node.type)).toEqual(['paragraph', 'list'])
    expect(result.diagnostics.some(node => node.channel === 'render-loss')).toBe(true)
    expect(result.source).toBe('| one two |\n')
  })

  it('C2-A-078 maps generated HTML footnotes to definitions', () => {
    const result = importDocument(fixtures[7]?.html ?? '', { from: 'html' })
    expect(result.document.children.some(node => node.type === 'footnote')).toBe(true)
    const paragraph = result.document.children[0]
    if (paragraph?.type === 'paragraph') expect(paragraph.children.some(node => node.type === 'footnote_ref')).toBe(true)
  })

  it('C2-A-050 reads MathML TeX and ruby annotations into typed nodes', () => {
    const math = importDocument('<math alttext="x+y"></math>', { from: 'html' })
    const ruby = importDocument('<p><ruby>字<rt>ji</rt></ruby></p>', { from: 'html' })
    const first = math.document.children[0]
    if (first?.type === 'paragraph') expect(first.children[0]?.type).toBe('math')
    expect(math.source).toBe('$`x+y`\n')
    const rubyParagraph = ruby.document.children[0]
    if (rubyParagraph?.type === 'paragraph') expect(rubyParagraph.children[0]?.type).toBe('ruby')
    expect(ruby.source).toBe('字(ji)\n')
  })

  it('C2-H-173 applies the engine URL policy to imported destinations', () => {
    const result = importDocument('<p><a href="javascript:alert(1)">bad</a></p>', { from: 'html' })
    expect(result.diagnostics.some(row => row.code === 'import-destination-denied')).toBe(true)
    // C2-W-011: a link with no destination has no spelling, so the denied link becomes its text.
    expect(result.document.children[0]).toMatchObject({ type: 'paragraph', children: [{ type: 'text', value: 'bad' }] })
    expect(result.source).toBe('bad\n')
    expect(result.diagnostics.map(row => row.code)).not.toContain('field-unspellable')
  })

  it('C2-M-055 takes no tree fact from a style that is no exact alignment declaration', () => {
    const result = importDocument('<p style="text-align: center" lang="en">center</p>', { from: 'html' })
    const first = result.document.children[0]
    expect(first?.data).toBeUndefined()
    expect(first?.lang).toBe('en')
    expect(result.source).toBe('{:en style="text-align: center"}\ncenter\n')
  })

  it('C2-A-031 carries full HTML document language to the root', () => {
    const result = importDocument('<!doctype html><html lang="fr"><body><p>Bonjour</p></body></html>', { from: 'html' })
    expect(result.document.lang).toBe('fr')
    expect(result.document.children[0]?.type).toBe('paragraph')
    expect(result.source).toBe('Bonjour\n')
  })

  it('C2-A-173, C2-M-066 records a dropped raw HTML element with a foreign type and range', () => {
    const result = importDocument('<input type="text">', { from: 'html' })
    const finding = result.diagnostics.find(row => row.code === 'import-element-dropped')
    expect(finding?.foreignType).toBe('input')
    expect(finding?.range).toEqual({ startOffset: 0, endOffset: 19 })
    expect(result.source).toBe('\n')
  })
})
