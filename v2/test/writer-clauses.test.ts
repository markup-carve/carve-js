// One test per clause of spec/0.2/writer.md that states behavior of the canonical writer or of the
// formatter, in the order of the document. The forms taken from the sidecar are in
// writer-layout.test.ts, the gates on the enumerations in writer-gates.test.ts.
import { describe, expect, it } from 'vitest'
import {
  type CodeNode, decodeTree, type DocumentNode, encodeTree, format, formatWithDiagnostics, type Inline, type LinkNode, parse,
  parseWithLayout, render, treesEqual, write, writeWithDiagnostics,
} from '../src/index.ts'
import { childrenOf, inlinesOf, ofType } from './support/nodes.ts'
import { type DocumentChild, documentOf, paragraph, text } from './support/tree.ts'
import { checkWriter } from './support/writer-checks.ts'

/** The tree of `src` after `change` edited its blocks. */
function edited(src: string, change: (blocks: DocumentChild[]) => void): DocumentNode {
  const tree = parse(src)
  change(tree.children)
  return tree
}

/** What the writer could not write of `tree`, each as the code and the path. */
function losses(tree: DocumentNode): string[] {
  return writeWithDiagnostics(tree).diagnostics.map((entry) => `${entry.code} ${entry.path ?? ''}`)
}

function code(value: string): CodeNode {
  return { type: 'code', value }
}

/** The node types that hold inline children and nothing else the tests set. */
type Wrapper = 'delete' | 'emphasis' | 'highlight' | 'insert' | 'small_caps' | 'strike' | 'strong' | 'underline'

function inline(type: Wrapper, ...children: (Inline | string)[]): Inline {
  return { type, children: children.map((child) => (typeof child === 'string' ? text(child) : child)) }
}

describe('the writer and its two gates', () => {
  it('C2-W-001: the formatter parses with the sidecar and writes the tree with it', () => {
    const src = '1. a\n2. b\n\n::: >\nq\n:::\n\n# T'
    const { document, layout } = parseWithLayout(src)
    expect(format(src)).toBe('1. a\n2. b\n\n::: >\nq\n:::\n\n= T\n')
    expect(write(document, { layout })).toBe(format(src))
    expect(write(document)).toBe('. a\n. b\n\n> q\n\n= T\n')
  })

  it('C2-W-002: the written form parses to the tree of the input', () => {
    const src = '{.a}{#b}\n## T\n\n~~~js\nx\n~~~\n\n- [X] a\n   b\n\n[c](/u \'t\') {_d_}'
    expect(treesEqual(parse(format(src)), parse(src))).toBe(true)
    expect(checkWriter(src)).toBeNull()
  })

  it('C2-W-003: formatting the written form again changes no byte', () => {
    const src = '1. a\n1. b\n\n\n\n\n1. c\n\n| a |\n+ b |\n\n::: \\\nx\ny\n:::'
    const once = format(src)
    expect(format(once)).toBe(once)
    expect(write(parse(write(parse(src))))).toBe(write(parse(src)))
  })

  it('C2-W-004: the rendered output is the same before and after', () => {
    const src = '# T\n\n~~~\nx\n~~~\n\n1. a\n1. b\n\n[c](/u \'t\') and [x]{kbd=""}\n\n| a |\n+ b |'
    expect(render(format(src))).toBe(render(src))
  })

  it('C2-W-005: a spelling that would not parse back gives way to the gate', () => {
    // The closer of the fence would take the comment into the item, so the fence is left open.
    const tree = documentOf(parse('- ```\n  x\n  ```').children![0]!, { type: 'comment', form: 'line', value: 'c' })
    const written = writeWithDiagnostics(tree)
    expect(written.source).toBe('- ```\n  x\n%% c\n')
    expect(written.diagnostics).toEqual([])
    expect(treesEqual(parse(written.source), tree)).toBe(true)
  })

  it('C2-W-006: an escape depends on the lines before it, not on the line alone', () => {
    expect(format('\\: x')).toBe(': x\n')
    expect(format(':: t\n: d\n\n\\: x')).toBe(':: t\n: d\n\n\\: x\n')
  })

  it('C2-W-007: no construct is replaced, no content moved and no prose wrapped again', () => {
    expect(format('a b\nc')).toBe('a b\nc\n')
    expect(format('- a\n\n* b')).toBe('- a\n\n* b\n')
    const long = `${'word '.repeat(60)}end`
    expect(format(long)).toBe(`${long}\n`)
  })

  it('C2-W-008: an escape that is removed or added does not change the tree', () => {
    expect(treesEqual(parse('a\\*b'), parse('a*b'))).toBe(true)
    expect(format('a\\*b')).toBe('a*b\n')
    expect(treesEqual(parse(format('\\# a')), parse('\\# a'))).toBe(true)
  })

  it('C2-W-009: the tree is kept, the author\'s form is taken from the sidecar, the rest is canonical', () => {
    expect(format('- a\n\n* b\n\n::: >\nq\n:::\n\n# H')).toBe('- a\n\n* b\n\n::: >\nq\n:::\n\n= H\n')
  })

  it('C2-W-010: the output passes the checks whatever way the writer found it', () => {
    expect(checkWriter('\\# a\n\n1\\. b\n\na \\*b\\* \\[c](d)')).toBeNull()
  })
})

