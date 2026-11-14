// Edges that the mutation run found untested: the ends of character ranges, the bounds of the
// reader, the details of equality, of an include directive and of the URL filter.
import { describe, expect, it } from 'vitest'
import {
  type Block, type BlockExtensionNode, type DocumentNode, type ImageNode, type Inline, type InlineExtensionNode, type LinkNode,
  type TableCellNode,
} from '../src/ast.ts'
import { decodeTree, encodeEnvelope, treesEqual } from '../src/ast-json.ts'
import { CarveTreeError, MAX_TREE_DEPTH, validateTree } from '../src/ast-validate.ts'
import { parse, render, utf8Length } from '../src/index.ts'
import { slugify } from '../src/slug.ts'
import { EXAMPLES } from './support/conformance.ts'
import { asNode, blocksOf, childrenOf, fieldOf, inlinesOf, ofType } from './support/nodes.ts'
import { at, block, blocks, documentOf, inlines, paragraph, placedTree, resolved, text, tree } from './support/tree.ts'
import { checkTree } from './support/tree-checks.ts'

function refusal(document: unknown): string | null {
  try {
    validateTree(document)
    return null
  } catch (error) {
    if (!(error instanceof CarveTreeError)) throw error
    return `${error.path}: ${error.reason}`
  }
}

describe('the examples of the specification', () => {
  it('every example holds the tree properties, also with carriage returns and with characters of two to four bytes', () => {
    for (const example of EXAMPLES) {
      expect([example.number, checkTree(example.input)]).toEqual([example.number, null])
      expect(checkTree(example.input.replaceAll('\n', '\r\n'))).toBeNull()
      expect(checkTree(example.input.replaceAll('a', 'é').replaceAll('b', '€').replaceAll('x', '😀'))).toBeNull()
    }
  })
})

