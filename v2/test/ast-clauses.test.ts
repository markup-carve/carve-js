// One test per clause of spec/0.2/ast.md that states behavior of the tree a parser builds, of its
// JSON form and of a reader. The clauses on resolution are in resolve-clauses.test.ts, those on
// positions in positions.test.ts.
import { describe, expect, it } from 'vitest'
import { type Block, type CaptionNode, type CitationNode, type CodeBlockNode, type DivNode, type DocumentNode, type FootnoteNode, type Inline, type InlineExtensionNode, type ListItemNode, type ListNode, type Node, type ParagraphNode, type TableCellNode, type TableRowNode } from '../src/ast.ts'
import { decodeTree, encodeEnvelope, encodeTree, treesEqual } from '../src/ast-json.ts'
import { CarveTreeError, MAX_TREE_DEPTH, validateTree } from '../src/ast-validate.ts'
import { childrenOf, inlinesOf, ofType } from './support/nodes.ts'
import { at, block, blocks, documentOf, inlines, paragraph, placedTree, text, tree } from './support/tree.ts'

/** The reason a reader gives for refusing `document`, with the path, or null when it accepts it. */
function refusal(document: unknown): string | null {
  try {
    validateTree(document)
    return null
  } catch (error) {
    if (!(error instanceof CarveTreeError)) throw error
    return `${error.path}: ${error.reason}`
  }
}

function types(nodes: readonly Node[]): string[] {
  return nodes.map((node) => node.type)
}

describe('tree and sidecars', () => {
  it('C2-A-001, C2-A-002: spelling that changes no output is not in the tree', () => {
    expect(tree('> a')).toEqual(tree('::: >\na\n:::'))
    expect(tree('1. a')).toEqual(tree('. a'))
    expect(tree('# T')).toEqual(tree('= T'))
  })

  it('C2-A-003, C2-A-004: a tree holds no sidecar, so two spellings of one document are equal', () => {
    expect(treesEqual(tree('| a |\n+ b |'), tree('| a b |'))).toBe(true)
    expect(Object.keys(tree('a'))).toEqual(['type', 'astVersion', 'children'])
  })

  it('C2-A-006, C2-A-007: every node and field of a parsed tree is one the contract names', () => {
    const src = '{#i .c k=v}\n- [x] a *b* `c` [d](e) ![f](g) $`h` @i #j :k: </#l> [^m] ^[n] "o" \\ p\\\n  q\n\n| a |={>} b |\n^ T #: c\n\n::: note "t"\nx\n:::\n\n:: t\n: d\n\n[^m]: n\n[r]: /u\n*[A]: b\n'
    expect(refusal(placedTree(src))).toBeNull()
  })
})

describe('root, envelope and versions', () => {
  it('C2-A-008, C2-A-011: the root is a document with children and the version; definitions and frontmatter are children', () => {
    const root = tree('---\na: b\n---\n\ntext\n\n[r]: /u\n[^n]: x\n*[A]: b')
    expect([root.type, root.astVersion]).toEqual(['document', '2.0'])
    expect(types(root.children)).toEqual(['frontmatter', 'paragraph', 'link_reference_definition', 'footnote', 'abbreviation_def'])
  })

  it('C2-A-009: no other root field is allowed', () => {
    expect(refusal({ ...documentOf(), title: 'x' })).toBe('/title: not a field of document')
  })

  it('C2-A-010: srcByteLength is the number of source bytes, and zero for an empty source', () => {
    expect(placedTree('é').srcByteLength).toBe(2)
    expect(placedTree('').srcByteLength).toBe(0)
    expect(tree('é').srcByteLength).toBeUndefined()
  })

  it('C2-A-012, C2-A-013: an envelope wraps the tree and does not change it', () => {
    const root = tree('a')
    const envelope = JSON.parse(encodeEnvelope(root)) as { astVersion: string, document: DocumentNode }
    expect(envelope.astVersion).toBe('2.0')
    expect(envelope.document).toEqual(root)
    expect(decodeTree(encodeEnvelope(root))).toEqual(root)
  })

  it('C2-A-014: the version is major.minor, and a leading zero is refused', () => {
    expect(refusal({ ...documentOf(), astVersion: '2.01' })).toBe('/astVersion: not major.minor')
    expect(refusal({ ...documentOf(), astVersion: '2' })).toBe('/astVersion: not major.minor')
  })

  it('C2-A-017: an extension declaration has a name and a boolean `required`', () => {
    expect(refusal({ ...documentOf(), extensions: [{ name: 'org.example.notes', required: false }] })).toBeNull()
    expect(refusal({ ...documentOf(), extensions: [{ name: 'org.example.notes' }] })).toBe('/extensions/0/required: not a boolean')
  })

  it('C2-A-018, C2-A-020: a higher major version, an unknown required extension, an unknown field and an unknown type are refused', () => {
    expect(refusal({ ...documentOf(), astVersion: '3.0' })).toBe('/astVersion: major version 3 is not read by this engine')
    expect(refusal({ ...documentOf(), extensions: [{ name: 'org.example.x', required: true }] })).toBe('/extensions/0: an unknown required extension')
    expect(refusal(documentOf({ type: 'paragraph', children: [], extra: 1 } as unknown as Block))).toBe('/children/0/extra: not a field of paragraph')
    expect(refusal(documentOf({ type: 'marquee', children: [] } as unknown as Block))).toBe('/children/0: unknown node type marquee')
  })

  it('C2-A-019: a higher minor version is accepted', () => {
    expect(refusal({ ...documentOf(), astVersion: '2.7' })).toBeNull()
  })
})