describe('what the writer cannot spell', () => {
  it('C2-W-011: an interchange-only shape is written as the table of C2-A-175 names and reported', () => {
    const smallCaps = documentOf(paragraph(inline('small_caps', 'abc')))
    expect(write(smallCaps)).toBe('abc\n')
    expect(losses(smallCaps)).toEqual(['structure-unspellable /children/0/children/0'])

    const section = documentOf({ type: 'section', children: [paragraph('a'), paragraph('b')] })
    expect(write(section)).toBe('a\n\nb\n')
    expect(losses(section)).toEqual(['structure-unspellable /children/0'])

    const ruby = documentOf(paragraph({ type: 'ruby', pairs: [{ type: 'rubyPair', base: [text('漢')], annotation: [text('kan')] }] }))
    expect(write(ruby)).toBe('漢(kan)\n')
    expect(losses(ruby)).toEqual(['structure-unspellable /children/0/children/0'])

    const short = edited('| a |\n^ cap', (blocks) => { ofType(ofType(blocks[0], 'table').caption, 'caption').short = [text('s')] })
    expect(write(short)).toBe('| a |\n^ cap\n')
    expect(losses(short)).toEqual(['field-unspellable /children/0/caption'])

    const figure = documentOf({ type: 'figure', caption: { type: 'caption', children: [paragraph('fig')] }, children: [ofType(parse('| a |').children[0], 'table')] })
    expect(write(figure)).toBe('| a |\n^ fig\n')
    expect(losses(figure)).toEqual(['structure-unspellable /children/0'])
  })

  it('C2-W-117: a field no clause writes is left out and reported as field-unspellable', () => {
    const loose = edited('- a', (blocks) => { ofType(blocks[0], 'list').spacing = 'loose' })
    expect(write(loose)).toBe('- a\n')
    expect(losses(loose)).toEqual(['field-unspellable /children/0'])

    const kind = edited('![i](u)\n^ cap', (blocks) => { ofType(blocks[0], 'figure').kind = 'image' })
    expect(write(kind)).toBe('![i](u)\n^ cap\n')
    expect(losses(kind)).toEqual(['field-unspellable /children/0'])

    const tocTarget = edited('::: toc\n:::', (blocks) => { ofType(blocks[0], 'directive').tocTarget = 'figures' })
    expect(write(tocTarget)).toBe('::: toc\n\n:::\n')
    expect(losses(tocTarget)).toEqual(['field-unspellable /children/0'])

    const autolink = edited('<https://a.b>', (blocks) => { ofType(inlinesOf(blocks[0])[0], 'autolink').text = 'other' })
    expect(write(autolink)).toBe('<https://a.b>\n')
    expect(losses(autolink)).toEqual(['field-unspellable /children/0/children/0'])

    const label = edited('@user', (blocks) => { ofType(inlinesOf(blocks[0])[0], 'mention').label = 'L' })
    expect(write(label)).toBe('@user\n')
    expect(losses(label)).toEqual(['field-unspellable /children/0/children/0'])

    const team = edited('@user', (blocks) => { ofType(inlinesOf(blocks[0])[0], 'mention').kind = 'team' })
    expect(write(team)).toBe('@user\n')
    expect(losses(team)).toEqual(['field-unspellable /children/0/children/0'])

    const metadata = edited('para', (blocks) => { blocks[0]!.metadata = { a: 1 } })
    expect(write(metadata)).toBe('para\n')
    expect(losses(metadata)).toEqual(['field-unspellable /children/0'])
  })

  it('C2-W-117: a value with no spelling is written in the nearest form and reported', () => {
    const hyphens = documentOf({ type: 'frontmatter', format: 'yaml', value: 'a: b\n---\nc: d\n' }, paragraph('x'))
    expect(losses(hyphens)).toContain('field-unspellable /children/0')

    const spaced = edited('{.a}\npara', (blocks) => { blocks[0]!.attrs!.classes = ['a b'] })
    expect(write(spaced)).toBe('{class="a b"}\npara\n')
    expect(losses(spaced)).toEqual(['field-unspellable /children/0'])

    const folded = edited('[a]: /u', (blocks) => { ofType(blocks[0], 'link_reference_definition').key = ' ' })
    expect(losses(folded)).toEqual(['field-unspellable /children/0'])

    const comment = documentOf({ type: 'comment', form: 'line', value: 'a\nb' })
    expect(losses(comment)).toContain('field-unspellable /children/0')

    const path = edited('{{ a.crv }}', (blocks) => { ofType(blocks[0], 'include').path = 'a\nb' })
    expect(losses(path)).toEqual(['field-unspellable /children/0'])
  })

  it('C2-W-117: a node with no spelling is left out and reported as structure-unspellable', () => {
    const empty = documentOf({ type: 'paragraph', children: [] }, paragraph('x'))
    expect(write(empty)).toBe('x\n')
    expect(losses(empty)).toEqual(['structure-unspellable /children/0'])

    const list = edited('- a\n\nx', (blocks) => { ofType(blocks[0], 'list').children = [] })
    expect(write(list)).toBe('x\n')
    expect(losses(list)).toEqual(['structure-unspellable /children/0'])

    const blocks = edited('| a |\n^ cap', (nodes) => { ofType(ofType(nodes[0], 'table').caption, 'caption').children.push(paragraph('two')) })
    expect(losses(blocks)).toContain('structure-unspellable /children/0/caption')

    const abbreviation = documentOf(paragraph({ type: 'abbreviation', key: 'HTML', namespace: 'abbr', expansion: 'Hyper' }, ' x'))
    expect(write(abbreviation)).toBe('HTML x\n')
    expect(losses(abbreviation)).toEqual(['structure-unspellable /children/0/children/0'])
  })

  it('C2-W-117: a frontmatter format and a definition key with no spelling are reported at their node', () => {
    const format = documentOf({ type: 'frontmatter', format: 'a b', value: 'a: b\n' }, paragraph('x'))
    const key = edited('[a]: /u', (blocks) => { ofType(blocks[0], 'link_reference_definition').key = 'a]b' })
    for (const tree of [format, key]) {
      const found = writeWithDiagnostics(tree).diagnostics
      expect(found.map((entry) => [entry.channel, entry.path])).toContainEqual(['render-loss', '/children/0'])
      for (const entry of found) expect(['field-unspellable', 'structure-unspellable']).toContain(entry.code)
    }
  })

  it('C2-W-012: a separator stands between the content of two blocks written into an inline slot', () => {
    const caption = edited('| a |\n^ cap', (blocks) => { ofType(ofType(blocks[0], 'table').caption, 'caption').children = [paragraph('one'), paragraph('two')] })
    expect(write(caption)).toBe('| a |\n^ one two\n')
  })

  it('C2-W-012: a separator stands between two blocks written into a cell', () => {
    const cell = edited('| a |', (blocks) => { ofType(childrenOf(childrenOf(childrenOf(blocks[0])[0])[0])[0], 'table_cell').children = [paragraph('x'), paragraph('y')] })
    expect(write(cell)).toBe('| x y |\n')
  })

  it('C2-W-013: a wrapper whose only node reads back as another block is lost, and the loss is reported', () => {
    const tree = documentOf(paragraph({ type: 'comment', form: 'line', value: 'c' }))
    const written = writeWithDiagnostics(tree)
    expect(written.source).toBe('%% c\n')
    expect(written.diagnostics.map((entry) => `${entry.code} ${entry.path ?? ''}`)).toEqual(['structure-unspellable /children/0/children/0'])
    expect(parse(written.source).children![0]!.type).toBe('comment')
  })

  it('C2-W-014: only the loss of a bare wrapper leaves the rest of the tree as it was', () => {
    const bare = documentOf(paragraph('a'), paragraph({ type: 'comment', form: 'line', value: 'c' }), paragraph('b'))
    const back = parse(write(bare))
    expect(back.children!.map((node) => node.type)).toEqual(['paragraph', 'comment', 'paragraph'])
    expect(treesEqual(documentOf(back.children![0]!, back.children![2]!), documentOf(paragraph('a'), paragraph('b')))).toBe(true)

    const attributed = documentOf({ type: 'paragraph', attrs: { classes: ['x'] }, children: [{ type: 'comment', form: 'line', value: 'c' }] })
    expect(losses(attributed)).toContain('field-unspellable /children/0')
  })

  it('C2-W-015: a block image is written as the image alone on its line', () => {
    const tree = documentOf({ type: 'paragraph', blockImage: true, children: [{ type: 'image', src: 'u', alt: 'i' }] })
    expect(write(tree)).toBe('![i](u)\n')
    expect(losses(tree)).toEqual([])
    expect(ofType(parse(write(tree)).children[0], 'paragraph').blockImage).toBe(true)
    expect(format('{#i}\n![i](u "t")')).toBe('{#i}\n![i](u "t")\n')
  })

  it('C2-W-016: a code span whose later line would open a block is refused with field-unspellable', () => {
    expect(losses(documentOf(paragraph(code('a\n::: x'))))).toContain('field-unspellable /children/0/children/0')
    expect(checkWriter('  - a\n- ```\n- a')).toBe('refused')
    expect(losses(documentOf(paragraph(code('a\nb'))))).toEqual([])
  })

  it('C2-W-112: the content of a second adjacent code span is written into the first', () => {
    const tree = documentOf(paragraph(code('a'), code('b')))
    expect(losses(tree)).toContain('structure-unspellable /children/0/children/1')
    expect(write(tree)).toBe('`ab`\n')
  })

  it('C2-W-112: the second of two adjacent code spans is reported', () => {
    expect(losses(documentOf(paragraph(code('a'), code('b'))))).toContain('structure-unspellable /children/0/children/1')
  })

  it('C2-W-115: a math block is its display math span alone on its line, below its attribute line', () => {
    const tree = documentOf({ type: 'paragraph', blockMath: true, attrs: { classes: ['m'] }, children: [{ type: 'math', display: true, value: 'x' }] })
    expect(write(tree)).toBe('{.m}\n$$`x`\n')
    expect(treesEqual(parse(write(tree)), tree)).toBe(true)
  })
})