describe('character ranges', () => {
  it('a slug keeps the first and the last digit and letter, and drops the neighbors of each range', () => {
    expect(slugify('0 9 A Z a z', 'keep-case')).toBe('s-0-9-A-Z-a-z')
    expect(slugify('a/b:c@d[e`f{g', 'keep-case')).toBe('a-b-c-d-e-f-g')
    expect(slugify('a\u0080b', 'keep-case')).toBe('a\u0080b')
    expect(slugify('a\u007fb', 'keep-case')).toBe('a-b')
  })

  it('a slug drops every bidi control and zero-width character, and keeps their neighbors', () => {
    for (const code of [0x202a, 0x202e, 0x2066, 0x2069, 0x200b, 0x200c, 0x200d, 0x2060, 0xfeff, 0xad]) {
      expect(slugify(`a${String.fromCodePoint(code)}b`, 'keep-case')).toBe('ab')
    }
    for (const code of [0x2029, 0x202f, 0x2065, 0x206a]) expect(slugify(`a${String.fromCodePoint(code)}b`, 'keep-case')).toBe(`a${String.fromCodePoint(code)}b`)
  })

  it('the ascii slug drops the first and the last combining mark and keeps the characters around the range', () => {
    expect(slugify('a\u0300b\u036fc', 'ascii')).toBe('abc')
    expect(slugify('x\u02ffy\u0370z', 'ascii')).toBe('x-y-z')
  })

  it('a term of the first and last digits and letters is an abbreviation, as a whole word', () => {
    const src = '*[Az09]: x\n*[0]: y\n*[z]: w\n\nAz09 0 z Az09é éAz09 @Az09 [Az09 z'
    expect(inlinesOf(blocks(src)[3]).filter((node) => node.type === 'abbreviation').map((node) => node.key)).toEqual(['Az09', '0', 'z', 'Az09', 'z'])
  })

  it('an abbreviation sees the character across an element edge, a comment and the end of a note, and an atom is a boundary', () => {
    const terms = (src: string): number => JSON.stringify(blocks(`*[HT]: x\n\n${src}`)[1]).split('"abbreviation"').length - 1
    expect([terms('{*HT*}'), terms('x{*HT*}'), terms('{*HT*}x'), terms('{*x*}HT'), terms('HT{*x*}')]).toEqual([1, 0, 0, 0, 0])
    expect([terms('x{% c %}HT'), terms('HT{% c %}x'), terms('{% c %}HT{% c %}')]).toEqual([0, 0, 1])
    expect([terms('`x`HT'), terms('HT`x`'), terms('x^[HT]'), terms('^[HT]x'), terms('HT^[x]')]).toEqual([1, 1, 1, 1, 1])
    expect([terms('{*{/x/}*}HT'), terms('HT{*{/x/}*}'), terms('{**}HT')]).toEqual([0, 0, 1])
  })

  it('an abbreviation behind an escape has the position of its own characters', () => {
    const src = '*[HT]: x\n\na\\*b HT c\\\\ HT'
    const terms = inlinesOf(placedTree(src).children[1]).filter((node) => node.type === 'abbreviation')
    expect(terms.map((node) => [node.pos!.startOffset, node.pos!.endOffset])).toEqual([[15, 17], [22, 24]])
    expect(inlinesOf(placedTree('*[HT]: x\n\nHT').children[1])[0]?.pos?.startColumn).toBe(1)
  })

  it('the number mark of a caption is bare before the end, whitespace and punctuation, and not before a name character', () => {
    const mark = (tail: string): boolean => JSON.stringify(ofType(block(`| a |\n^ T #${tail}`), 'table').caption).includes('caption_number')
    expect(['', ' x', ': x', '. x', '/', '@', '[', '`x`', '{'].map(mark)).toEqual(new Array(9).fill(true))
    expect(['0', '9', 'A', 'Z', 'a', 'z', '_', '-'].map(mark)).toEqual(new Array(8).fill(false))
    expect(at(block('| a |\n^ # x'), 'caption.children.0.children')).toEqual([{ type: 'caption_number' }, text(' x')])
    expect(at(block('| a |\n^ x #y #'), 'caption.children.0.children')).toEqual([text('x '), { type: 'tag', name: 'y' }, text(' '), { type: 'caption_number' }])
    expect(at(block('| a |\n^ \\\\# x'), 'caption.children.0.children')).toEqual([text('\\'), { type: 'caption_number' }, text(' x')])
    expect(at(resolved('| a |\n^ # x').document, 'children.0.caption.children.0.children.0.n')).toBe(1)
  })

  it('the bytes of a character are those of UTF-8 at every boundary', () => {
    for (const code of [0x7f, 0x80, 0x7ff, 0x800, 0xd7ff, 0xe000, 0xffff, 0x10000, 0x10ffff]) {
      const char = String.fromCodePoint(code)
      const src = `${char} *${char}*\n${char}${char} /y/`
      expect([code, utf8Length(src)]).toEqual([code, Buffer.byteLength(src)])
      expect([code, checkTree(src)]).toEqual([code, null])
    }
  })

  it('positions on later lines and at the start of a line are found again after a step back', () => {
    const src = 'é\n\n{.a}\n%% c\nb é\n\né *x*\n'
    expect(checkTree(src)).toBeNull()
    const starts = placedTree(src).children!.map((node) => [node.pos!.startLine, node.pos!.startColumn, node.pos!.startOffset])
    expect(starts).toEqual([[1, 1, 0], [4, 1, 9], [3, 1, 4], [7, 1, 20]])
  })

  it('text is escaped at the four characters and at nothing beside them', () => {
    expect(render('a=b?c;d>e<f&g')).toBe('<p>a=b?c;d&gt;e&lt;f&amp;g</p>')
    expect(render(documentOf(paragraph('\u00a0\u009f\u00a1')))).toBe('<p>&nbsp;\u009f\u00a1</p>')
    expect(render(documentOf(paragraph({ type: 'span', children: [], attrs: { keyValues: [['k', '\u00a0<>&"\'?']] } })))).toBe('<p><span k="\u00a0&lt;&gt;&amp;&quot;&apos;?"></span></p>')
  })

  it('a scheme is read through control characters and whitespace, from its first to its last allowed character', () => {
    const link = (href: string, deny: string[]): string => render(documentOf(paragraph({ type: 'link', href, children: [] })), { urlPolicy: { deny } })
    const denied = '<p><a href=""></a></p>'
    for (const scheme of ['a0', 'a9', 'az', 'zA', 'aZ', 'a+b', 'a-b', 'a.b']) expect([scheme, link(`${scheme}:x`, [scheme])]).toEqual([scheme, denied])
    for (const gap of ['\u0000', ' ', '\u007f', '\u009f', '\u00a0', '\u2028', '\u2029']) expect([gap, link(`j${gap}s:x`, ['js'])]).toEqual([gap, denied])
    for (const other of ['!', '\u00a1', '\u2027', '/', '@']) expect(link(`j${other}s:x`, ['js'])).not.toBe(denied)
    expect(link('1a:x', ['1a'])).not.toBe(denied)
    expect(link(':x', [''])).not.toBe(denied)
    expect(link('js', ['js'])).not.toBe(denied)
  })
})