describe('node grammar', () => {
  it('C2-A-021: every node is an object with a type', () => {
    expect(refusal(documentOf({ children: [] } as unknown as Block))).toBe('/children/0: a node without a type')
    expect(refusal(documentOf('text' as unknown as Block))).toBe('/children/0: not a node')
  })

  it('C2-A-022, C2-A-023: children is the content slot and value the literal payload', () => {
    expect(block('a `b`')).toEqual(paragraph('a ', { type: 'code', value: 'b' }))
    expect(refusal(documentOf({ type: 'thematic_break', children: [] } as unknown as Block))).toBe('/children/0/children: thematic_break holds no children')
  })

  it('C2-A-024: content with another role sits in a named slot', () => {
    expect(at(block('| a |\n^ c'), 'caption.type')).toBe('caption')
    expect(at(block('::: note "t"\n:::'), 'title')).toEqual([text('t')])
    expect(at(block('```js "t"\n```'), 'title')).toEqual([text('t')])
  })

  it('C2-A-027, C2-A-031: the common fields are allowed on every node, and dir is one of three values', () => {
    expect(refusal(documentOf({ type: 'paragraph', children: [], dir: 'rtl', lang: 'ar', metadata: {}, data: {} }))).toBeNull()
    expect(refusal(documentOf({ type: 'paragraph', children: [], dir: 'up' } as unknown as Block))).toBe('/children/0/dir: unknown value "up"')
  })

  it('C2-A-028: nodes are closed', () => {
    expect(refusal(documentOf({ type: 'heading', level: 1, children: [], marker: { kind: 'bullet', char: '-' } } as unknown as Block))).toBe('/children/0/marker: not a field of heading')
  })

  it('C2-A-029, C2-A-030: data and metadata are kept without being read', () => {
    const node: ParagraphNode = { type: 'paragraph', children: [], data: { 'org.example.x': { type: 'nonsense' } }, metadata: { a: [1, 'b'] } }
    expect(decodeTree(encodeTree(documentOf(node))).children[0]).toEqual(node)
  })
})

describe('attributes', () => {
  it('C2-A-032: an id, the classes and the pairs of keys in written order; a bare key has the empty value', () => {
    expect(inlines('[t]{#a .x .y data-n=1 hidden}')[0]!.attrs).toEqual({ id: 'a', classes: ['x', 'y'], keyValues: [['data-n', '1'], ['hidden', '']] })
  })

  it('C2-A-033: the tree records no order between the kinds of parts', () => {
    expect(block('{k=v .c #i}\na')).toEqual(block('{#i .c k=v}\na'))
  })

  it('C2-A-034: a key named id or class folds in, and the last id wins', () => {
    expect(block('{Class="x y" ID=a #b}\np').attrs).toEqual({ id: 'b', classes: ['x', 'y'] })
  })

  it('C2-A-035: merged blocks add their classes, and a later key replaces an earlier one at its first place', () => {
    expect(block('{.a k=1 m=2}\n{.b K=3}\np').attrs).toEqual({ classes: ['a', 'b'], keyValues: [['k', '3'], ['m', '2']] })
    expect(inlines('[t]{.a}{.b #i}')[0]!.attrs).toEqual({ id: 'i', classes: ['a', 'b'] })
  })

  it('C2-A-036: a reader looks for no node in keyValues', () => {
    expect(inlines('[t]{type=widget}')[0]).toEqual({ type: 'span', children: [text('t')], attrs: { keyValues: [['type', 'widget']] } })
  })

  it('C2-A-037: the language part sets lang and is no key', () => {
    expect(block('{:en}\np')).toEqual({ ...paragraph('p'), lang: 'en' })
  })

  it('C2-A-038: attrs.id holds only an authored id', () => {
    expect(block('# T').attrs).toBeUndefined()
    expect(block('{#t}\n# T').attrs).toEqual({ id: 't' })
  })

  it('C2-A-034: a reader refuses a key named id or class', () => {
    expect(refusal(documentOf({ type: 'paragraph', children: [], attrs: { keyValues: [['ID', 'x']] } }))).toBe('/children/0/attrs/keyValues: the key ID folds into the id or the classes')
  })
})

describe('text and literal payload', () => {
  it('C2-A-040: a node list holds no two adjacent text nodes', () => {
    expect(inlines('a \\* b {.x} c')).toEqual([text('a * b {.x} c')])
  })

  it('C2-A-041: an escaped character is part of the text', () => {
    expect(inlines('a\\*b\\\\c')).toEqual([text('a*b\\c')])
  })

  it('C2-A-042: an escaped space is a non_breaking_space node with no value', () => {
    expect(inlines('a\\ b')).toEqual([text('a'), { type: 'non_breaking_space' }, text('b')])
  })

  it('C2-A-044: a reader replaces every U+0000 of an ingested string', () => {
    const json = encodeTree(documentOf(paragraph('a\u0000b')))
    expect(at(decodeTree(json), 'children.0.children.0.value')).toBe('a�b')
  })

  it('C2-A-045, C2-A-046: the value of a fence holds every line with its break, also where the fence is unclosed', () => {
    expect(ofType(block('```\na\n```'), 'code_block').value).toBe('a\n')
    expect(ofType(block('```\n```'), 'code_block').value).toBe('')
    expect(ofType(block('```\na'), 'code_block').value).toBe('a\n')
    expect(ofType(childrenOf(block('> ```\n> a\n>  b\n> ```'))[0], 'code_block').value).toBe('a\n b\n')
  })

  it('C2-A-047: a supplied code block keeps a value with no final break', () => {
    const node: CodeBlockNode = { type: 'code_block', value: 'a' }
    expect(decodeTree(encodeTree(documentOf(node))).children[0]).toEqual(node)
  })

  it('C2-A-048: the value of a raw block follows the rules of a code block', () => {
    expect(block('```=html\n<b>\n```')).toEqual({ type: 'raw_block', format: 'html', value: '<b>\n' })
  })

  it('C2-A-049: frontmatter is the first child, with its format and its text as written', () => {
    expect(block('---\na: b\n---')).toEqual({ type: 'frontmatter', format: 'yaml', value: 'a: b\n' })
    expect(ofType(block('---toml\na = 1\n---'), 'frontmatter').format).toBe('toml')
    expect(ofType(block('---json\n{}'), 'frontmatter').value).toBe('{}\n')
    expect([ofType(block('--- json\n{}'), 'frontmatter').format, ofType(block('---ini-2  \r\na\r\n---'), 'frontmatter').format, ofType(block('---\r\na\r\n---'), 'frontmatter').format]).toEqual(['json', 'ini-2', 'yaml'])
    expect(ofType(block('---markdown\nx\n---'), 'frontmatter').format).toBe('markdown')
    expect(ofType(block('--- toml\nx\n---'), 'frontmatter').format).toBe('toml')
    expect(refusal(documentOf(paragraph('a'), { type: 'frontmatter', format: 'yaml', value: '' }))).toBe('/children/1: frontmatter is not the first child')
  })
})