describe('layout', () => {
  it('C2-W-017: one blank line stands between two sibling blocks', () => {
    expect(format('a\n\n\n\nb')).toBe('a\n\nb\n')
    expect(format('= a\nb')).toBe('= a\n\nb\n')
    expect(format('[b]: /u\n[c]: /u')).toBe('[b]: /u\n\n[c]: /u\n')
  })

  it('C2-W-018: no blank line before a nested list in a tight list and none before a caption', () => {
    expect(format('- a\n\n  - b')).toBe('- a\n  - b\n')
    expect(format('- a\n  - b\n- c')).toBe('- a\n  - b\n- c\n')
    expect(format('| a |\n^ cap')).toBe('| a |\n^ cap\n')
  })

  it('C2-W-019: no blank line between two items of a tight list', () => {
    expect(format('- a\n- b')).toBe('- a\n- b\n')
  })

  it('C2-W-020: a run of blank lines is one blank line, and blank lines in verbatim content are data', () => {
    expect(format('a\n\n\n\n\n\nb')).toBe('a\n\nb\n')
    expect(format('```\na\n\n\nb\n```')).toBe('```\na\n\n\nb\n```\n')
    expect(format('---\na: b\n\n\nc: d\n---\n\nx')).toBe('---\na: b\n\n\nc: d\n---\n\nx\n')
  })

  it('C2-W-021: a line of spaces is written empty, and a line of a code block as it is', () => {
    expect(format('- a\n   \n  b')).toBe('- a\n\n  b\n')
    expect(write(documentOf({ type: 'code_block', value: 'a\n  \nb\n' }))).toBe('```\na\n  \nb\n```\n')
  })

  it('C2-W-022: no space at the end of a line, one line ending at the end, and the no-break space stays', () => {
    expect(format('a   \nb\t')).toBe('a\nb\n')
    expect(format('a\n\n\n')).toBe('a\n')
    expect(format('a\\ \nb')).toBe('a\\ \nb\n')
  })

  it('C2-W-022: a paragraph that ends in a hard break ends the output with one line ending', () => {
    expect(format('a\\')).toBe('a\\\n')
  })

  it('C2-W-022: a link definition with an empty destination is written with no space at the end of its line', () => {
    const tree = edited('[a]: /u', (blocks) => { ofType(blocks[0], 'link_reference_definition').href = '' })
    expect(write(tree)).not.toMatch(/[ \t]\n/)
  })

  it('C2-W-023: a line that ends in a line comment has no space at its end', () => {
    expect(format('a %% note  ')).toBe('a %% note\n')
  })

  it('C2-W-024: later blocks and continuation lines stand at the content column', () => {
    expect(format('- a\nlazy\n- b\n     c')).toBe('- a\n  lazy\n- b\n  c\n')
    expect(format('- a\n\n     b\n- c')).toBe('- a\n\n  b\n- c\n')
    expect(format('[^n]: first\n\n    later')).toBe('[^n]: first\n\n  later\n')
    expect(format('| a |\n^ c\n      d')).toBe('| a |\n^ c\n  d\n')
    expect(format(':: term\n      more\n: d')).toBe(':: term\n   more\n: d\n')
    expect(format('  - a\n  - b')).toBe('- a\n- b\n')
  })

  it('C2-W-025: one space follows a marker, two a marker of one uppercase letter and a dot', () => {
    expect(format('-   a')).toBe('- a\n')
    expect(format('A.  a\n    b\nB.  c')).toBe('A.  a\n    b\nB.  c\n')
  })

  it('C2-W-026: a continuation line that would read as a list marker is kept text by an escape', () => {
    expect(format('- a\n  \\- b')).toBe('- a\n  \\- b\n')
    expect(format('- a\n  1\\. b')).toBe('- a\n  1\\. b\n')
  })

  it('C2-W-027: a first block that is not a paragraph has its opener on the marker line', () => {
    expect(format('- ```js\n  x\n  ```')).toBe('- ```js\n  x\n  ```\n')
    expect(format(':: t\n: - a\n  - b')).toBe(':: t\n: - a\n  - b\n')
    expect(format('[^n]: ```\n  x\n  ```')).toBe('[^n]: ```\n  x\n  ```\n')
  })

  it('C2-W-028: two adjacent lists of one kind are separated by three blank lines', () => {
    expect(format('- a\n- b\n\n\n\n\n\n- c')).toBe('- a\n- b\n\n\n\n- c\n')
    expect(format('1. a\n2. b\n\n{start=5}\n. c')).toBe('1. a\n2. b\n\n\n\n{start=5}\n. c\n')
  })

  it('C2-W-029: two lists are adjacent also when the block between them writes nothing', () => {
    const tree = documentOf(parse('- a').children![0]!, { type: 'paragraph', children: [] }, parse('- b').children![0]!)
    expect(write(tree)).toBe('- a\n\n\n\n- b\n')
    expect(losses(tree)).toEqual(['structure-unspellable /children/1'])
  })

  it('C2-W-030: a loose list has one blank line between all items, a tight list none', () => {
    expect(format('- a\n\n\n- b\n- c')).toBe('- a\n\n- b\n\n- c\n')
    expect(format('- a\n- b\n\n  c\n- d')).toBe('- a\n- b\n\n  c\n- d\n')
  })

  it('C2-W-031: a quote of lines carries the mark on every line and a bare mark on a blank line', () => {
    expect(format('> a\nb\n>\n> c')).toBe('> a\n> b\n>\n> c\n')
    expect(format('> - a\n>\n>   b')).toBe('> - a\n>\n>   b\n')
  })

  it('C2-W-032: an empty div has one blank line between opener and closer, an empty line block none', () => {
    expect(format(':::\n:::')).toBe(':::\n\n:::\n')
    expect(format('::: note\n:::')).toBe('::: note\n\n:::\n')
    expect(format('::: \\\n:::')).toBe('::: \\\n\n:::\n')
    expect(format('::: |\n:::')).toBe('::: |\n:::\n')
  })

  it('C2-W-033: every fence, div and comment block is written with its closer', () => {
    expect(format('```js\na')).toBe('```js\na\n```\n')
    expect(format('::: note\na')).toBe('::: note\na\n:::\n')
    expect(format('%%%\na')).toBe('%%%\na\n%%%\n')
    expect(format('- ````js\n  a\n  `````')).toBe('- ```js\n  a\n  ```\n')
  })

  it('C2-W-033: a code or raw block whose value has no final line break gets one, and value is reported', () => {
    const fence = documentOf({ type: 'code_block', value: 'x' })
    expect(write(fence)).toBe('```\nx\n```\n')
    expect(losses(fence)).toEqual(['field-unspellable /children/0'])
    const raw = documentOf({ type: 'raw_block', format: 'html', value: '<b>' })
    expect(write(raw)).toBe('```=html\n<b>\n```\n')
    expect(losses(raw)).toEqual(['field-unspellable /children/0'])
  })

  it('C2-W-034: a region marker keeps its line', () => {
    const tree = documentOf(
      { type: 'code_block', value: 'x\n' }, { type: 'comment', form: 'line', value: '#region r' },
      { type: 'code_block', value: 'y\n' }, { type: 'comment', form: 'line', value: '#endregion' },
    )
    expect(write(tree)).toBe('```\nx\n```\n%% #region r\n\n```\ny\n```\n%% #endregion\n')
    expect(format('a\n%% #endregion')).toBe('a\n%% #endregion\n')
  })

  it('C2-W-114: no blank line between a term and its description or between two entries', () => {
    expect(format(':: t\n\n: d\n\n:: u\n: e')).toBe(':: t\n: d\n:: u\n: e\n')
    expect(format(':: t\n: d\n\n  more\n:: u\n: e')).toBe(':: t\n: d\n\n  more\n:: u\n: e\n')
  })
})