describe('more edges', () => {
  it('a character outside ASCII is no scheme character, so the destination has no scheme and passes', () => {
    expect(render('[x](jévéscript:y) [z](javascript:y)')).toBe('<p><a href="jévéscript:y">x</a> <a href="">z</a></p>')
    // Under an allow list a destination with no scheme passes, and a character that is no scheme character ends the test.
    expect(render('[x](jévé:y) [z](a/b:c) [w](ftp:y)', { urlPolicy: { allow: ['https'] } })).toBe('<p><a href="jévé:y">x</a> <a href="a/b:c">z</a> <a href="">w</a></p>')
  })

  it('text and an abbreviation at the first character of the source have a position', () => {
    const [term, rest] = inlinesOf(placedTree('HT x\n\n*[HT]: y').children[0])
    expect([term!.type, term!.pos!.startOffset, term!.pos!.endOffset, rest!.pos!.startOffset]).toEqual(['abbreviation', 0, 2, 2])
    expect(inlinesOf(placedTree('xa').children[0])[0]?.pos).toMatchObject({ startOffset: 0, endOffset: 2, startColumn: 1 })
  })

  it('text merged from an escape and its neighbors spans all of them, and doubled letters are no escape', () => {
    expect(inlinesOf(placedTree('a\\*b').children[0])[0]?.pos).toMatchObject({ startOffset: 0, endOffset: 4 })
    const terms = inlinesOf(placedTree('*[HT]: x\n\naab HT ccd HT').children[1]).filter((node) => node.type === 'abbreviation')
    expect(terms.map((node) => node.pos!.startOffset)).toEqual([14, 21])
    expect(JSON.stringify(ofType(block('| a |\n^ aab #: x'), 'table').caption)).toContain('caption_number')
  })

  it('terms that end and start at the last capital and the first small letter are found', () => {
    expect(inlinesOf(blocks('*[Za]: x\n*[aZ]: y\n\nZa aZ')[2]).map((node) => fieldOf(node, 'key') ?? fieldOf(node, 'value'))).toEqual(['Za', ' ', 'aZ'])
  })

  it('a number sign glued behind a letter is text, and no mark before a name character', () => {
    for (const char of ['0', '9', 'A', 'Z', 'a', 'z', '_', '-']) {
      expect([char, JSON.stringify(ofType(block(`| a |\n^ Ta#${char}`), 'table').caption).includes('caption_number')]).toEqual([char, false])
    }
    expect(at(block('| a |\n^ T #:'), 'caption.children.0.children')).toEqual([text('T '), { type: 'caption_number' }, text(':')])
  })

  it('a table of head rows alone has no body, and a row that ends at its line ending has a position', () => {
    expect(ofType(block('|= a |'), 'table').children.map((group) => group.type)).toEqual(['table_head'])
    expect(asNode(at(placedTree('| a |\n'), 'children.0.children.0.children.0')).pos).toMatchObject({ startOffset: 0, endOffset: 5 })
    expect(checkTree('| ^ | < |\n+ a |')).toBeNull()
    expect(asNode(at(placedTree('| ^ | < |\n+ a |'), 'children.0.children.0.children.0.children.0')).pos).toBeUndefined()
  })

  it('the source line is written on block elements only', () => {
    expect(render('a *b* [c]{.d}', { sourceLines: true })).toBe('<p data-source-line="1">a <strong>b</strong> <span class="d">c</span></p>')
  })

  it('an object with more fields than another is not equal to it, and an empty quoted option value is empty', () => {
    expect(treesEqual(documentOf({ ...paragraph(), data: { a: 1 } }), documentOf({ ...paragraph(), data: { a: 1, b: 2 } }))).toBe(false)
    expect(treesEqual(documentOf({ ...paragraph(), data: { a: 1, b: 2 } }), documentOf({ ...paragraph(), data: { a: 1 } }))).toBe(false)
    expect(ofType(block('{{ a.crv @rows:"" @region:"x" }}'), 'include').options).toEqual([['region', 'x'], ['rows', '']])
  })
})