describe('node types', () => {
  it('C2-A-050: a tree that holds another core type is refused, the three retired ones included', () => {
    for (const type of ['escaped_text', 'critic_substitution', 'cell_wrap']) {
      expect(refusal(documentOf(paragraph({ type, value: 'x' } as unknown as Inline)))).toBe(`/children/0/children/0: unknown node type ${type}`)
    }
  })

  it('C2-A-051: a type that exists only inside its container is refused anywhere else', () => {
    expect(refusal(documentOf({ type: 'list_item', children: [] } as unknown as Block))).toBe('/children/0: list_item does not stand here')
    expect(refusal(documentOf(paragraph({ type: 'paragraph', children: [] } as unknown as Inline)))).toBe('/children/0/children/0: paragraph does not stand here')
    expect(refusal(documentOf({ type: 'block_quote', children: [text('a')] } as unknown as Block))).toBe('/children/0/children/0: text does not stand here')
  })

  it('C2-A-052: a definition stands only among the children of the document, at its place', () => {
    expect(types(blocks('a\n\n[r]: /u\n\nb'))).toEqual(['paragraph', 'link_reference_definition', 'paragraph'])
    const footnote: FootnoteNode = { type: 'footnote', key: 'n', namespace: 'footnote', children: [] }
    expect(refusal(documentOf({ type: 'block_quote', children: [footnote] } as unknown as Block))).toBe('/children/0/children/0: footnote does not stand here')
  })
})

describe('lists and tasks', () => {
  it('C2-A-053 to C2-A-055: a list carries its items, one marker and its spacing; the bullet character is meaning', () => {
    expect(block('- a')).toEqual({
      type: 'list', marker: { kind: 'bullet', char: '-' }, spacing: 'tight', children: [{ type: 'list_item', children: [paragraph('a')] }],
    })
    expect(blocks('- a\n* b').map((list) => ofType(list, 'list').marker.char)).toEqual(['-', '*'])
  })

  it('C2-A-056, C2-A-058: an ordered marker has a style, a delimiter and a start, which is omitted when it is 1', () => {
    expect(ofType(block('2. a'), 'list').marker).toEqual({ kind: 'ordered', style: '1', delimiter: '.', start: 2 })
    expect(ofType(block('1) a'), 'list').marker).toEqual({ kind: 'ordered', style: '1', delimiter: ')' })
    expect(ofType(block('. a'), 'list').marker).toEqual({ kind: 'ordered', style: '1', delimiter: '.' })
    expect(ofType(block('iv.  a'), 'list').marker).toEqual({ kind: 'ordered', style: 'i', delimiter: '.', start: 4 })
    expect(ofType(block('B) a'), 'list').marker).toEqual({ kind: 'ordered', style: 'A', delimiter: ')', start: 2 })
  })

  it('C2-A-057: a marker that carries fields of both kinds is invalid', () => {
    const list: ListNode = { type: 'list', marker: { kind: 'bullet', char: '-', start: 2 }, spacing: 'tight', children: [] }
    expect(refusal(documentOf(list))).toBe('/children/0/marker/start: a field of the other kind of marker')
  })

  it('C2-A-058: equality drops a start of 1', () => {
    const list = (start?: number): DocumentNode => documentOf({
      type: 'list', marker: start === undefined ? { kind: 'ordered' } : { kind: 'ordered', start }, spacing: 'tight', children: [],
    })
    expect(treesEqual(list(1), list())).toBe(true)
    expect(treesEqual(list(2), list())).toBe(false)
  })

  it('C2-A-059: spacing is tight or loose, set when the list closes', () => {
    expect(ofType(block('- a\n- b'), 'list').spacing).toBe('tight')
    expect(ofType(block('- a\n\n- b'), 'list').spacing).toBe('loose')
    expect(ofType(block('- a\n\n  b'), 'list').spacing).toBe('tight')
  })

  it('C2-A-060, C2-A-061: a task item carries its mark and the status that follows from it', () => {
    const marks = ofType(blocks('- [ ] a\n- [x] a\n- [X] a\n- [_] a\n- [-] a\n- [/] a\n- [!] a\n- [>] a\n- [?] a')[0], 'list').children.map((item) => item.task)
    expect(marks).toEqual([
      { mark: ' ', status: 'todo' }, { mark: 'x', status: 'done' }, { mark: 'x', status: 'done' }, { mark: '_', status: 'todo' },
      { mark: '-', status: 'canceled' }, { mark: '/', status: 'in-progress' }, { mark: '!', status: 'blocked' },
      { mark: '>', status: 'partial' }, { mark: '?', status: 'other' },
    ])
    const item: ListItemNode = { type: 'list_item', children: [], task: { mark: 'x', status: 'todo' } }
    const list: ListNode = { type: 'list', marker: { kind: 'bullet', char: '-' }, spacing: 'tight', children: [item] }
    expect(refusal(documentOf(list))).toBe('/children/0/children/0/task/status: the status does not follow from the mark')
  })
})