describe('canonical forms: blocks', () => {
  it('C2-W-035: a heading is written with =, one per level, and one space', () => {
    expect(format('## T')).toBe('== T\n')
    expect(format('=   T')).toBe('= T\n')
    expect(format('###### T')).toBe('====== T\n')
  })

  it('C2-W-035: a level above six is written with six markers and reported', () => {
    const tree = documentOf({ type: 'heading', level: 7, children: [text('T')] })
    expect(write(tree)).toBe('====== T\n')
    expect(losses(tree)).toEqual(['field-unspellable /children/0'])
  })

  it('C2-W-035: a continuation line of a heading stands at the marker width plus one', () => {
    expect(format('## a\n       b')).toBe('== a\n   b\n')
    expect(format('= a\\\n  b')).toBe('= a\\\n  b\n')
  })

  it('C2-W-036: a thematic break is written as ***', () => {
    expect(write(documentOf({ type: 'thematic_break' }))).toBe('***\n')
    expect(format('*****')).toBe('***\n')
  })

  it('C2-W-037: a tilde fence is rewritten to a backtick fence', () => {
    expect(format('~~~js\na\n~~~')).toBe('```js\na\n```\n')
  })

  it('C2-W-038: the fence is the shortest run longer than every bare backtick run of the value', () => {
    expect(format('``````\na\n```\n``````')).toBe('````\na\n```\n````\n')
    const tree = documentOf({ type: 'code_block', value: 'a\n  ````\nb\n' }, { type: 'raw_block', format: 'html', value: '```\n' })
    expect(write(tree)).toBe('`````\na\n  ````\nb\n`````\n\n````=html\n```\n````\n')
  })

  it('C2-W-039: a div has the shortest colon run longer than the runs inside it', () => {
    expect(format(':::: a\n::::: b\nx\n:::::\n::::')).toBe(':::: a\n::: b\nx\n:::\n::::\n')
    const tree = documentOf({ type: 'div', children: [{ type: 'div', children: [{ type: 'div', children: [paragraph('x')] }] }] })
    expect(write(tree)).toBe(':::::\n::::\n:::\nx\n:::\n::::\n:::::\n')
  })

  it('C2-W-039: the opener is the run, the name, the quoted title and the label', () => {
    expect(format(':::   tip   "Title"   [lbl]\nx\n:::')).toBe('::: tip "Title" [lbl]\nx\n:::\n')
    expect(format('::: toc\n:::')).toBe('::: toc\n\n:::\n')
    expect(format('{.box .y}\n:::\nx\n:::')).toBe('{.y}\n::: box\nx\n:::\n')
    expect(format('{.figure .x}\n:::\nx\n:::')).toBe('{.figure .x}\n:::\nx\n:::\n')
    expect(format('```=html\n<b>\n```')).toBe('```=html\n<b>\n```\n')
  })

  it('C2-W-040: a title with a double quote and a label with a closing bracket are left out and reported', () => {
    const title = edited('::: tip "T" [l]\nx\n:::', (blocks) => { ofType(blocks[0], 'admonition').title = [text('a "b"')] })
    expect(write(title)).toBe('::: tip [l]\nx\n:::\n')
    expect(losses(title)).toEqual(['field-unspellable /children/0'])
    const label = edited('::: box "T" [l]\nx\n:::', (blocks) => { ofType(blocks[0], 'div').groupLabel = 'a]b' })
    expect(write(label)).toBe('::: box "T"\nx\n:::\n')
    expect(losses(label)).toEqual(['field-unspellable /children/0'])
    const broken = edited('```php "T" [l]\nx\n```', (blocks) => { ofType(blocks[0], 'code_block').groupLabel = 'a\nb' })
    expect(write(broken)).toBe('```php "T"\nx\n```\n')
    expect(losses(broken)).toEqual(['field-unspellable /children/0'])
  })

  it('C2-W-040: the opener of a code fence is the run glued to the language, the title and the label', () => {
    expect(format('~~~ php   "src/Auth.php"   [Composer]\nx\n~~~')).toBe('```php "src/Auth.php" [Composer]\nx\n```\n')
  })

  it('C2-W-041: the title of a code block stands in the info string, and a title key stays a key', () => {
    expect(format('```php "T"\nx\n```')).toBe('```php "T"\nx\n```\n')
    expect(format('{title="T"}\n```php\nx\n```')).toBe('{title=T}\n```php\nx\n```\n')
  })

  it('C2-W-042: a bullet item is written with the character of the tree', () => {
    expect(format('- a\n- b\n\n* c\n* d')).toBe('- a\n- b\n\n* c\n* d\n')
  })

  it('C2-W-043: an ordered list keeps its style, its delimiter and its start value', () => {
    expect(format('a) x\nb) y')).toBe('a) x\nb) y\n')
    expect(format('iv. x\nv. y')).toBe('iv. x\nv. y\n')
    expect(format('3) a\n4) b')).toBe('3) a\n4) b\n')
  })

  it('C2-W-044: a decimal list is written bare or numbered as recorded, and bare with no fact', () => {
    expect(format('. a\n. b')).toBe('. a\n. b\n')
    expect(format('3. a\n4. b')).toBe('3. a\n4. b\n')
    expect(format('{start=3}\n. a\n. b')).toBe('{start=3}\n. a\n. b\n')
    expect(format('{start=3}\n1. a\n1. b')).toBe('3. a\n4. b\n')
    expect(format('1. a\n1. b\n1. c')).toBe('1. a\n2. b\n3. c\n')
    expect(write(parse('3. a\n4. b'))).toBe('{start=3}\n. a\n. b\n')
  })

  it('C2-W-044: a decimal list with ) is written with sequential digits', () => {
    expect(format('1) a\n1) b')).toBe('1) a\n2) b\n')
    expect(write(parse('3) a\n4) b'))).toBe('3) a\n4) b\n')
  })

  it('C2-W-044: a start value of more than nine digits has no spelling, and the list is written from 1', () => {
    const period = edited('1. a\n2. b', (blocks) => { ofType(blocks[0], 'list').marker.start = 1234567890 })
    expect(write(period)).toBe('. a\n. b\n')
    const paren = edited('1) a\n2) b', (blocks) => { ofType(blocks[0], 'list').marker.start = 1234567890 })
    expect(write(paren)).toBe('1) a\n2) b\n')
  })

  it('C2-W-044: a later marker whose number would have more than nine digits is written as 1', () => {
    expect(format('999999999) a\n1) b')).toBe('999999999) a\n1) b\n')
    expect(format('999999999. a\n1. b')).toBe('999999999. a\n1. b\n')
  })

  it('C2-W-045: a list that is not decimal is written with its letters or numerals in sequence', () => {
    expect(format('c. x\nc. y\nc. z')).toBe('c. x\nd. y\ne. z\n')
    expect(format('ii) x\nii) y')).toBe('ii) x\niii) y\n')
  })

  it('C2-W-045: a first marker that would read as another style moves its value to a start attribute', () => {
    const start = (src: string, value: number): DocumentNode => edited(src, (blocks) => { ofType(blocks[0], 'list').marker.start = value })
    expect(write(start('a. x\nb. y', 9))).toBe('{start=9}\na. x\nb. y\n')
    expect(write(start('A.  x\nB.  y', 9))).toBe('{start=9}\nA.  x\nB.  y\n')
    expect(write(start('i. x\nii. y', 5))).toBe('{start=5}\ni. x\nii. y\n')
    expect(write(start('i. x\nii. y', 4))).toBe('iv. x\nv. y\n')
    for (const tree of [start('a. x\nb. y', 9), start('i. x\nii. y', 5)]) {
      expect(losses(tree)).toEqual([])
      expect(treesEqual(parse(write(tree)), tree)).toBe(true)
    }
  })

  it('C2-W-045: a marker the grammar cannot hold is written as the first value of its style', () => {
    const start = (value: number): DocumentNode => edited('a. x\nb. y', (blocks) => { ofType(blocks[0], 'list').marker.start = value })
    expect(write(start(26))).toBe('z. x\na. y\n')
    expect(write(start(27))).toBe('{start=27}\na. x\nb. y\n')
  })

  it('C2-W-046: a task item is written with the character in task.mark', () => {
    expect(format('- [X] a\n- [ ] b')).toBe('- [x] a\n- [ ] b\n')
  })

  it('C2-W-047: the attributes of a block are one brace block on the line directly above it', () => {
    expect(format('{.a}{k=v}{#b}\npara')).toBe('{#b .a k=v}\npara\n')
    expect(format('{.a}\n{#b}\n{k=v}\npara')).toBe('{#b .a k=v}\npara\n')
    expect(format('{.c}\n| a |\n^ cap')).toBe('{.c}\n| a |\n^ cap\n')
  })

  it('C2-W-048: the parts are written in the order id, classes, language, keys', () => {
    expect(format('{k=v .a :en #b .c x="y z"}\npara')).toBe('{#b .a .c :en k=v x="y z"}\npara\n')
    expect(format('{  #b   .a  }\npara')).toBe('{#b .a}\npara\n')
  })

  it('C2-W-048: a class the .name form cannot hold is a quoted class key at its place', () => {
    const tree = documentOf({ type: 'paragraph', attrs: { id: 'i', classes: ['a', 'b.c', 'd'], keyValues: [['k', 'v']] }, children: [text('x')] })
    expect(write(tree)).toBe('{#i .a class="b.c" .d k=v}\nx\n')
    expect(treesEqual(parse(write(tree)), tree)).toBe(true)
  })

  it('C2-W-049: an empty value is the bare key, and a key that starts with _ keeps the empty quotes', () => {
    expect(format('[x]{kbd=""} [y]{_k=""}')).toBe('[x]{kbd} [y]{_k=""}\n')
  })

  it('C2-W-050: a value is unquoted where it has the shape of an unquoted value', () => {
    expect(format('[x]{a="b" c="d e"}')).toBe('[x]{a=b c="d e"}\n')
  })

  it('C2-W-051: the attributes of a list item and of a cell are glued to the marker', () => {
    expect(format('- {.x} a\n- b')).toBe('- {.x} a\n- b\n')
    expect(format('|{.c} a | b |')).toBe('|{.c} a | b |\n')
  })

  it('C2-W-052: YAML frontmatter has the bare opener, every other format its name glued', () => {
    expect(format('---yaml\na: b\n---\n\nx')).toBe('---\na: b\n---\n\nx\n')
    expect(format('--- toml\na = 1\n---\n\nx')).toBe('---toml\na = 1\n---\n\nx\n')
    expect(format('---json\n{}\n---\n\nx')).toBe('---json\n{}\n---\n\nx\n')
  })

  it('C2-W-053: a caption is written directly below its block as ^, one space and its content', () => {
    expect(format('| a | b |\n^   The caption')).toBe('| a | b |\n^ The caption\n')
    expect(format('```\nx\n```\n^ Code cap')).toBe('```\nx\n```\n^ Code cap\n')
  })

  it('C2-W-054: an id is written on a heading exactly when attrs.id holds one', () => {
    expect(format('{#my}\n= Title')).toBe('{#my}\n= Title\n')
    expect(write(documentOf({ type: 'heading', level: 1, generatedId: 'title', children: [text('Title')] }))).toBe('= Title\n')
    expect(write(parse('= Title'))).toBe('= Title\n')
  })

  it('C2-W-055: a definition is written at its place, and definitions are neither moved nor sorted', () => {
    expect(format('[b]: /b\n\npara[^n]\n\n[^n]: first\n\n    later\n\n*[HTML]: Hyper Text\n\n[a]: /a'))
      .toBe('[b]: /b\n\npara[^n]\n\n[^n]: first\n\n  later\n\n*[HTML]: Hyper Text\n\n[a]: /a\n')
  })

  it('C2-W-056: a link definition is the label, the destination and the title in double quotes', () => {
    expect(format('[a]:    /a   "t"')).toBe('[a]: /a "t"\n')
    expect(format('[a]: /a')).toBe('[a]: /a\n')
  })

  it('C2-W-056: a link definition with an empty destination is reported', () => {
    expect(losses(edited('[a]: /u', (blocks) => { ofType(blocks[0], 'link_reference_definition').href = '' }))).toEqual(['field-unspellable /children/0'])
  })

  it('C2-W-057: an empty body in a supplied tree is reported as structure-unspellable', () => {
    expect(losses(edited('- a\n- b', (blocks) => { ofType(childrenOf(blocks[0])[0], 'list_item').children = [] }))).toContain('structure-unspellable /children/0/children/0')
    expect(losses(edited(':: t\n: d', (blocks) => { ofType(childrenOf(blocks[0])[1], 'definition_description').children = [] }))).toContain('structure-unspellable /children/0/children/1')
    expect(losses(edited(':: t\n: d', (blocks) => { ofType(childrenOf(blocks[0])[0], 'definition_term').children = [] }))).toContain('structure-unspellable /children/0/children/0')
    expect(losses(edited('[^n]: x', (blocks) => { ofType(blocks[0], 'footnote').children = [] }))).toEqual(['structure-unspellable /children/0'])
  })

  it('C2-W-057: the empty spelling of an item is a marker and a comment', () => {
    expect(format('- %% c')).toBe('- %% c\n')
  })

  it('C2-W-058: an include directive has one space inside the braces and between its parts', () => {
    expect(format('{{   a.crv#sec@shift:1@lines:1-2   }}')).toBe('{{ a.crv #sec @lines:1-2 @shift:1 }}\n')
    expect(format('{{ a.crv @code:js @shift:1 @cols:1-2 @rows:1-2 @region:r @lines:1-2 }}')).toBe('{{ a.crv @lines:1-2 @region:r @rows:1-2 @cols:1-2 @shift:1 @code:js }}\n')
  })

  it('C2-W-058: a path is bare where the bare form holds it and quoted otherwise', () => {
    expect(format('{{ "a.crv" }}')).toBe('{{ a.crv }}\n')
    expect(format('{{ "a b.crv" }}')).toBe('{{ "a b.crv" }}\n')
    expect(format('{{ "a\\"b\\\\c.crv" }}')).toBe('{{ "a\\"b\\\\c.crv" }}\n')
    expect(write(edited('{{ a.crv }}', (blocks) => { ofType(blocks[0], 'include').path = 'a#b' }))).toBe('{{ "a#b" }}\n')
  })

  it('C2-W-058: the options of a supplied tree are written in the order of the directive grammar', () => {
    const tree = edited('{{ a.crv @shift:1 }}', (blocks) => { ofType(blocks[0], 'include').options = [['shift', '1'], ['lines', '1-2']] })
    expect(write(tree)).toBe('{{ a.crv @lines:1-2 @shift:1 }}\n')
  })

  it('C2-W-058: an option with another key follows the six, in the order of the node', () => {
    const tree = edited('{{ a.crv @shift:1 }}', (blocks) => { ofType(blocks[0], 'include').options = [['zeta', '1'], ['shift', '1']] })
    expect(write(tree)).toBe('{{ a.crv @shift:1 @zeta:1 }}\n')
  })

  it('C2-W-059: a comment is written in its form', () => {
    expect(format('%%note')).toBe('%% note\n')
    expect(format('%%')).toBe('%%\n')
    expect(format('a {%c%} b')).toBe('a {% c %} b\n')
    expect(format('%%%%%\na\n%%%%%')).toBe('%%%\na\n%%%\n')
    expect(format('%%%%%\na\n%%%\nb\n%%%%%')).toBe('%%%%\na\n%%%\nb\n%%%%\n')
  })

  it('C2-W-059: a comment line stands at the column of its container and directly below the block before it', () => {
    expect(format('- a\n  %% c')).toBe('- a\n  %% c\n')
    expect(format('```\nx\n```\n%% c')).toBe('```\nx\n```\n%% c\n')
    expect(format('= H\n%% c')).toBe('= H\n%% c\n')
    expect(format('::: figure\n![a](u)\n\n![b](v)\n:::\n%% c\n^ cap')).toBe('::: figure\n![a](u)\n\n![b](v)\n:::\n%% c\n^ cap\n')
  })

  it('C2-W-059: a comment below a paragraph that a container holds follows one blank line', () => {
    expect(format('para\n\n%% c')).toBe('para\n\n%% c\n')
    expect(write(documentOf(paragraph('para'), { type: 'comment', form: 'line', value: 'c' }))).toBe('para\n\n%% c\n')
    expect(format('- a\n\n  %% c\n\n  b\n- d')).toBe('- a\n\n  %% c\n\n  b\n- d\n')
  })

  it('C2-W-059: a line comment below a table is written after a blank line', () => {
    const tree = documentOf(parse('| a |').children![0]!, { type: 'comment', form: 'line', value: 'c' })
    expect(write(tree)).toBe('| a |\n\n%% c\n')
    expect(treesEqual(parse(write(tree)), tree)).toBe(true)
  })

  it('C2-W-060: a term is ::, a description is :, and later blocks stand at the content column', () => {
    expect(format('::   t\n:   d')).toBe(':: t\n: d\n')
    expect(format(':: t\n: ```\n  x\n  ```\n\n     later')).toBe(':: t\n: ```\n  x\n  ```\n\n  later\n')
  })
})