describe('the reader at its bounds', () => {
  const nest = (levels: number): DocumentNode => {
    let node: Block = paragraph('a')
    for (let level = 0; level < levels; level++) node = { type: 'block_quote', children: [node] }
    return documentOf(node)
  }

  it('accepts a tree at the depth bound and refuses the next level', () => {
    expect(refusal(nest(MAX_TREE_DEPTH - 2))).toBeNull()
    expect(refusal(nest(MAX_TREE_DEPTH - 1))).not.toBeNull()
    expect(MAX_TREE_DEPTH).toBe(416)
  })

  it('accepts metadata of 64 levels, 4096 resource references and 32 nested fallbacks, and refuses one more', () => {
    const metadata = (levels: number): DocumentNode => {
      let value: Record<string, unknown> = { a: 1 }
      for (let level = 1; level < levels; level++) value = { a: value }
      return documentOf({ ...paragraph(), metadata: value })
    }
    expect([refusal(metadata(64)), refusal(metadata(65)) === null]).toEqual([null, false])
    const references = (count: number): DocumentNode => documentOf(paragraph(
      { type: 'inline_extension', name: 'a.b', children: [], resourceIds: Array.from({ length: count - 1 }, () => 'r') }, { type: 'image', resourceId: 'r' },
    ))
    expect([refusal(references(4096)), refusal(references(4097)) === null]).toEqual([null, false])
    const fallbacks = (levels: number): DocumentNode => {
      let node: Inline = text('x')
      for (let level = 0; level < levels; level++) node = { type: 'inline_extension', name: 'a.b', children: [], fallback: [node] }
      return documentOf(paragraph(node))
    }
    expect([refusal(fallbacks(32)), refusal(fallbacks(33)) === null]).toEqual([null, false])
  })

  it('bounds the payload of an extension node by its string values', () => {
    const big = 'x'.repeat(8 * 1024 * 1024)
    const node = (payload: { format: string, value: string }[]): DocumentNode => documentOf(paragraph({ type: 'inline_extension', name: 'a.b', children: [], payload }))
    expect(refusal(node([{ format: 'a', value: big }]))).toBeNull()
    expect(refusal(node([{ format: 'a', value: big }, { format: 'b', value: 'y' }]))).toBe('/children/0/children/0/payload: an extension payload above 8 MiB')
  })

  it('refuses a count that is negative or no integer, a pair that is no pair, and a ruby pair that is none', () => {
    const heading = (level: unknown): DocumentNode => documentOf({ type: 'heading', level, children: [] } as unknown as Block)
    expect([refusal(heading(0)), refusal(heading(-1)) === null, refusal(heading(1.5)) === null, refusal(heading('1')) === null]).toEqual([null, false, false, false])
    const include = (options: unknown): DocumentNode => documentOf({ type: 'include', path: 'a', options } as unknown as Block)
    expect(refusal(include([['a', 'b']]))).toBeNull()
    for (const bad of [[['a']], [['a', 1]], [[1, 'b']], ['ab'], [['a', 'b', 'c']]]) expect(refusal(include(bad))).toBe('/children/0/options/0: not a pair of two strings')
    const ruby = (pair: unknown): DocumentNode => documentOf(paragraph({ type: 'ruby', pairs: [pair] } as unknown as Inline))
    expect(refusal(ruby({ type: 'rubyPair', base: [text('a')], annotation: [] }))).toBeNull()
    expect(refusal(ruby({ type: 'pair', base: [], annotation: [] }))).toBe('/children/0/children/0/pairs/0: not a rubyPair')
    expect(refusal(ruby('x'))).toBe('/children/0/children/0/pairs/0: not a rubyPair')
  })

  it('checks the slots and the fallback of an extension node by its role, and the fields that depend on each other', () => {
    const inline: InlineExtensionNode = { type: 'inline_extension', name: 'a.b', children: [], slots: { s: [text('x')] }, fallback: [text('y')] }
    expect(refusal(documentOf(paragraph(inline)))).toBeNull()
    expect(refusal(documentOf(paragraph({ ...inline, slots: { s: [paragraph()] } })))).toBe('/children/0/children/0/slots/s/0: paragraph does not stand here')
    const blockNode: BlockExtensionNode = { type: 'block_extension', name: 'a.b', children: [], slots: { s: [paragraph()] }, fallback: [] }
    expect(refusal(documentOf(blockNode))).toBeNull()
    expect(refusal(documentOf({ ...blockNode, slots: { s: [text('x')] } }))).toBe('/children/0/slots/s/0: text does not stand here')
    const link = (fields: Partial<LinkNode>): string | null => refusal(documentOf(paragraph({ type: 'link', children: [], ...fields })))
    expect([link({}), link({ key: 'a', namespace: 'link', form: 'full' })]).toEqual([null, null])
    for (const fields of [{ key: 'a' }, { namespace: 'link' }, { form: 'full' }, { key: 'a', form: 'full' }, { namespace: 'link', form: 'full' }] satisfies Partial<LinkNode>[]) expect(link(fields)).not.toBeNull()
    const ordered = (marker: object): string | null => refusal(documentOf({ type: 'list', marker, spacing: 'tight', children: [] } as unknown as Block))
    expect([ordered({ kind: 'ordered' }), ordered({ kind: 'ordered', style: 'a', delimiter: ')', start: 3 })]).toEqual([null, null])
    expect([ordered({ kind: 'ordered', style: 'x' }), ordered({ kind: 'ordered', delimiter: ':' }), ordered({ kind: 'ordered', start: 1.5 })].every((reason) => reason !== null)).toBe(true)
  })
})