describe('description lists', () => {
  it('C2-A-062 to C2-A-064: terms and descriptions in document order, with no grouping and no spacing', () => {
    expect(block(':: t\n:: u\n: d\n\n: e')).toEqual({
      type: 'definition_list',
      children: [
        { type: 'definition_term', children: [text('t')] }, { type: 'definition_term', children: [text('u')] },
        { type: 'definition_description', children: [paragraph('d')] }, { type: 'definition_description', children: [paragraph('e')] },
      ],
    })
  })
})

describe('quotes, divs and their sigil forms', () => {
  it('C2-A-065: a quote is a block_quote, written with marks or as a quote fence', () => {
    expect(block('::: >\na\n:::')).toEqual({ type: 'block_quote', children: [paragraph('a')] })
  })

  it('C2-A-066: the opener of a div decides its node type', () => {
    expect(block('::: tip\n:::')).toEqual({ type: 'admonition', kind: 'tip', children: [] })
    expect(block('::: toc\n:::')).toEqual({ type: 'directive', kind: 'toc', children: [] })
    expect(block('::: figure\n:::')).toEqual({ type: 'figure_group', children: [] })
    expect(block('::: figure "t"\n:::')).toEqual({ type: 'div', title: [text('t')], children: [], attrs: { classes: ['figure'] } })
    expect(block('::: spoiler\n:::')).toEqual({ type: 'div', children: [], attrs: { classes: ['spoiler'] } })
    expect(block(':::\n:::')).toEqual({ type: 'div', children: [] })
    expect(block('::: Note\n:::').type).toBe('div')
  })

  it('C2-A-067: a directive always carries children and may carry a title', () => {
    expect(block('::: glossary "Terms"\n:::')).toEqual({ type: 'directive', kind: 'glossary', title: [text('Terms')], children: [] })
  })

  it('C2-A-068: a hard-break block is a div with the class hardbreaks in which every line end is a hard break', () => {
    const expected: DivNode = {
      type: 'div', children: [paragraph('a', { type: 'hard_break' }, 'b')], attrs: { classes: ['hardbreaks'] },
    }
    expect(block('::: \\\na\nb\n:::')).toEqual(expected)
    expect(block('{.hardbreaks}\n:::\na\nb\n:::')).toEqual(expected)
    expect(block('{.x}\n::: \\\na\n:::').attrs).toEqual({ classes: ['x', 'hardbreaks'] })
  })

  it('C2-A-069: a line block holds one line per line of its body; an empty line is a line with no children', () => {
    expect(block('::: |\na\n\n b\n{% c %}\n:::')).toEqual({
      type: 'line_block',
      children: [
        { type: 'line', children: [text('a')] }, { type: 'line', children: [] }, { type: 'line', children: [text(' b')] },
        { type: 'line', children: [{ type: 'comment', form: 'braced', value: 'c' }] },
      ],
    })
  })
})

describe('headings, thematic breaks and code', () => {
  it('C2-A-070, C2-A-071: a heading carries its level and its inline children, with a break where it continues', () => {
    expect(block('## T\n   u')).toEqual({ type: 'heading', level: 2, children: [text('T'), { type: 'soft_break' }, text('u')] })
    expect(refusal(documentOf({ type: 'heading', level: 9, children: [] }))).toBeNull()
  })

  it('C2-A-072: a thematic break has no fields of its own', () => {
    expect(block('***')).toEqual({ type: 'thematic_break' })
  })

  it('C2-A-073: a code block carries its value, its language word and its title', () => {
    expect(block('~~~~js "T" [L]\nx\n~~~~')).toEqual({ type: 'code_block', value: 'x\n', syntax: 'js', title: [text('T')], groupLabel: 'L' })
  })
})

describe('comments', () => {
  it('C2-A-074: a comment carries its form and its value without the one space behind its opener', () => {
    expect(childrenOf(block('> %% a  '))).toEqual([{ type: 'comment', form: 'line', value: 'a' }])
    expect(inlines('x {%  a  %} y')[1]).toEqual({ type: 'comment', form: 'braced', value: ' a ' })
    expect(inlines('x %%a')[1]).toEqual({ type: 'comment', form: 'line', value: 'a' })
    expect(block('%%%\na\n b\n%%%')).toEqual({ type: 'comment', form: 'block', value: 'a\n b' })
    expect(at(block('| a %% c |'), 'children.0.children.0.children.0.children.0.children.1')).toEqual({ type: 'comment', form: 'line', value: 'c' })
  })

  it('C2-A-075: the comment of a comment-only line is a child of the open leaf, or else of the innermost open container', () => {
    expect(inlines('a\n%% c\nb').map((node) => node.type)).toEqual(['text', 'soft_break', 'comment', 'soft_break', 'text'])
    expect(types(childrenOf(block('> a\n>\n> %% c')))).toEqual(['paragraph', 'comment'])
  })
})

describe('definitions', () => {
  it('C2-A-076: a definition-shaped line inside a container is text', () => {
    expect(block('> [r]: /u')).toEqual({ type: 'block_quote', children: [paragraph('[r]: /u')] })
  })

  it('C2-A-077: a link definition carries the folded label, its destination and an optional title', () => {
    expect(block('[a  b]: /u "T"')).toEqual({ type: 'link_reference_definition', key: 'a b', namespace: 'link', href: '/u', title: 'T' })
    expect(ofType(block('[a]: /u'), 'link_reference_definition').title).toBeUndefined()
    expect(block('[a]:').type).toBe('paragraph')
  })

  it('C2-A-078: a footnote carries its key and its blocks', () => {
    expect(block('[^n]: a\n\n    b')).toEqual({ type: 'footnote', key: 'n', namespace: 'footnote', children: [paragraph('a'), paragraph('b')] })
  })

  it('C2-A-079: an abbreviation definition carries its key and its expansion', () => {
    expect(block('*[HTML]: Hyper Text')).toEqual({ type: 'abbreviation_def', expansion: 'Hyper Text', key: 'HTML', namespace: 'abbr' })
  })

  it('C2-A-080: the first of two definitions of one term wins', () => {
    expect(at(blocks('*[A]: one\n*[A]: two\n\nA')[2], 'children.0.expansion')).toBe('one')
  })
})

