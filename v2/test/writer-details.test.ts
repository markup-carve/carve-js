// Edges of the writer that the mutation run showed no clause test reaches.
import { describe, expect, it } from 'vitest'
import { type AstNode } from '../src/ast.ts'
import { format, parse, parseWithLayout, write, writeWithDiagnostics } from '../src/index.ts'

function paragraphWith(attrs: AstNode['attrs']): AstNode {
  const paragraph: AstNode = { type: 'paragraph', children: [{ type: 'text', value: 'a' }] }
  if (attrs !== undefined) paragraph.attrs = attrs
  return { type: 'document', astVersion: '2.0', children: [paragraph] }
}

describe('the brace block', () => {
  it('C2-W-048: a name holds the first and the last letter and digit', () => {
    expect(write(paragraphWith({ id: 'AZaz09', classes: ['Z', 'A', 'z', 'a', '0', '9'] }))).toBe('{#AZaz09 .Z .A .z .a .0 .9}\na\n')
    expect(write(paragraphWith({ keyValues: [['Zk', 'v'], ['Ak', 'v'], ['zk', 'v'], ['ak', 'v']] }))).toBe('{Zk=v Ak=v zk=v ak=v}\na\n')
  })

  it('C2-W-048: a class and an id that are no name are written as quoted keys', () => {
    expect(write(paragraphWith({ classes: ['a.b', 'c'] }))).toBe('{class="a.b" .c}\na\n')
    expect(write(paragraphWith({ id: 'a b' }))).toBe('{id="a b"}\na\n')
    expect(writeWithDiagnostics(paragraphWith({ classes: [''] })).source).toBe('{class=""}\na\n')
  })

  it('C2-I-030: a key that starts with a digit is no key and is not written', () => {
    expect(writeWithDiagnostics(paragraphWith({ keyValues: [['1a', 'x'], ['b', 'y']] })).source).toBe('{b=y}\na\n')
  })

  it('C2-W-050, C2-I-033: a quoted value escapes a quote, and a backslash only where it would be read as an escape', () => {
    expect(write(paragraphWith({ keyValues: [['k', 'a"b']] }))).toBe('{k="a\\"b"}\na\n')
    expect(write(paragraphWith({ keyValues: [['k', 'a b\\']] }))).toBe('{k="a b\\\\"}\na\n')
    expect(write(paragraphWith({ keyValues: [['k', 'a \\b']] }))).toBe('{k="a \\b"}\na\n')
    expect(write(paragraphWith({ keyValues: [['k', 'a \\.b']] }))).toBe('{k="a \\\\.b"}\na\n')
    expect(write(paragraphWith({ keyValues: [['k', 'a \\b.']] }))).toBe('{k="a \\b."}\na\n')
    for (const value of ['a"b', 'a b\\', 'a \\b', 'a \\.b', '\\ a', 'x\\\\ y']) {
      const tree = paragraphWith({ keyValues: [['k', value]] })
      expect(parse(write(tree)).children![0]!.attrs).toEqual({ keyValues: [['k', value]] })
    }
  })
})

describe('the diagnostics of the writer', () => {
  it('C2-W-011: the message names the node, and the field where a field is lost', () => {
    const empty: AstNode = { type: 'document', astVersion: '2.0', children: [{ type: 'paragraph', children: [] }] }
    expect(writeWithDiagnostics(empty).diagnostics.map((entry) => entry.message)).toEqual(['a paragraph node has no spelling in Carve source here'])
    const deep: AstNode = { type: 'document', astVersion: '2.0', children: [{ type: 'heading', level: 7, children: [{ type: 'text', value: 'a' }] }] }
    expect(writeWithDiagnostics(deep).diagnostics.map((entry) => entry.message)).toEqual(['the field level of a heading node has no spelling in Carve source here'])
  })
})

describe('lines', () => {
  it('C2-W-021: an empty line of a quote is the bare mark, and a blank line of an item is empty', () => {
    expect(format('> a\n>\n> b')).toBe('> a\n>\n> b\n')
    expect(format('- a\n\n  b')).toBe('- a\n\n  b\n')
    expect(format('> ```\n> x\n>\n> y\n> ```')).toBe('> ```\n> x\n>\n> y\n> ```\n')
  })

  it('C2-W-022: a space of text before a soft break and at the end of a leaf is not written, and one before a hard break is', () => {
    const tree: AstNode = {
      type: 'document', astVersion: '2.0',
      children: [{ type: 'paragraph', children: [{ type: 'text', value: 'a ' }, { type: 'soft_break' }, { type: 'text', value: 'b \t' }] }],
    }
    expect(writeWithDiagnostics(tree).source).toBe('a\nb\n')
    expect(format('a \\\nb')).toBe('a \\\nb\n')
  })
})

function paragraphOf(...children: AstNode[]): AstNode {
  return { type: 'document', astVersion: '2.0', children: [{ type: 'paragraph', children }] }
}

function writtenBack(tree: AstNode): AstNode[] {
  return parse(write(tree), { positions: false }).children![0]!.children!
}