describe('equality in detail', () => {
  const link = (fields: Partial<LinkNode>): DocumentNode => documentOf(paragraph({ type: 'link', children: [], ...fields }))

  it('a destination is a resolution result only on a reference use', () => {
    const reference = { key: 'a', namespace: 'link', form: 'full' } satisfies Partial<LinkNode>
    expect(treesEqual(link({ ...reference, href: '/u' }), link(reference))).toBe(true)
    expect(treesEqual(link({ href: '/u' }), link({ href: '/v' }))).toBe(false)
    expect(treesEqual(link({ href: '/u' }), link({}))).toBe(false)
    expect(treesEqual(link({ ...reference, tooltip: 'a' }), link(reference))).toBe(false)
    const image = (fields: Partial<ImageNode>): DocumentNode => documentOf(paragraph({ type: 'image', ...fields }))
    expect(treesEqual(image({ ...reference, src: '/u' }), image(reference))).toBe(true)
    expect(treesEqual(image({ src: '/u', alt: 'a' }), image({ src: '/v', alt: 'a' }))).toBe(false)
    const xref = (href?: string): DocumentNode => documentOf(paragraph({ type: 'xref', key: 'a', namespace: 'heading', ...(href === undefined ? {} : { href }) }))
    expect(treesEqual(xref('#a'), xref())).toBe(true)
  })

  it('a number is a resolution result on a footnote, and a field of a display equation', () => {
    const note = (number?: number): DocumentNode => documentOf(paragraph({ type: 'inline_footnote', children: [], ...(number === undefined ? {} : { number }) }))
    expect(treesEqual(note(1), note())).toBe(true)
    const ref = (number?: number): DocumentNode => documentOf(paragraph({ type: 'footnote_ref', key: 'n', namespace: 'footnote', ...(number === undefined ? {} : { number }) }))
    expect(treesEqual(ref(1), ref(2))).toBe(true)
    const math = (number: number): DocumentNode => documentOf(paragraph({ type: 'math', display: true, value: 'x', number }))
    expect(treesEqual(math(1), math(2))).toBe(false)
  })

  it('a span count is compared where no span mark is written, and not where one is', () => {
    const table = (cells: TableCellNode[]): DocumentNode => documentOf({ type: 'table', columns: [], children: [{ type: 'table_body', children: [{ type: 'table_row', children: cells }] }] })
    const cell = (fields: Partial<TableCellNode> = {}): TableCellNode => ({ type: 'table_cell', header: false, children: [], ...fields })
    expect(treesEqual(table([cell({ colspan: 2 })]), table([cell()]))).toBe(false)
    expect(treesEqual(table([cell({ colspan: 2 }), cell({ span: 'colspan' })]), table([cell(), cell({ span: 'colspan' })]))).toBe(true)
    expect(treesEqual(table([cell({ colspan: 2 }), cell({ span: 'colspan' })]), table([cell({ colspan: 2 }), cell()]))).toBe(false)
    expect(treesEqual(tree('| a | < |'), tree('| a | b |'))).toBe(false)
  })

  it('a field that one tree lacks, a list against a node and null are no match', () => {
    expect(treesEqual(documentOf(paragraph('a')), documentOf({ ...paragraph('a'), lang: 'en' }))).toBe(false)
    expect(treesEqual(documentOf({ ...paragraph(), data: { a: null } }), documentOf({ ...paragraph(), data: { a: {} } }))).toBe(false)
    expect(treesEqual(documentOf({ ...paragraph(), data: { a: {} } }), documentOf({ ...paragraph(), data: { a: null } }))).toBe(false)
    expect(treesEqual(documentOf({ ...paragraph(), data: { a: [] } }), documentOf({ ...paragraph(), data: { a: {} } }))).toBe(false)
    expect(treesEqual(documentOf({ ...paragraph(), data: { a: {} } }), documentOf({ ...paragraph(), data: { a: [] } }))).toBe(false)
    const withB = documentOf({ ...paragraph(), data: { a: 1, b: 2 } })
    expect(treesEqual(withB, documentOf({ ...paragraph(), data: { a: 1, c: 2 } }))).toBe(false)
  })

  it('an envelope carries the extensions of its document, and a bare tree with a field named document is no envelope', () => {
    const declared: DocumentNode = { ...documentOf(), extensions: [{ name: 'a.b', required: false }] }
    expect(JSON.parse(encodeEnvelope(declared))).toHaveProperty('extensions', declared.extensions)
    expect(JSON.parse(encodeEnvelope(documentOf()))).not.toHaveProperty('extensions')
    expect(() => decodeTree('{"type":"document","astVersion":"2.0","children":[],"document":{}}')).toThrow('/document: not a field of document')
    expect(() => decodeTree('null')).toThrow(CarveTreeError)
  })
})