describe('figures and captions', () => {
  const caption = (...children: (Inline | string)[]): CaptionNode => ({ type: 'caption', children: [paragraph(...children)] })

  it('C2-A-081: a caption holds blocks, and no short form is derived', () => {
    expect(at(block('| a |\n^ c *d*'), 'caption')).toEqual(caption('c ', { type: 'strong', children: [text('d')] }))
  })

  it('C2-A-082: a table carries its caption; an image, a code block, a quote and a math block are wrapped in a figure', () => {
    expect(block('![a](b)\n^ c')).toEqual({
      type: 'figure', children: [{ ...paragraph({ type: 'image', src: 'b', alt: 'a' }), blockImage: true }], caption: caption('c'),
    })
    expect(types([block('```\n```\n^ c'), block('> q\n^ c'), block('$$`x`\n^ c'), block('| a |\n^ c')])).toEqual(['figure', 'figure', 'figure', 'table'])
    expect(types(childrenOf(block('```\n```\n%% x\n^ c')))).toEqual(['code_block', 'comment'])
    expect(types(childrenOf(block('| a |\n%% x\n^ c')))).toEqual(['table_body', 'comment'])
    expect(types(childrenOf(block('| a |\n%% x')))).toEqual(['table_body', 'comment'])
  })

  it('C2-A-083: a parsed figure makes no claim about its kind', () => {
    expect(ofType(block('> q\n^ c'), 'figure').kind).toBeUndefined()
  })

  it('C2-A-084, C2-A-085: a figure group carries its blocks in source order and the caption of the group', () => {
    const group = ofType(block('::: figure\n![a](b)\n^ one\n\n| x |\n^ two\n:::\n^ both'), 'figure_group')
    expect(types(group.children)).toEqual(['figure', 'table'])
    expect(at(group, 'children.1.caption')).toEqual(caption('two'))
    expect(group.caption).toEqual(caption('both'))
  })

  it('C2-B-150: the first bare number mark of a caption is a caption_number node', () => {
    expect(at(block('| a |\n^ Table #: x'), 'caption.children.0.children')).toEqual([text('Table '), { type: 'caption_number' }, text(': x')])
    expect(at(block('| a |\n^ a \\# b #tag *#* #'), 'caption.children.0.children.5')).toEqual({ type: 'caption_number' })
  })
})

describe('tables', () => {
  const cell = (value: string, header = false): TableCellNode => ({ type: 'table_cell', header, children: [{ type: 'cell_paragraph', children: value === '' ? [] : [text(value)] }] })
  const row = (...cells: TableCellNode[]): TableRowNode => ({ type: 'table_row', children: cells })

  it('C2-A-086, C2-A-087: a table holds groups of rows of cells; the leading rows of header cells are its head', () => {
    expect(block('|= h |\n| a |\n%% c\n| b |')).toEqual({
      type: 'table', columns: [{ type: 'table_column' }],
      children: [
        { type: 'table_head', children: [row(cell('h', true))] },
        { type: 'table_body', children: [row(cell('a')), { type: 'comment', form: 'line', value: 'c' }, row(cell('b'))] },
      ],
    })
    expect(types(childrenOf(block('{footer-rows=1}\n| a |\n| b |')))).toEqual(['table_body', 'table_foot'])
    expect(types(childrenOf(childrenOf(block('|= h |\n%% c\n| a |'))[0]))).toEqual(['table_row', 'comment'])
  })

  it('C2-A-088: a body whose partition the source declared carries headRows', () => {
    expect(at(block('{table header-rows=0}\n```csv\na\n```'), 'children.0.headRows')).toBe(0)
    expect(at(block('{table}\n```csv\na\nb\n```'), 'children.1.headRows')).toBeUndefined()
  })

  it('C2-A-089, C2-A-090: one column per position up to the widest row; a column the source spelled is authored', () => {
    expect(ofType(block('| a | b |\n| c |'), 'table').columns).toEqual([{ type: 'table_column' }, { type: 'table_column' }])
    expect(ofType(block('{aligns="left,center" widths="30,70"}\n| a | b |'), 'table').columns).toEqual([
      { type: 'table_column', align: 'left', width: 0.3, authored: true }, { type: 'table_column', align: 'center', width: 0.7, authored: true },
    ])
  })

  it('C2-A-091: a cell of a pipe table holds one cell_paragraph', () => {
    expect(at(block('| *a* |'), 'children.0.children.0.children.0.children.0.children.0.type')).toBe('strong')
    const blocksInCell: TableCellNode = { type: 'table_cell', header: false, children: [paragraph('a')] }
    expect(refusal(documentOf({ type: 'table', columns: [], children: [{ type: 'table_body', children: [row(blocksInCell)] }] }))).toBeNull()
  })

  it('C2-A-092: a span mark leaves a cell with the mark, and the covering cell holds the count; a failed mark is an ordinary cell', () => {
    const rows = childrenOf(childrenOf(block('| a | < |\n| ^ | b |'))[0])
    expect(rows[0]).toEqual(row({ ...cell('a'), colspan: 2 }, { type: 'table_cell', header: false, span: 'colspan', children: [] }))
    expect(rows[1]).toEqual(row(cell(''), cell('b')))
    const down = childrenOf(childrenOf(block('| a |\n| ^ |'))[0])
    expect(down).toEqual([row({ ...cell('a'), rowspan: 2 }), row({ type: 'table_cell', header: false, span: 'rowspan', children: [] })])
  })

  it('C2-A-092: a cell carries its header mark, its alignment and its attributes', () => {
    expect(at(block('|={> .x} a |{~} b |'), 'children.0.children.0.children')).toEqual([
      { ...cell('a', true), align: 'right', attrs: { classes: ['x'] } }, { ...cell('b'), align: 'center' },
    ])
    expect(at(block('| a |{.r}'), 'children.0.children.0.attrs')).toEqual({ classes: ['r'] })
  })

  it('C2-A-094: a continuation row leaves no node; its fragment joins the cell above with one space of text', () => {
    expect(block('| a | b |\n+ c | |')).toEqual(block('| a c | b |'))
  })

  it('C2-A-095: a delimited table is a table like any other', () => {
    expect(block('{table}\n```csv\nh\n"a,b"\n```')).toEqual({
      type: 'table', columns: [{ type: 'table_column' }],
      children: [{ type: 'table_head', children: [row(cell('h', true))] }, { type: 'table_body', children: [row(cell('a,b'))] }],
    })
  })
})