describe('canonical forms: tables', () => {
  it('C2-W-061: a row is a pipe, its cells and a closing pipe', () => {
    expect(format('|a|b|')).toBe('| a | b |\n')
  })

  it('C2-W-062: a cell is its prefix glued to the pipe, one space, its content and one space', () => {
    expect(format('|=   h   |   c   |')).toBe('|= h | c |\n')
    expect(format('|={>} Price |{<} l |{~} m |{> .x} q |')).toBe('|={>} Price |{<} l |{~} m |{> .x} q |\n')
    expect(format('|{> .x #i} q |')).toBe('|{> #i .x} q |\n')
  })

  it('C2-W-063: a span mark has the padding of a cell, and a caret or < that is no span is escaped', () => {
    expect(format('| a | b |\n|^| c |\n| d |<|')).toBe('| a | b |\n| ^ | c |\n| d | < |\n')
    expect(format('| a | b |\n| \\^ | \\< |')).toBe('| a | b |\n| \\^ | \\< |\n')
  })

  it('C2-W-064: a row is written with exactly the cells it has', () => {
    expect(format('| a |\n| b | c | d |')).toBe('| a |\n| b | c | d |\n')
  })

  it('C2-W-065: a row attribute is glued to the closing pipe', () => {
    expect(format('| a | b |{.r #i k=v}')).toBe('| a | b |{#i .r k=v}\n')
  })

  it('C2-W-066: with no fact a table is a pipe table, and a table with no rows a delimited table in csv', () => {
    expect(write(parse('{table}\n```tsv\na\tb\nc\td\n```'))).toBe('|= a |= b |\n| c | d |\n')
    const empty = documentOf({ type: 'table', columns: [], children: [] })
    expect(write(empty)).toBe('{table}\n```csv\n```\n')
    expect(losses(empty)).toEqual([])
  })

  it('C2-W-066: a table whose body carries headRows is a delimited table with its header-rows attribute', () => {
    const src = '{table header-rows=2}\n```csv\na,b\nc,d\ne,f\n```'
    expect(ofType(ofType(parse(src).children[0], 'table').children[1], 'table_body').headRows).toBe(2)
    expect(write(parse(src))).toBe(`${src}\n`)
    expect(write(parse('{table header-rows=0}\n```tsv\na\tb\n```'))).toBe('{table header-rows=0}\n```csv\na,b\n```\n')
  })

  it('C2-W-066: a delimited cell that holds the separator, a double quote or a line break is quoted', () => {
    expect(format('{table}\n```csv\n"a",b\n"c,d","e ""q"""\n```')).toBe('{table}\n```csv\na,b\n"c,d","e ""q"""\n```\n')
    expect(format('{table}\n```csv\na,"x\ny"\n```')).toBe('{table}\n```csv\na,"x\ny"\n```\n')
  })

  it('C2-W-067: continuation rows stand at the recorded places, and with no fact a row is one line', () => {
    const src = '| a | b |\n+ c | |\n+ d | e |'
    expect(format(src)).toBe(`${src}\n`)
    expect(write(parse(src))).toBe('| a c d | b e |\n')
  })

  it('C2-W-067: a break inside a label is not kept, and that cell is written on one line', () => {
    expect(format('| [x][a |\n+ b] |\n\n[a b]: /u')).toBe('| [x][a b] |\n+ |\n\n[a b]: /u\n')
  })

  it('C2-W-068: alignTables is off by default and does not change the tree', () => {
    const src = '| a | b |\n| ccc | |'
    expect(format(src)).toBe('| a | b |\n| ccc | |\n')
    expect(format(src, { alignTables: false })).toBe(format(src))
    const aligned = format(src, { alignTables: true })
    expect(aligned).toBe('| a   | b |\n| ccc |   |\n')
    expect(treesEqual(parse(aligned), parse(src))).toBe(true)
    expect(format(aligned, { alignTables: true })).toBe(aligned)
    expect(write(parse(src), { alignTables: true })).toBe(aligned)
  })

  it('C2-W-118: each segment is padded behind its content, and attribute and caption count toward no width', () => {
    expect(format('|={>} h | b |{.r}\n| ccc | |\n| ^ | d |\n| e | < |\n^ a long caption here', { alignTables: true }))
      .toBe('|={>} h | b |{.r}\n| ccc   |   |\n| ^     | d |\n| e     | < |\n^ a long caption here\n')
  })

  it('C2-W-118: on a continuation line the + takes the place of the leading pipe', () => {
    expect(format('| a | b |\n+ long text | |', { alignTables: true })).toBe('| a         | b |\n+ long text |   |\n')
  })

  it('C2-W-119: a wide cluster has width 2, every other cluster width 1', () => {
    expect(format('| 価格 | b |\n| abcd | c |', { alignTables: true })).toBe('| 価格 | b |\n| abcd | c |\n')
    expect(format('| § | b |\n| éé | c |', { alignTables: true })).toBe('| §  | b |\n| éé | c |\n')
    expect(format('| e\u0301 | b |\n| ab | c |', { alignTables: true })).toBe('| e\u0301  | b |\n| ab | c |\n')
  })

  it('Example 7: a table written with alignTables', () => {
    expect(format('|= Name |={>} 価格 | Note |\n| tea | 2 | < |\n+ green tea | | |\n| café | 12.5 | hot |\n', { alignTables: true }))
      .toBe('|= Name     |={>} 価格 | Note |\n| tea       | 2        | <    |\n+ green tea |          |      |\n| café      | 12.5     | hot  |\n')
  })
})