describe('one-line blocks in detail', () => {
  it('an include directive reads quoted values and an at-sign that starts the next option, and a part that is no option makes it text', () => {
    expect(ofType(block('{{ a.crv @cols:"p q" @code:\'r+s\' @shift:1@lines:2-3 }}'), 'include').options).toEqual([['lines', '2-3'], ['cols', '"p q"'], ['shift', '1'], ['code', 'r+s']])
    expect(block('{{ a.crv plain @code }}').type).toBe('paragraph')
    expect(block('{{ a.crv @:v }}').type).toBe('paragraph')
    expect(block('{{ a.crv @rows: }}').type).toBe('paragraph')
    expect(ofType(block('{{ a.crv @rows:"a \\" @b" }}'), 'include').options).toEqual([['rows', 'a " @b']])
    expect(block('{{ a.crv @rows:"x }}').type).toBe('paragraph')
    expect(block('{{ a.crv#s@code:v }}')).toEqual({ type: 'include', path: 'a.crv', section: 's', options: [['code', 'v']] })
    expect(block('{{ "a \\" b.crv" #s }}')).toEqual({ type: 'include', path: 'a " b.crv', section: 's' })
    expect(block('{{ a.crv }}  ')).toEqual({ type: 'include', path: 'a.crv' })
    expect(render('{{ a.crv   @code:v }}')).toBe('<p>{{ a.crv @code:v }}</p>')
  })

  it('a link definition reads a title behind its destination, and one with no destination', () => {
    expect(block('[a]: /u  "T \\" x"')).toEqual({ type: 'link_reference_definition', key: 'a', namespace: 'link', href: '/u', title: 'T " x' })
    expect(block('[a]: "T"')).toEqual({ type: 'link_reference_definition', key: 'a', namespace: 'link', href: '', title: 'T' })
    expect(block('[a]: /u ')).toEqual({ type: 'link_reference_definition', key: 'a', namespace: 'link', href: '/u' })
  })

  it('a comment drops the spaces and tabs at its end, and the brace block of a cell that holds only its alignment mark is read', () => {
    expect(ofType(blocksOf(block('> %% a \t '))[0], 'comment').value).toBe('a')
    expect(ofType(blocksOf(block('> %%'))[0], 'comment').value).toBe('')
    expect(at(block('|={>} a |{~}{.x} b |'), 'children.0.children.0.children')).toMatchObject([{ align: 'right' }, { align: 'center', attrs: { classes: ['x'] } }])
    expect(at(block('*{.i} a\n\n3){.j} b'), 'children.0.attrs')).toEqual({ classes: ['i'] })
    expect(at(blocks('*{.i} a\n\n3){.j} b')[1], 'children.0.attrs')).toEqual({ classes: ['j'] })
  })

  it('only a plain div with the class is a hard-break block, and a block image or math block holds nothing else', () => {
    expect(at(block('{.hardbreaks}\n::: note\na\nb\n:::'), 'children.0.children.1.type')).toBe('soft_break')
    expect(at(block('::: \\\n> a\n> b\n:::'), 'children.0.children.0.children.1.type')).toBe('hard_break')
    expect(ofType(block('![a](b)\\'), 'paragraph').blockImage).toBeUndefined()
    expect(ofType(block('$$`x` `y`'), 'paragraph').blockMath).toBeUndefined()
    expect(ofType(block('$`x`'), 'paragraph').blockMath).toBeUndefined()
  })

  it('a column is authored when the source spells its alignment or its width', () => {
    expect(ofType(block('{aligns="left"}\n| a | b |'), 'table').columns).toEqual([{ type: 'table_column', align: 'left', authored: true }, { type: 'table_column' }])
    expect(ofType(block('{widths=",40"}\n| a | b |'), 'table').columns).toEqual([{ type: 'table_column' }, { type: 'table_column', width: 0.4, authored: true }])
  })

  it('an inline footnote in a joined cell keeps its content, and text joined from two lines has no position', () => {
    const cell = asNode(at(placedTree('| a^[b *c*] |\n+ d |'), 'children.0.children.0.children.0.children.0'))
    expect(JSON.stringify(cell)).not.toContain('"pos"')
    expect(inlinesOf(childrenOf(cell)[0]).map((node) => node.type)).toEqual(['text', 'inline_footnote', 'text'])
    expect(inlines('a {.x}\nb')[0]).toEqual(text('a {.x}'))
  })
})