describe('verbatim spans and destinations', () => {
  it('C2-W-077: a code span is padded only where a reader would take the padding or the run', () => {
    const code = (value: string): AstNode => paragraphOf({ type: 'text', value: 'x' }, { type: 'code', value })
    expect(write(code('a'))).toBe('x`a`\n')
    expect(write(code(' a '))).toBe('x`  a  `\n')
    expect(write(code('  '))).toBe('x`  `\n')
    expect(write(code(' a'))).toBe('x` a`\n')
    expect(write(code('`a'))).toBe('x`` `a ``\n')
    expect(write(code('a`'))).toBe('x`` a` ``\n')
    expect(write(code('a``b`c'))).toBe('x```a``b`c```\n')
    for (const value of ['a', ' a ', '  ', ' a', 'a ', '`a', 'a`', 'a``b`c', '`']) {
      expect(writtenBack(code(value))).toEqual([{ type: 'text', value: 'x' }, { type: 'code', value }])
    }
  })

  it('C2-W-112: three adjacent code spans are one span, and the two behind the first are reported', () => {
    const tree = paragraphOf({ type: 'code', value: 'a' }, { type: 'code', value: 'b' }, { type: 'code', value: 'c' }, { type: 'text', value: ' d' })
    const written = writeWithDiagnostics(tree)
    expect(written.source).toBe('`abc` d\n')
    expect(written.diagnostics.map((entry) => entry.path)).toEqual(['/children/0/children/1', '/children/0/children/2'])
  })

  it('C2-I-013: a destination escapes the parenthesis that has no partner and the backslash that would be read as an escape', () => {
    const link = (href: string): AstNode => paragraphOf({ type: 'link', href, children: [{ type: 'text', value: 't' }] })
    expect(write(link('/a(b)c'))).toBe('[t](/a(b)c)\n')
    expect(write(link('/a)b'))).toBe('[t](/a\\)b)\n')
    expect(write(link('/a(b'))).toBe('[t](/a\\(b)\n')
    expect(write(link('/a\\b'))).toBe('[t](/a\\b)\n')
    expect(write(link('/a\\'))).toBe('[t](/a\\\\)\n')
    expect(write(link('/a\\(b)'))).toBe('[t](/a\\\\(b))\n')
    for (const href of ['/a(b)c', '/a)b', '/a(b', '/a\\b', '/a\\', '/a\\(b)', '/(a))(', '/\\\\']) {
      expect(writtenBack(link(href))).toEqual([{ type: 'link', href, children: [{ type: 'text', value: 't' }] }])
    }
  })

  it('C2-W-079, C2-W-022: a hard break keeps its backslash at the end of a paragraph and before a line', () => {
    expect(format('a\\\nb\\')).toBe('a\\\nb\\\n')
    expect(format('a\\\\\\')).toBe('a\\\\\\\n')
  })
})

describe('tables', () => {
  it('C2-B-211, C2-B-212: the column lists run to the last column that has an entry', () => {
    expect(format('{aligns=left}\n| a | b |')).toBe('{aligns=left}\n| a | b |\n')
    expect(format('{aligns=",right"}\n| a | b |')).toBe('{aligns=,right}\n| a | b |\n')
    expect(format('{aligns="left,right" widths="12.5,50"}\n| a | b |')).toBe('{aligns=left,right widths=12.5,50}\n| a | b |\n')
  })

  it('C2-W-066: the fence of a delimited table is longer than a backtick line of its body', () => {
    expect(format('{table}\n````csv\na\n```\nb\n````')).toBe('{table}\n````csv\na\n```\nb\n````\n')
    expect(format('{table}\n`````csv\na,b\n`````')).toBe('{table}\n```csv\na,b\n```\n')
  })

  it('C2-L-006: a table is written delimited only where every cell is plain text', () => {
    const written = (edit: (cell: AstNode) => void): string => {
      const parsed = parseWithLayout('|= a |= b |\n| c | d |')
      edit(parsed.document.children![0]!.children![1]!.children![0]!.children![0]!)
      const nodes = parsed.layout.nodes.map((entry) => (entry.path === '/children/0' ? { ...entry, sourceFormat: 'csv' as const } : entry))
      return write(parsed.document, { layout: { nodes } })
    }
    expect(written(() => undefined)).toBe('{table}\n```csv\na,b\nc,d\n```\n')
    expect(written((cell) => void (cell.align = 'right'))).toBe('|= a |= b |\n|{>} c | d |\n')
    expect(written((cell) => void (cell.attrs = { classes: ['x'] }))).toBe('|= a |= b |\n|{.x} c | d |\n')
    expect(written((cell) => void (cell.lang = 'en'))).toBe('|= a |= b |\n|{:en} c | d |\n')
    expect(written((cell) => void (cell.header = true))).toBe('|= a |= b |\n|= c | d |\n')
  })

  it('C2-L-006, C2-L-020: wraps that are out of order, past the continuation rows or in another row are not used', () => {
    const parsed = parseWithLayout('| a |\n+ b |\n+ c |')
    type Wraps = NonNullable<(typeof parsed.layout.nodes)[number]['wraps']>
    const written = (edit: (wraps: Wraps) => Wraps): string => {
      const nodes = parsed.layout.nodes.map((entry) => (entry.wraps === undefined ? entry : { ...entry, wraps: edit(entry.wraps) }))
      return write(parsed.document, { layout: { nodes } })
    }
    expect(written((wraps) => wraps)).toBe('| a |\n+ b |\n+ c |\n')
    const oneLine = '| a b c |\n+ |\n+ |\n'
    expect(written((wraps) => [wraps[1]!, wraps[0]!])).toBe(oneLine)
    expect(written((wraps) => [{ ...wraps[0]!, line: 3 }, wraps[1]!])).toBe(oneLine)
    expect(written((wraps) => [{ ...wraps[0]!, line: 2 }, wraps[1]!])).toBe(oneLine)
    expect(written((wraps) => [{ ...wraps[0]!, line: 0 }, wraps[1]!])).toBe(oneLine)
    expect(written((wraps) => [{ ...wraps[0]!, row: 1 }, wraps[1]!])).toBe(oneLine)
  })
})

