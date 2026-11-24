// The writer after the reader fixes: opener words end at their character set (C2-B-117, C2-B-119), and the spaces
// at the end of every content line are no content (C2-I-002).
import { describe, expect, it } from 'vitest'
import {
  decodeTree, format, formatWithDiagnostics, parse, render, treesEqual, writeWithDiagnostics, type DocumentNode,
} from '../src/index.ts'

const FENCE = '```'

/** The first block of `src` with `field` set to `value`, as a supplied tree. */
function supplied(src: string, field: string, value: unknown): DocumentNode {
  const tree = parse(src)
  Object.assign(tree.children[0]!, { [field]: value })
  return tree
}

function codes(tree: DocumentNode, check: boolean): string[] {
  return writeWithDiagnostics(tree, { check }).diagnostics.map((entry) => entry.code)
}

describe('opener words of a supplied tree', () => {
  it('C2-W-037, C2-B-117: a language outside the characters of a language word is left out and reported', () => {
    for (const syntax of ['js}', 'a b', 'é', 'x{1}', 'c`']) {
      const tree = supplied(`${FENCE}js\nx\n${FENCE}\n`, 'syntax', syntax)
      expect(writeWithDiagnostics(tree).source, syntax).toBe(`${FENCE}\nx\n${FENCE}\n`)
      expect(codes(tree, false), syntax).toEqual(['field-unspellable'])
    }
    for (const syntax of ['c++', 'objective-c', 'x/y', 'c#', 'a.b_C9']) {
      const tree = supplied(`${FENCE}js\nx\n${FENCE}\n`, 'syntax', syntax)
      expect(writeWithDiagnostics(tree).source, syntax).toBe(`${FENCE}${syntax}\nx\n${FENCE}\n`)
      expect(codes(tree, true), syntax).toEqual([])
    }
  })

  it('C2-B-116, C2-I-021: a raw format outside the characters of a format name is reported', () => {
    const tree = supplied(`${FENCE}=html\nx\n${FENCE}\n`, 'format', 'html}')
    expect(codes(tree, false)).toEqual(['field-unspellable'])
    expect(codes(supplied(`${FENCE}=html\nx\n${FENCE}\n`, 'format', 'x-y_1'), true)).toEqual([])
  })

  it('C2-W-039, C2-B-119: a class outside the characters of a div name moves to the attribute line', () => {
    for (const name of ['glossary>', 'a.b', 'x}', 'é']) {
      const tree = supplied('::: box\nx\n:::\n', 'attrs', { classes: [name] })
      const out = writeWithDiagnostics(tree)
      expect(out.source, name).toBe(`{class="${name}"}\n:::\nx\n:::\n`)
      expect(out.diagnostics, name).toEqual([])
    }
  })
})

describe('a code span whose value starts with a line break', () => {
  // The padded spelling would end the first line with a space, which C2-I-002 drops before C2-I-016 is read.
  it('C2-I-017: a backtick run with no closer of its length is text, so it is written bare', () => {
    const cases: [string, string][] = [
      ['x`\n``', 'x`\n``\n'], ['x`\n\\``', 'x`\n``\n'], ['x``\n`', 'x``\n`\n'], ['x``\n\\`', 'x``\n`\n'],
      ['x``\n`a`', 'x``\n`a`\n'], ['x!``\n`', 'x!``\n`\n'], ['x$``\n`', 'x$``\n`\n'], ['> x``\n`', '> x``\n> `\n'],
      ['x{.c}\\~%}``\n}\'`', 'x{.c}~%}``\n}\'`\n'],
    ]
    for (const [input, written] of cases) {
      const out = formatWithDiagnostics(input)
      expect(out.source, input).toBe(written)
      expect(out.diagnostics, input).toEqual([])
      expect(treesEqual(parse(out.source), parse(input)), input).toBe(true)
      expect(format(out.source), input).toBe(out.source)
    }
  })

  it('C2-W-077: a value that starts with a line break and ends with a backtick is padded on its closing side only', () => {
    for (const [src, written] of [['x `a`', 'x ``\n` ``\n'], ['x !`a`', 'x !``\n` ``\n'], ['x $`a`', 'x $``\n` ``\n']]) {
      const tree = parse(src!)
      const paragraph = tree.children[0]
      if (paragraph?.type !== 'paragraph') throw new Error(src)
      Object.assign(paragraph.children[1]!, { value: '\n`' })
      const out = writeWithDiagnostics(tree, { check: false })
      expect(out.source, src).toBe(written)
      expect(out.diagnostics.map((entry) => entry.code), src).toEqual([])
      expect(parse(out.source).children[0], src).toMatchObject({ children: [{}, { value: '\n`' }] })
    }
  })

  it('C2-W-077, C2-W-117: a value that starts with a space and a backtick or ends with a backtick and a space is reported', () => {
    for (const value of [' `a', 'a` ']) {
      const tree = parse('x `a`')
      const paragraph = tree.children[0]
      if (paragraph?.type !== 'paragraph') throw new Error(value)
      Object.assign(paragraph.children[1]!, { value })
      const out = writeWithDiagnostics(tree, { check: false })
      expect(out.diagnostics.map((entry) => entry.code), value).toEqual(['field-unspellable'])
    }
  })

  it('C2-W-077: inside a mark, a cell or before more content the span is closed and padded as before', () => {
    for (const input of ['*x``\n`*', '| x``\n` |', 'x``\n` ``y']) {
      const out = formatWithDiagnostics(input)
      expect(treesEqual(parse(out.source), parse(input)), input).toBe(true)
      expect(format(out.source), input).toBe(out.source)
    }
  })
})