describe('resolution and rendering in detail', () => {
  it('the id of a footnote reference is an id of the document, and that of an unresolved image is not', () => {
    const ids = (src: string): unknown[] => resolved(src).document.children!.filter((node) => node.type === 'heading').map((node) => node.generatedId)
    expect(ids('a[^n]{#T}\n\n# T\n\n[^n]: x')).toEqual(['T-2'])
    expect(ids('x ![i][nope]{#T}\n\n# T')).toEqual(['T'])
    expect(ids('x [i](u){#T}\n\n# T')).toEqual(['T-2'])
  })

  it('the first heading or caption of an id is the target of a cross-reference', () => {
    const texts = (src: string): unknown[] => [...resolved(src).resolution.xrefText.values()]
    expect(texts('{#a}\n# One\n\n{#a}\n# Two\n\n</#a>')).toEqual(['One'])
    expect(texts('{#a}\n| x |\n^ T #\n\n{#a}\n| y |\n^ U #\n\n</#a>')).toEqual(['T 1'])
    expect(texts('{#a}\n# H\n\n{#a}\n| y |\n^ U #\n\n</#a>')).toEqual(['H'])
    expect(texts('{#a}\n| y |\n^ #\n\n</#a>')).toEqual(['1'])
  })

  it('the label of a task box is the text of the paragraphs and headings of the item', () => {
    expect(render('- [x] a\n\n  # b\n  - c')).toContain('aria-label="a b"')
    expect(render('- [ ] > q')).toContain('aria-label=""')
  })

  it('an align key is written as a style where no style key stands, and behind the style key where one does', () => {
    expect(render('{align=left k=v}\np')).toBe('<p style="text-align: left;" k="v">p</p>')
    expect(render('{k=v align=left style="a: b;"}\np')).toBe('<p k="v" style="a: b; text-align: left;">p</p>')
    expect(render('{style=""  align=left}\np')).toBe('<p style="text-align: left;">p</p>')
  })

  it('the language of a definition goes to a reference that has none, and an empty social URL leaves the span', () => {
    expect(render('[a][r] [b][r]{:fr}\n\n{:en}\n[r]: /u')).toBe('<p><a href="/u" lang="en">a</a> <a href="/u" lang="fr">b</a></p>')
    expect(render('@a', { social: { resolveMention: () => '' } })).toBe('<p><span class="mention"><strong>@a</strong></span></p>')
    expect(render('@a', { social: { resolveMention: () => undefined, mentionUrl: '/u/{name}' } })).toContain('href="/u/a"')
  })

  it('a block with a language and no attribute still writes it, and a div of a supplied tree takes no class from a stray kind', () => {
    expect(render('{:en}\n***')).toBe('<hr lang="en">')
    expect(render(documentOf({ type: 'div', children: [] }))).toBe('<div>\n\n</div>')
    expect(render(parse('::: toc\n:::\n\n::: note\n:::'))).toContain('<div class="toc">')
  })
})