describe('inline nodes', () => {
  it('C2-A-096: emphasis and strong nest in the order written', () => {
    expect(inlines('*/a/*')).toEqual([{ type: 'strong', children: [{ type: 'emphasis', children: [text('a')] }] }])
    expect(inlines('/*a*/')).toEqual([{ type: 'emphasis', children: [{ type: 'strong', children: [text('a')] }] }])
  })

  it('C2-A-097: a replacement is a delete node directly followed by an insert node', () => {
    expect(inlines('{-old-}{+new+}')).toEqual([{ type: 'delete', children: [text('old')] }, { type: 'insert', children: [text('new')] }])
  })

  it('C2-A-098: a smart_punctuation node carries its kind, its glyph and the characters as typed', () => {
    expect(inlines('a -- b')[1]).toEqual({ type: 'smart_punctuation', kind: 'en_dash', glyph: '–', source: '--' })
  })

  it('C2-A-099: a line break inside a leaf is a soft_break or a hard_break with no value', () => {
    expect(inlines('a\nb\\\nc').filter((node) => node.type !== 'text')).toEqual([{ type: 'soft_break' }, { type: 'hard_break' }])
  })

  it('C2-A-100: an inline footnote holds its content in children', () => {
    expect(inlines('a^[b]')[1]).toEqual({ type: 'inline_footnote', children: [text('b')] })
  })

  it('C2-A-101: a mention carries its kind and its target; a tag and a symbol carry a name', () => {
    expect(inlines('@ann #tag :smile:').filter((node) => node.type !== 'text')).toEqual([
      { type: 'mention', target: 'ann', kind: 'user' }, { type: 'tag', name: 'tag' }, { type: 'symbol', name: 'smile' },
    ])
  })

  it('C2-A-102: a math node carries its value and whether it is display math', () => {
    expect(inlines('$`a` $$`b`').filter((node) => node.type !== 'text')).toEqual([
      { type: 'math', display: false, value: 'a' }, { type: 'math', display: true, value: 'b' },
    ])
  })

  it('C2-A-111 to C2-A-113: a link inside link text stays a node, and a destination holds what the author wrote, a script URL included', () => {
    expect(inlines('[a [b](javascript:x)](/u)')).toEqual([{
      type: 'link', href: '/u', children: [text('a '), { type: 'link', href: 'javascript:x', children: [text('b')] }],
    }])
  })

  it('C2-A-114: a link or an image may carry targetKind for a target that is no URL', () => {
    expect(refusal(documentOf(paragraph({ type: 'link', href: 'Page', targetKind: 'wiki', children: [] })))).toBeNull()
    expect(refusal(documentOf(paragraph({ type: 'image', src: 'x', targetKind: 'ftp' } as unknown as Inline)))).toBe('/children/0/children/0/targetKind: unknown value "ftp"')
  })

  it('C2-A-043: every string holds literal Unicode, and a private-use character has no special meaning', () => {
    const src = 'a \ue000 b \u{f0000} c'
    expect(inlines(src)).toEqual([text(src)])
    expect(decodeTree(encodeTree(tree(src)))).toEqual(tree(src))
  })

  it('C2-A-115: an image carries its alt text and its tooltip', () => {
    expect(inlines('x ![a *b*](c "T")')[1]).toEqual({ type: 'image', src: 'c', tooltip: 'T', alt: 'a *b*' })
  })

  it('C2-A-124: an inline extension written in source carries its name and its children', () => {
    expect(inlines('x :kbd[Ctrl]')[1]).toEqual({ type: 'inline_extension', name: 'kbd', children: [text('Ctrl')] })
  })

  it('C2-I-098, C2-I-099: a defined term in ordinary text is an abbreviation node, as a whole word only', () => {
    const term: Inline = { type: 'abbreviation', key: 'HTML', namespace: 'abbr', expansion: 'x' }
    expect(inlinesOf(blocks('*[HTML]: x\n\nHTML, /HTML/ HTMLs `HTML` éHTML')[1])).toEqual([
      term, text(', '), { type: 'emphasis', children: [term] }, text(' HTMLs '), { type: 'code', value: 'HTML' }, text(' éHTML'),
    ])
    expect(inlinesOf(blocks('*[HT]: x\n\n{*HT*}ML')[1])).toEqual([{ type: 'strong', children: [text('HT')] }, text('ML')])
  })
})