describe('canonical forms: inline', () => {
  it('C2-W-069: emphasis is written with / and strong with *', () => {
    expect(format('{/a/} {*b*}')).toBe('/a/ *b*\n')
    expect(format('/a/ and *f g*')).toBe('/a/ and *f g*\n')
  })

  it('C2-W-069: the braced form is written where the bare delimiter would not open, close or pair', () => {
    expect(format('{/usr/local/}')).toBe('{/usr/local/}\n')
    expect(format('{/b/}c and d{*e*}')).toBe('{/b/}c and d{*e*}\n')
    const tree = documentOf(paragraph('x', inline('emphasis', 'a'), 'y ', inline('strong', ' b ')))
    expect(write(tree)).toBe('x{/a/}y {* b *}\n')
  })

  it('C2-W-069: strong in a caption joined from two blocks is written bare where the bare form reads back', () => {
    const tree = edited('| a |\n^ cap', (blocks) => { ofType(ofType(blocks[0], 'table').caption, 'caption').children = [paragraph('one'), paragraph(inline('strong', 'two'))] })
    expect(inlinesOf(ofType(ofType(parse('| a |\n^ one *two*').children[0], 'table').caption, 'caption').children[0])[1]?.type).toBe('strong')
    expect(write(tree)).toBe('| a |\n^ one *two*\n')
  })

  it('C2-W-070: emphasis or strong inside its own kind is written in the braced form', () => {
    const tree = documentOf(paragraph(inline('emphasis', 'a ', inline('strong', inline('emphasis', 'b')))))
    expect(write(tree)).toBe('{/a *{/b/}*/}\n')
    expect(format('{*x {*y*}*}')).toBe('{*x {*y*}*}\n')
  })

  it('C2-W-071: underline, strike and highlight are written in their braced forms', () => {
    expect(format('{_u_} {~s~} {=h=}')).toBe('{_u_} {~s~} {=h=}\n')
    expect(write(documentOf(paragraph(inline('underline', 'u'), ' ', inline('strike', 's'), ' ', inline('highlight', 'h'))))).toBe('{_u_} {~s~} {=h=}\n')
  })

  it('C2-W-072: a replacement is a deletion directly followed by an insertion', () => {
    expect(write(documentOf(paragraph(inline('delete', 'old'), inline('insert', 'new'))))).toBe('{-old-}{+new+}\n')
  })

  it('C2-W-073: a link title is written in double quotes, and a title key stays a key', () => {
    expect(format('[a](/u \'T\') ![i](/v \'T\')')).toBe('[a](/u "T") ![i](/v "T")\n')
    expect(format('[b](/u){title=x}')).toBe('[b](/u){title=x}\n')
  })

  it('C2-W-074: an empty destination is written with no placeholder', () => {
    const tree = documentOf(paragraph({ type: 'link', href: '', children: [text('text')] }, ' ', { type: 'image', src: '', alt: 'alt' }, ' x'))
    expect(write(tree)).toBe('[text]() ![alt]() x\n')
    expect(format('[text]() ![alt]()')).toBe('[text]() ![alt]()\n')
  })

  it('C2-W-075: a reference is written with the recorded text, and from the tree with no record', () => {
    const src = '[a][ b ] [c][]\n\n[b]: /u\n\n[c]: /u'
    expect(format(src)).toBe(`${src}\n`)
    expect(write(parse(src))).toBe('[a][b] [c][]\n\n[b]: /u\n\n[c]: /u\n')
  })

  it('C2-W-075: a key that starts with a caret or an at-sign has one space before it', () => {
    const link = (key: string): LinkNode => ({ type: 'link', key, namespace: 'link', form: 'full', children: [text('a')] })
    const tree = documentOf(paragraph(link('^b'), ' ', link('@d')))
    expect(write(tree)).toBe('[a][ ^b] [a][ @d]\n')
    expect(treesEqual(parse(write(tree)), tree)).toBe(true)
  })

  it('C2-W-076: the attribute blocks of an inline host are merged into one, glued to the host', () => {
    expect(format('[x]{.a}{#b}{k=v} *b*{.x #y}{k=v}')).toBe('[x]{#b .a k=v} *b*{#y .x k=v}\n')
  })

  it('C2-W-077: a code span has the shortest backtick run that does not occur in its content', () => {
    expect(format('```a```')).toBe('`a`\n')
    expect(write(documentOf(paragraph(code('a``b`c'))))).toBe('```a``b`c```\n')
  })

  it('C2-W-077: a code span is padded where its content starts or ends with a backtick or a space that would be removed', () => {
    expect(write(documentOf(paragraph(code('`'), ' ', code('`a'), ' ', code(' a '), ' ', code(' a'))))).toBe('`` ` `` `` `a `` `  a  ` ` a`\n')
  })

  it('C2-W-078: a smart-punctuation node is written as its source', () => {
    expect(format('"a" \'b\' -- --- ...')).toBe('"a" \'b\' -- --- ...\n')
    expect(write(documentOf(paragraph({ type: 'smart_punctuation', kind: 'ellipsis', glyph: '…', source: '...' }, ' x')))).toBe('... x\n')
  })

  it('C2-W-116: every other inline node is written in its one spelling', () => {
    const src = '@user #tag :smile: :ext[c] {^s^} {,s,} {+i+} {-d-} {#e#} ^[fn] </#id> <https://a.b> a\\ b !`lit` `raw`{=html}'
    expect(format(src)).toBe(`${src}\n`)
    expect(format('[^n]\n\n[^n]: x')).toBe('[^n]\n\n[^n]: x\n')
  })

  it('C2-W-116: an abbreviation is written as its key', () => {
    const src = '*[HTML]: Hyper\n\nHTML x'
    expect(inlinesOf(parse(src).children[1])[0]?.type).toBe('abbreviation')
    expect(format(src)).toBe(`${src}\n`)
  })

  it('C2-W-116: a caption number is written as #', () => {
    const src = '| a |\n^ T #: c'
    expect(inlinesOf(ofType(ofType(parse(src).children[0], 'table').caption, 'caption').children[0])[1]?.type).toBe('caption_number')
    expect(format(src)).toBe(`${src}\n`)
  })

  it('C2-W-116: an emphasis with no children is left out and reported', () => {
    const tree = documentOf(paragraph('a', inline('emphasis'), 'b'))
    expect(write(tree)).toBe('ab\n')
    expect(losses(tree)).toEqual(['structure-unspellable /children/0/children/1'])
  })

  it('C2-W-079: a hard break is written as a backslash at the end of the line', () => {
    expect(format('a\\\nb')).toBe('a\\\nb\n')
    expect(write(documentOf(paragraph('a', { type: 'hard_break' }, 'b')))).toBe('a\\\nb\n')
  })

  it('C2-W-079: a hard break in a hard-break block written in the class form is a backslash', () => {
    expect(format('::: hardbreaks\na\\\nb\n:::')).toBe('::: hardbreaks\na\\\nb\n:::\n')
  })

  it('C2-W-080: in a line block and in a hard-break block written with its opener a hard break is the bare line ending', () => {
    expect(format('::: |\na\nb\n:::')).toBe('::: |\na\nb\n:::\n')
    expect(format('::: \\\na\nb\n:::')).toBe('::: \\\na\nb\n:::\n')
  })

  it('C2-W-081: with no fact the opener is used when hardbreaks is the last class, and the class form otherwise', () => {
    expect(write(parse('{.x .hardbreaks}\n:::\na\nb\n:::'))).toBe('{.x}\n::: \\\na\nb\n:::\n')
    const first = write(parse('{.hardbreaks .x}\n:::\na\nb\n:::'))
    expect(first.split('\n').slice(0, 2)).toEqual(['{.x}', '::: hardbreaks'])
    expect(treesEqual(parse(first), parse('{.hardbreaks .x}\n:::\na\nb\n:::'))).toBe(true)
  })

  it('C2-W-082: a quote is written with > lines with no fact, and a sigil div has one space before its sigil', () => {
    expect(write(parse(':::   >\na\n:::'))).toBe('> a\n')
    expect(format(':::   >\na\n:::')).toBe('::: >\na\n:::\n')
    expect(format(':::   |\na\n:::')).toBe('::: |\na\n:::\n')
    expect(format(':::   \\\na\n:::')).toBe('::: \\\na\n:::\n')
  })

  it('C2-W-082: a quote with no children is one line that holds only >, or a quote fence with no body', () => {
    expect(write(documentOf({ type: 'block_quote', children: [] }))).toBe('>\n')
    expect(format('>')).toBe('>\n')
    expect(format('::: >\n:::')).toBe('::: >\n:::\n')
  })
})

