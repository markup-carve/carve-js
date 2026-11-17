import { expect, it } from 'vitest'
import { format, parse, render, type TableRowNode, treesEqual, writeWithDiagnostics, type DocumentNode } from '../src/index.ts'

it('C2-I-090/119 C44: a failed brace leaves the tag sigil available', () => {
  expect(render('{#d')).toContain('{<span class="tag"><strong>#d</strong></span>')
})

it('C2-I-049 C45: a repeated closing slash remains text under the current clause', () => {
  expect(render('/a//')).toContain('/a//')
})

it('C2-B-166, C2-B-169: the closing pipe is the last pipe of the line, also one quoted in a row attribute', () => {
  expect(render('||{d="|"}')).toMatch(/^<p>/)
  expect(render('| a |{title="x|y"}')).toBe('<p>| a |{title="x|y"}</p>')
  expect(render('||{d="\\|"}')).toMatch(/^<table>/)
  expect(render('||{!}')).toMatch(/^<p>/)
})

function firstRow(tree: DocumentNode): TableRowNode {
  const table = tree.children[0]
  const group = table?.type === 'table' ? table.children[0] : undefined
  const row = group?.type === 'table_body' ? group.children[0] : undefined
  if (row?.type !== 'table_row') throw new Error('no row')
  return row
}

it('C2-B-169, C2-W-098: a pipe in the attribute value of a cell is written escaped', () => {
  const tree = parse('|{title=z} a |')
  firstRow(tree).children[0]!.attrs = { keyValues: [['title', 'x|y']] }
  const out = writeWithDiagnostics(tree)
  expect(out.diagnostics).toEqual([])
  expect(out.source).toContain('{title="x\\|y"}')
  expect(treesEqual(parse(out.source), tree)).toBe(true)
})

it('C2-W-098, C2-B-166: a row attribute value that holds a pipe has no spelling', () => {
  const tree = parse('| a |{title=z}')
  firstRow(tree).attrs = { keyValues: [['title', 'x|y']] }
  const out = writeWithDiagnostics(tree)
  expect(out.diagnostics.map((d) => d.code)).toEqual(['field-unspellable'])
  expect(out.source).not.toContain('x\\|y')
})

it('C2-B-222 C82: an unclosed fence retains the final content line feed', () => {
  expect(parse('```\na').children[0]).toMatchObject({ type: 'code_block', value: 'a\n' })
})

it('C2-B-223 C62: an open code span at a cell edge is text', () => {
  expect(render('|`a|b|')).toContain('<td>`a</td><td>b</td>')
})

it('C2-B-224 C100: an escaped pipe is literal before parsing link and image fields', () => {
  expect(render('|[](\\|)|')).toContain('<a href="|"')
  expect(render('|[\\|](/u)|')).toContain('<a href="/u">|</a>')
  expect(render('|![](\\|)|')).toContain('<img src="|"')
  expect(render('|[x][\\|]|')).toContain('[x][|]')
  const table = parse('|![\\|][]|').children[0]
  expect(table).toMatchObject({ type: 'table', children: [{ children: [{ children: [{ children: [{ children: [
    { type: 'image', alt: '|', key: '|' },
  ] }] }] }] }] })
})

it('C2-H-174: an empty task label is omitted', () => {
  expect(render('- [ ] %%')).not.toContain('aria-label=""')
})

it('C2-H-175 C59: a bare abbreviation has no empty title', () => {
  expect(render('{#[]{abbr}')).toContain('<abbr></abbr>')
})

it('C2-I-126 C79: a bracket past the depth cap cannot carry a span attribute', () => {
  const source = `${'['.repeat(210)}x${']'.repeat(210)}{.a}`
  expect(render(source)).not.toContain('<span class="a">')
})

it('C2-W-122: an attributed block after a comment keeps its sibling after a list', () => {
  const source = '- a\n{.a}\n%% c\nq\n'
  const written = format(source)
  expect(treesEqual(parse(source), parse(written))).toBe(true)
  expect(format(written)).toBe(written)
})

for (const source of [
  '- ```\n%% a\n::: x\n\ta',
  '[^a]: x\n{.a}\n  %% a\n|= a |',
  'a. x\n{.a}\n%% c1\n%% c2\n3) b',
]) {
  it('C2-W-122: a prewritten div or table attribute is emitted once', () => {
    const written = writeWithDiagnostics(parse(source))
    expect(written.diagnostics).toEqual([])
    expect(treesEqual(parse(source), parse(written.source))).toBe(true)
  })
}

it('C2-W-125: a caret at the start of a link label is escaped', () => {
  const tree: DocumentNode = { type: 'document', astVersion: '2.0', children: [{ type: 'paragraph', children: [
    { type: 'link', href: '/u', children: [{ type: 'text', value: '^a' }] },
  ] }] }
  const result = writeWithDiagnostics(tree)
  expect(result.source).toBe('[\\^a](/u)\n')
  expect(result.diagnostics).toEqual([])
})

it('C2-W-129: a plain table can interrupt a list for its preceding sibling comment', () => {
  const source = '- a\n{footer-rows=0}\n%% c\n|= a |'
  const tree = parse(source)
  const written = writeWithDiagnostics(tree)
  expect(written.diagnostics).toEqual([])
  expect(treesEqual(tree, parse(written.source))).toBe(true)
})

it('C2-W-130: a named div can carry its class above a preceding sibling comment', () => {
  const source = '- a\n{.a}\n%% c\n:::\nx\n:::'
  const tree = parse(source)
  const written = writeWithDiagnostics(tree)
  expect(written.diagnostics).toEqual([])
  expect(treesEqual(tree, parse(written.source))).toBe(true)
})

const formatterCases: [string, string][] = [
  ['C2-W-088 F01: unresolved image and caption', '![][r]\n^ cap\n'],
  ['C2-W-024/055 F02: item on a footnote marker line', '[^n]: - ```\n'],
  ['C2-W-088 F03: quoted attribute pipe escape', '|{d="\\|"}\n'],
  ['C2-W-125 F04: escaped brackets in link text', '[\\]\\[]()\n'],
]
for (const [clause, source] of formatterCases) {
  it(`${clause} survives format and reparse`, () => {
    const first = format(source)
    expect(treesEqual(parse(source), parse(first))).toBe(true)
    expect(format(first)).toBe(first)
  })
}