describe('citations, extension nodes and resources', () => {
  it('C2-A-118, C2-A-120: a citation stands only in a group, and a group mode needs a mode on every item', () => {
    const citation: CitationNode = { type: 'citation', key: 'a', namespace: 'citation', suppressAuthor: false }
    expect(refusal(documentOf(paragraph(citation as unknown as Inline)))).toBe('/children/0/children/0: citation does not stand here')
    expect(refusal(documentOf(paragraph({ type: 'citation_group', raw: '[@a]', children: [citation] })))).toBeNull()
    expect(refusal(documentOf(paragraph({ type: 'citation_group', raw: '[@a]', mode: 'paren', children: [citation] })))).toBe('/children/0/children/0: a group mode needs a mode on every citation')
  })

  it('C2-A-121: a citation definition carries its key and inline children', () => {
    expect(refusal(documentOf({ type: 'citation_definition', key: 'a', namespace: 'citation', children: [text('x')] }))).toBeNull()
  })

  it('C2-A-122, C2-A-125, C2-A-126: a block extension carries a fallback of block content', () => {
    expect(refusal(documentOf({ type: 'block_extension', name: 'org.example.d', children: [] } as unknown as Block))).toBe('/children/0/fallback: a required field is missing')
    expect(refusal(documentOf({ type: 'block_extension', name: 'org.example.d', children: [], fallback: [text('x')] } as unknown as Block))).toBe('/children/0/fallback/0: text does not stand here')
    expect(refusal(documentOf({ type: 'block_extension', name: 'org.example.d', children: [], fallback: [paragraph('x')] }))).toBeNull()
  })

  it('C2-A-128: reading a tree keeps payload, props and data as they are and runs nothing in them', () => {
    const node: InlineExtensionNode = {
      type: 'inline_extension', name: 'org.example.x', children: [], fallback: [text('f')],
      props: { run: '<script>' }, payload: [{ format: 'js', value: 'alert(1)' }], data: { 'org.example.x': { type: 'link' } },
    }
    expect(inlinesOf(decodeTree(encodeTree(documentOf(paragraph(node)))).children[0])[0]).toEqual(node)
  })

  it('C2-A-132: a reader bounds metadata nesting, resource references and fallback nesting', () => {
    let metadata: Record<string, unknown> = {}
    for (let level = 0; level < 70; level++) metadata = { a: metadata }
    expect(refusal(documentOf({ ...paragraph(), metadata }))).toMatch(/metadata is nested deeper than 64 levels$/)
    const references = Array.from({ length: 5000 }, (_unused, index) => `r${index}`)
    const extension: InlineExtensionNode = { type: 'inline_extension', name: 'org.example.x', children: [], resourceIds: references }
    expect(refusal(documentOf(paragraph(extension)))).toBe('/children/0/children/0: more than 4096 resource references')
    let nested: Inline = text('x')
    for (let level = 0; level < 40; level++) nested = { type: 'inline_extension', name: 'org.example.x', children: [], fallback: [nested] }
    expect(refusal(documentOf(paragraph(nested)))).toMatch(/fallbacks are nested deeper than 32 extension nodes$/)
  })

  it('C2-A-131: a resource has an id, a media type and a digest, and no id occurs twice', () => {
    const resource = { id: 'a', mediaType: 'image/png', digest: `sha256:${'0'.repeat(64)}` }
    expect(refusal({ ...documentOf(), resources: [resource] })).toBeNull()
    expect(refusal({ ...documentOf(), resources: [resource, resource] })).toBe('/resources/1/id: a duplicate resource id')
    expect(refusal({ ...documentOf(), resources: [{ ...resource, digest: 'md5:0' }] })).toBe('/resources/0/digest: not a sha256 digest')
  })
})

describe('facts set at close', () => {
  it('C2-A-136: a paragraph that closed as one block image line carries blockImage', () => {
    expect(ofType(block('![a](b)'), 'paragraph').blockImage).toBe(true)
    expect(ofType(block('![a](b)\n%% c'), 'paragraph').blockImage).toBe(true)
    expect(ofType(block('![a](b) x'), 'paragraph').blockImage).toBeUndefined()
    expect(ofType(block('![a\nb][c]'), 'paragraph').blockImage).toBeUndefined()
    expect(refusal(documentOf({ type: 'image', src: 'b' } as unknown as Block))).toBe('/children/0: image does not stand here')
  })

  it('C2-A-184: a paragraph that closed as one display math line carries blockMath', () => {
    expect(block('$$`x`')).toEqual({ ...paragraph({ type: 'math', display: true, value: 'x' }), blockMath: true })
    expect(ofType(block('$`x`'), 'paragraph').blockMath).toBeUndefined()
    expect(ofType(block('$$`x\ny`'), 'paragraph').blockMath).toBeUndefined()
  })

  it('C2-A-185: the five facts set at close are in the tree and take part in equality', () => {
    expect(treesEqual(tree('- a\n- b'), tree('- a\n\n- b'))).toBe(false)
    expect(treesEqual(tree('![a](b)'), tree('![a](b) '))).toBe(true)
    expect(treesEqual(documentOf({ ...paragraph(), blockImage: true }), documentOf(paragraph()))).toBe(false)
    expect(treesEqual(tree('| a |\n| b |'), tree('{footer-rows=1}\n| a |\n| b |'))).toBe(false)
    expect(treesEqual(tree('| a |\n^ c'), tree('| a |\n\n^ c'))).toBe(false)
  })

  it('C2-A-183: the attributes of a captioned block are those of the figure; a table carries its own', () => {
    expect(block('{#f .c}\n> q\n^ c').attrs).toEqual({ id: 'f', classes: ['c'] })
    expect(at(block('{#f .c}\n> q\n^ c'), 'children.0.attrs')).toBeUndefined()
    expect(block('{#f}\n| a |\n^ c').attrs).toEqual({ id: 'f' })
  })

  it('C2-A-186: a parsed item, description, term or heading with nothing else holds a comment node; a quote may be empty', () => {
    expect(at(block('- %% c'), 'children.0.children')).toEqual([{ type: 'comment', form: 'line', value: 'c' }])
    expect(childrenOf(block('# %% c'))).toEqual([{ type: 'comment', form: 'line', value: 'c' }])
    expect(block('>')).toEqual({ type: 'block_quote', children: [] })
  })

  it('C2-A-181: an include directive is an include node with its path, its section and its options in the fixed order', () => {
    expect(block('{{ parts/intro.crv #setup @code:js @lines:1-5 }}')).toEqual({
      type: 'include', path: 'parts/intro.crv', section: 'setup', options: [['lines', '1-5'], ['code', 'js']],
    })
    expect(block('{{ "a b.crv" }}')).toEqual({ type: 'include', path: 'a b.crv' })
  })
})