describe('the sidecar', () => {
  it('C2-W-083: the five spellings are taken from the sidecar, and their defaults are written without it', () => {
    const src = '1. a\n2. b\n\n::: >\nq\n:::\n\n{.hardbreaks}\n:::\nx\ny\n:::\n\n{table}\n```csv\nh\nc\n```\n\n| a |\n+ b |'
    const written = format(src)
    expect(written.split('\n\n').map((block) => block.split('\n')[0])).toEqual(['1. a', '::: >', '::: hardbreaks', '{table}', '| a |'])
    expect(write(parse(src)).split('\n\n').map((block) => block.split('\n')[0])).toEqual(['. a', '> q', '::: \\', '|= h |', '| a b |'])
  })

  it('C2-W-084: the verbatim text of a reference is taken from the sidecar', () => {
    expect(format('[a][ b ]\n\n[b]: /u')).toBe('[a][ b ]\n\n[b]: /u\n')
  })

  it('C2-W-085: no other fact is read, so the rest is canonical whatever the sidecar records', () => {
    const src = '---yaml\na: b\n---\n\n#  T\n\n*****\n\n~~~~\nc\n~~~~\n\n   -   a\n       b\n\n\n\n\nx'
    const { document, layout } = parseWithLayout(src)
    expect(write(document, { layout })).toBe('---\na: b\n---\n\n= T\n\n***\n\n```\nc\n```\n\n- a\n  b\n\nx\n')
    expect(write(document, { layout })).toBe(write(document))
  })

  it('C2-W-086: a fact that contradicts the tree is ignored', () => {
    const { document, layout } = parseWithLayout('| *a* | b |')
    const nodes = layout.nodes.map((entry) => (entry.path === '/children/0' ? { ...entry, sourceFormat: 'csv' as const } : entry))
    expect(write(document, { layout: { nodes } })).toBe('| *a* | b |\n')
  })

  it('C2-W-087: both gates hold with and without a sidecar', () => {
    expect(checkWriter('1. a\n1. b\n\n::: >\nq\n:::\n\n::: \\\nx\ny\n:::\n\n| a |\n+ b |\n\n[r][ k ]\n\n[k]: /u')).toBeNull()
  })
})