describe('the spaces at the end of a line of a reference label', () => {
  it('C2-W-022, C2-I-002: a space that a backslash escapes stays, so it is no hard break', () => {
    for (const [input, written] of [['[\\ \n][]', '[\\ \n][]\n'], ['[\\\\ \n][]', '[\\\\\n][]\n'], ['[a \\  \n][]', '[a \\ \n][]\n']]) {
      const out = formatWithDiagnostics(input!)
      expect(out.source, input).toBe(written)
      expect(treesEqual(parse(out.source), parse(input!)), input).toBe(true)
    }
  })
})

describe('the writer follow-ups of the reader fixes', () => {
  /** A supplied tree of one paragraph whose lines are text nodes joined by soft breaks. */
  const lines = (...values: string[]): DocumentNode => decodeTree(JSON.stringify({
    type: 'document', astVersion: '2.0', children: [{
      type: 'paragraph',
      children: values.flatMap((value, at) => at === 0 ? [{ type: 'text', value }] : [{ type: 'soft_break' }, { type: 'text', value }]),
    }],
  }))
  const abbreviation = (expansion: string): DocumentNode => decodeTree(JSON.stringify({
    type: 'document', astVersion: '2.0', children: [{ type: 'abbreviation_def', key: 'A', namespace: 'abbr', expansion }],
  }))
  const roundTrip = (tree: DocumentNode): string => {
    const out = writeWithDiagnostics(tree)
    expect(out.diagnostics).toEqual([])
    expect(treesEqual(parse(out.source, { positions: false }), tree)).toBe(true)
    return out.source
  }

  it('C2-B-119, C2-B-122: a paragraph of a sigil div opener as text keeps its escape', () => {
    for (const value of ['::: >a', '::: |#', '::: \\x']) expect(roundTrip(lines(value)), value).toBe(`\\${value}\n`)
  })

  it('C2-B-197: a text line of the shape of a block image line takes escapes, so the caret line below stays text', () => {
    // C2-W-088 (carve-js#5283, option B): every bracket of the reported kind and the caret line take the escape.
    expect(roundTrip(lines('![a][b[c]', '^ d'))).toBe('!\\[a]\\[b\\[c]\n\\^ d\n')
    expect(roundTrip(lines('![a][ ]', '^ c'))).toBe('![a][ ]\n^ c\n')
  })

  it('C2-W-055, C2-B-084: an expansion keeps its leading blanks, and one that ends in a blank or holds a line break is reported', () => {
    expect(roundTrip(abbreviation(' lead'))).toBe('*[A]:  lead\n')
    for (const [expansion, written] of [['lead ', '*[A]: lead\n'], ['lead\t', '*[A]: lead\n'], ['A\nB', '*[A]: A B\n']]) {
      const out = writeWithDiagnostics(abbreviation(expansion!))
      expect(out.source, expansion).toBe(written)
      expect(out.diagnostics.map((entry) => entry.code), expansion).toEqual(['field-unspellable'])
    }
  })

  it('C2-W-055, C2-H-181, C2-H-187: the template of an expansion with a line break reads back as a definition', () => {
    expect(render(abbreviation('A\nB'), { roundtrip: true })).toContain('*[A]: A B</template>')
  })
})