describe('equality', () => {
  it('C2-A-161: two trees are equal when they agree in types, fields, order, attrs, metadata and data', () => {
    expect(treesEqual(tree('a *b*'), tree('a *b*'))).toBe(true)
    expect(treesEqual(tree('a *b*'), tree('a /b/'))).toBe(false)
    expect(treesEqual(tree('{.a .b}\np'), tree('{.b .a}\np'))).toBe(false)
    expect(treesEqual(documentOf(paragraph('a', 'b')), documentOf(paragraph('ab')))).toBe(true)
    expect(treesEqual(documentOf({ ...paragraph(), data: { x: 1 } }), documentOf({ ...paragraph(), data: { x: 2 } }))).toBe(false)
  })

  it('C2-A-162, C2-A-163: positions and the byte length are not compared', () => {
    expect(treesEqual(placedTree('a'), tree('a'))).toBe(true)
    expect(treesEqual(placedTree('> a'), placedTree('::: >\na\n:::'))).toBe(true)
  })

  it('C2-A-165: a tree encoded to JSON and decoded is the same tree in every field, positions included', () => {
    const root = placedTree('# T\n\n- [x] a *b*\n\n| a | < |\n^ T #')
    expect(decodeTree(encodeTree(root))).toEqual(root)
  })

  it('C2-A-166: what the tree holds differs between two documents that differ in it', () => {
    for (const [a, b] of [['- a', '* a'], ['1. a', '1) a'], ['1. a', '2. a'], ['a. a', 'A. a'], ['- [ ] a', '- [_] a'], ['a %% c', 'a {% c %}']]) {
      expect(treesEqual(tree(a!), tree(b!))).toBe(false)
    }
  })
})

describe('reading a tree', () => {
  it('C2-A-167: a refusal is a typed error that names what was wrong and the path of the node', () => {
    const error = (() => {
      try {
        decodeTree('{"type":"document","astVersion":"2.0","children":[{"type":"paragraph"}]}')
      } catch (caught) {
        return caught
      }
      return null
    })()
    expect(error).toBeInstanceOf(CarveTreeError)
    expect((error as CarveTreeError).path).toBe('/children/0/children')
    expect(() => decodeTree('{')).toThrow(CarveTreeError)
  })

  it('C2-A-168: a root that lacks type, children or the version, or that is no document, is refused', () => {
    expect(refusal({ astVersion: '2.0', children: [] })).toBe('/type: the root is not a document')
    expect(refusal({ type: 'document', astVersion: '2.0' })).toBe('/children: the root has no children')
    expect(refusal({ type: 'document', children: [] })).toBe('/astVersion: not a string')
    expect(refusal({ type: 'paragraph', astVersion: '2.0', children: [] })).toBe('/type: the root is not a document')
  })

  it('C2-A-169, C2-A-170: an unknown field is refused at any node, at decode', () => {
    expect(() => decodeTree(encodeTree(documentOf(paragraph({ type: 'text', value: 'a', bold: true } as unknown as Inline))))).toThrow('/children/0/children/0/bold: not a field of text')
    expect(refusal(documentOf({ ...paragraph(), pos: null } as unknown as Block))).toBe('/children/0/pos: a field without a value')
  })

  it('C2-A-171: a reader accepts every tree its parser makes at the nesting cap and refuses deeper input', () => {
    expect(refusal(placedTree(`${'> '.repeat(250)}a ${'{*'.repeat(250)}b${'*}'.repeat(250)}`))).toBeNull()
    expect(refusal(placedTree(`${'- '.repeat(250)}a`))).toBeNull()
    let deep: Block = paragraph('a')
    for (let level = 0; level <= MAX_TREE_DEPTH; level++) deep = { type: 'block_quote', children: [deep] }
    expect(refusal(documentOf(deep))).toMatch(/nested deeper than a parser can produce$/)
  })

  it('C2-A-142, C2-A-157: pos may name the file it is measured in, and segments holds ranges in the shape of pos', () => {
    const pos = { startLine: 1, endLine: 1, startColumn: 1, endColumn: 2, startOffset: 0, endOffset: 1 }
    expect(refusal(documentOf({ ...paragraph(), pos: { ...pos, file: 'part.crv' }, segments: [pos, pos] }))).toBeNull()
    expect(refusal(documentOf({ ...paragraph(), segments: [{ ...pos, endOffset: undefined }] } as unknown as Block))).toBe('/children/0/segments/0/endOffset: not an integer')
    expect(refusal(documentOf({ ...paragraph(), pos: { ...pos, startOffset: 5 } }))).toBe('/children/0/pos: the start lies behind the end')
  })

  it('C2-A-176: a tree that holds a retired node type is refused, not migrated', () => {
    expect(() => decodeTree(encodeTree(documentOf(paragraph({ type: 'cell_wrap' } as unknown as Inline))))).toThrow(CarveTreeError)
  })

  it('C2-A-105: on a link or an image the key, the namespace and the form stand together', () => {
    expect(refusal(documentOf(paragraph({ type: 'link', key: 'a', namespace: 'link', children: [] })))).toBe('/children/0/children/0: key, namespace and form stand together or not at all')
  })
})