describe('escaping', () => {
  it('C2-W-088: a backslash is written exactly where the output without it would parse to another tree', () => {
    expect(format('\\# a')).toBe('\\# a\n')
    expect(format('a \\# b \\. c\\!')).toBe('a # b . c!\n')
    expect(checkWriter('a \\# b \\. c\\!')).toBeNull()
  })

  it('C2-W-089: an escape is decided in the context of the line, not from a list of characters', () => {
    expect(format('\\- a')).toBe('\\- a\n')
    expect(format('a\n\\- b')).toBe('a\n- b\n')
    expect(format('- a\n  \\- b')).toBe('- a\n  \\- b\n')
  })

  it('C2-W-090: one escape makes the whole run of an opener text', () => {
    expect(format('\\~\\~\\~')).toBe('\\~~~\n')
    expect(format('\\:\\:\\:\\:')).toBe('\\::::\n')
  })

  it('C2-W-091: one escape does not cause others', () => {
    expect(format('\\# a \\# b')).toBe('\\# a # b\n')
    expect(format('\\*e\\* \\/f\\/')).toBe('\\*e* \\/f/\n')
  })

  it('C2-W-092: a paragraph line that would read as a block opener is escaped', () => {
    for (const src of [
      '\\# a', '\\= a', '\\###### a', '\\| a |', '\\```', '\\~~~', '\\:::', '\\%%%', '1\\. a', '\\- a', '\\* a', '\\:: t',
      ':: t\n: d\n\n\\: x', '\\[a]: /u', '\\[^a]: x', '\\> q', 'a\n\\***', '\\{.a}\nb', '\\{{ a }}', '\\---', 'a \\%% b', '\\%% b',
    ]) expect(format(src)).toBe(`${src}\n`)
  })

  it('C2-W-092: a line that is no opener where it stands needs no escape', () => {
    expect(format('a = b\n= c')).toBe('a = b\n= c\n')
    expect(format('\\{.a}')).toBe('{.a}\n')
    expect(format('> a\n\\^ b')).toBe('> a\n> ^ b\n')
  })

  it('C2-W-092: a caret and a space on the line below an image paragraph is escaped', () => {
    const src = '![i](u)\n\\^ not a caption'
    expect(formatWithDiagnostics(src).diagnostics.filter((entry) => entry.channel === 'render-loss')).toEqual([])
    expect(format(src)).toBe(`${src}\n`)
  })

  it('C2-W-093: a delimiter that would open or close a span is escaped', () => {
    expect(format('a/b/ c* d')).toBe('a/b/ c* d\n')
    expect(format('\\*e\\*')).toBe('\\*e*\n')
    expect(format('{/a \\/} b/}')).toBe('{/a \\/} b/}\n')
  })

  it('C2-W-094: a bracket that would form a construct is escaped', () => {
    for (const src of ['\\[a](u)', '\\[a][b]', '\\[a][]', '\\[a]{.x}', '\\![a](u)', '\\[^a]']) expect(format(src)).toBe(`${src}\n`)
    expect(format('\\^[a]')).toBe('^\\[a]\n')
    expect(format('\\[a] (u)')).toBe('[a] (u)\n')
  })

  it('C2-W-095: a sigil that would form is escaped', () => {
    for (const src of ['\\@user', '\\#tag', '\\:smile:', '\\:ext[c]', '\\<https://a.b>', '\\</#id>', '\\`a\\`', '\\$`m`', '\\...', 'x \\"a\\"']) expect(format(src)).toBe(`${src}\n`)
    expect(format('a\\@b \\: c')).toBe('a@b : c\n')
  })

  it('C2-W-096: an opening brace that would form is escaped', () => {
    for (const src of ['a \\{% c %}', 'a \\{#e#}', 'a \\{/b/}']) expect(format(src)).toBe(`${src}\n`)
    // `{--}` is no form of its own any more, so its brace needs no escape.
    expect(format('a \\{--}')).toBe('a {--}\n')
    expect(format('[x]\\{.a}')).toBe('\\[x]{.a}\n')
    expect(format('a \\{ b')).toBe('a { b\n')
  })

  it('C2-W-097: a backslash in text is written as two before punctuation, before a space and at the end of a line', () => {
    expect(write(documentOf(paragraph('a\\b a\\. c\\ d e\\')))).toBe('a\\b a\\\\. c\\\\ d e\\\\\n')
  })

  it('C2-W-098: a pipe in the text of a cell is escaped, a pipe in a code span is not', () => {
    expect(format('| a \\| b | `c|d` |')).toBe('| a \\| b | `c|d` |\n')
  })

  it('C2-W-099: a line of underscores or of one hyphen needs no escape', () => {
    expect(write(documentOf(paragraph('___'), paragraph('-')))).toBe('___\n\n-\n')
  })

  it('C2-W-099: every second hyphen of a text run that would read as dashes is escaped', () => {
    expect(write(documentOf(paragraph('a -- b --- c ---- d')))).toBe('a -\\- b -\\-- c -\\--\\- d\n')
    expect(write(documentOf(paragraph('--flag and a --flag')))).toBe('-\\-flag and a -\\-flag\n')
    expect(write(documentOf(paragraph('---'), paragraph('x')))).toBe('-\\--\n\nx\n')
  })

  it('C2-W-099: an em dash node as the whole of line 1 is written below one blank line', () => {
    const tree = documentOf(paragraph({ type: 'smart_punctuation', kind: 'em_dash', glyph: '—', source: '---' }))
    expect(write(tree)).toBe('\n---\n')
    expect(treesEqual(parse(write(tree)), tree)).toBe(true)
  })

  it('Example 1: escapes that are needed stay', () => {
    const src = 'A line.\n\n\\# not a heading\n\n\\- not a list\n'
    expect(format(src)).toBe(src)
  })
})

describe('carve fmt', () => {
  it('C2-W-102: a tree from AST JSON is written with the defaults', () => {
    const json = encodeTree(parse('1. a\n2. b\n\n::: >\nq\n:::\n\n| a |\n+ b |'))
    expect(write(decodeTree(json))).toBe('. a\n. b\n\n> q\n\n| a b |\n')
  })

  it('Example 2: a tilde fence that holds a backtick fence', () => {
    expect(format('~~~~js\na\n```\nb\n~~~~\n')).toBe('````js\na\n```\nb\n````\n')
  })

  it('Example 3: repeated markers and two lists', () => {
    expect(format('1. a\n1. b\n1. c\n\n\n\n\n\n1. d\n')).toBe('1. a\n2. b\n3. c\n\n\n\n1. d\n')
  })

  it('Example 4: a title, an empty value, a task mark and a continuation line', () => {
    expect(format('[a](/u \'T\') and [x]{kbd=""}\n\n- [X] done\n- [ ] open\n   continued\n')).toBe('[a](/u "T") and [x]{kbd}\n\n- [x] done\n- [ ] open\n  continued\n')
  })

  it('Example 5: the order of an attribute block and the merge', () => {
    expect(format('{.a}{k=v}{#b}\n# Title\n\n- one\n\n  two\n- three\n')).toBe('{#b .a k=v}\n= Title\n\n- one\n\n  two\n- three\n')
  })

  it('Example 6: an opener on the marker line', () => {
    const src = '- ```js\n  x\n  ```\n\n- * inner\n'
    expect(format(src)).toBe(src)
  })
})

describe('diagnostics', () => {
  it('C2-W-103: a finding of the writer on a supplied tree has a code, a severity, a message, a channel and the path alone', () => {
    const found = writeWithDiagnostics(documentOf({ type: 'heading', level: 7, children: [text('T')] })).diagnostics
    expect(found).toHaveLength(1)
    expect(found[0]).toMatchObject({ code: 'field-unspellable', severity: 'warning', channel: 'render-loss', path: '/children/0' })
    expect(found[0]!.message).not.toBe('')
    expect(found[0]!.range).toBeUndefined()
  })

  it('C2-W-104: the two codes of the writer are in the render-loss channel', () => {
    const tree = documentOf({ type: 'heading', level: 7, children: [text('T')] }, { type: 'paragraph', children: [] })
    const found = writeWithDiagnostics(tree).diagnostics
    expect(found.map((entry) => [entry.code, entry.channel])).toEqual([['field-unspellable', 'render-loss'], ['structure-unspellable', 'render-loss']])
  })
})
