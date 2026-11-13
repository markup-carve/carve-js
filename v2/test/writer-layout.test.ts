// The forms the formatter keeps from the source-layout record (C2-W-083, C2-W-084, C2-L-042), the
// defaults a writer uses without it (C2-L-030 to C2-L-041), and that a fact which contradicts the
// tree is ignored (C2-W-086, C2-L-006).
import { describe, expect, it } from 'vitest'
import { format, type LayoutEntry, type NodeLayout, parse, parseWithLayout, treesEqual, write } from '../src/index.ts'
import { documentOf } from './support/tree.ts'

/** `src` written with its record, in which the entry of `path` carries `fact`. */
function withFact(src: string, path: string, fact: Partial<NodeLayout>): string {
  const { document, layout } = parseWithLayout(src)
  const nodes: LayoutEntry[] = layout.nodes.filter((entry) => entry.path !== path)
  nodes.push({ ...layout.nodes.find((entry) => entry.path === path), path, ...fact })
  return write(document, { layout: { nodes } })
}

/** Whether `written` parses to the tree of `src`. */
function keepsTree(written: string, src: string): boolean {
  return treesEqual(parse(written), parse(src))
}

describe('ordered numbering', () => {
  it('C2-W-083, C2-L-042: the formatter keeps the bare dot and the written numbers', () => {
    expect(format('. a\n. b')).toBe('. a\n. b\n')
    expect(format('1. a\n2. b')).toBe('1. a\n2. b\n')
    expect(format('3. a\n4. b')).toBe('3. a\n4. b\n')
    expect(format('{start=3}\n. a\n. b')).toBe('{start=3}\n. a\n. b\n')
  })

  it('C2-L-016: a list that mixes both is written in the form of its first marker', () => {
    expect(format('1. a\n. b')).toBe('1. a\n2. b\n')
    expect(format('. a\n2. b')).toBe('. a\n. b\n')
  })

  it('C2-L-030: without the record a decimal list with the period has the bare dot, and its start in an attribute', () => {
    expect(write(parse('1. a\n2. b'))).toBe('. a\n. b\n')
    expect(write(parse('3. a\n4. b'))).toBe('{start=3}\n. a\n. b\n')
  })

  it('C2-L-031: every other ordered list is written with its numbers, letters or numerals in sequence', () => {
    expect(write(parse('3) a\n3) b'))).toBe('3) a\n4) b\n')
    expect(write(parse('b. x\nb. y'))).toBe('b. x\nc. y\n')
    expect(write(parse('ii. x\nii. y'))).toBe('ii. x\niii. y\n')
  })

  it('C2-W-083: the fact decides where the tree allows both forms', () => {
    expect(withFact('. a\n. b', '/children/0', { bare: false })).toBe('1. a\n2. b\n')
    expect(withFact('1. a\n2. b', '/children/0', { bare: true })).toBe('. a\n. b\n')
    expect(withFact('3. a\n4. b', '/children/0', { bare: true })).toBe('{start=3}\n. a\n. b\n')
  })

  it('C2-W-086, C2-L-006: the bare dot recorded on a list that cannot have it is ignored', () => {
    expect(withFact('1) a\n2) b', '/children/0', { bare: true })).toBe('1) a\n2) b\n')
    expect(withFact('i. a\nii. b', '/children/0', { bare: true })).toBe('i. a\nii. b\n')
    expect(withFact('- a\n- b', '/children/0', { bare: true })).toBe('- a\n- b\n')
  })
})

describe('quote form', () => {
  it('C2-W-083, C2-L-042: the formatter keeps > lines and the quote fence', () => {
    expect(format('> a\n> b')).toBe('> a\n> b\n')
    expect(format('::: >\na\nb\n:::')).toBe('::: >\na\nb\n:::\n')
    expect(format('> ::: >\n> a\n> :::')).toBe('> ::: >\n> a\n> :::\n')
  })

  it('C2-L-033: without the record a quote is written with > lines', () => {
    expect(write(parse('::: >\na\nb\n:::'))).toBe('> a\n> b\n')
    expect(write(parse('::: >\n- a\n\n> b\n:::'))).toBe('> - a\n>\n> > b\n')
  })

  it('C2-W-083: the fact decides between the two forms', () => {
    expect(withFact('> a', '/children/0', { fenced: true })).toBe('::: >\na\n:::\n')
    expect(withFact('::: >\na\n:::', '/children/0', { fenced: false })).toBe('> a\n')
  })

  it('C2-W-086, C2-L-006: a quote fence recorded on a node that is no quote is ignored', () => {
    expect(withFact('a', '/children/0', { fenced: true })).toBe('a\n')
    expect(withFact(':::\na\n:::', '/children/0', { fenced: true })).toBe(':::\na\n:::\n')
  })
})

describe('hard-break form', () => {
  it('C2-W-083, C2-L-042: the formatter keeps the opener and the class form', () => {
    expect(format('::: \\\na\nb\n:::')).toBe('::: \\\na\nb\n:::\n')
    const classForm = '{.hardbreaks}\n:::\na\nb\n:::'
    expect(format(classForm).split('\n')[0]).toBe('::: hardbreaks')
    expect(keepsTree(format(classForm), classForm)).toBe(true)
  })

  it('C2-L-034: without the record the opener is written when the class is last, and the class form otherwise', () => {
    expect(write(parse('{.hardbreaks}\n:::\na\nb\n:::'))).toBe('::: \\\na\nb\n:::\n')
    expect(write(parse('{.x .hardbreaks}\n:::\na\nb\n:::'))).toBe('{.x}\n::: \\\na\nb\n:::\n')
    const first = '{.hardbreaks .x}\n:::\na\nb\n:::'
    expect(write(parse(first)).split('\n').slice(0, 2)).toEqual(['{.x}', '::: hardbreaks'])
    expect(keepsTree(write(parse(first)), first)).toBe(true)
  })

  it('C2-W-083: the fact decides where the class is last', () => {
    expect(withFact('{.hardbreaks}\n:::\na\nb\n:::', '/children/0', { hardBreakOpener: true })).toBe('::: \\\na\nb\n:::\n')
    const opener = '::: \\\na\nb\n:::'
    expect(withFact(opener, '/children/0', { hardBreakOpener: false }).split('\n')[0]).toBe('::: hardbreaks')
    expect(keepsTree(withFact(opener, '/children/0', { hardBreakOpener: false }), opener)).toBe(true)
  })

  it('C2-W-086, C2-L-006: the opener recorded on a div whose hardbreaks class is not last is ignored', () => {
    const src = '{.hardbreaks .x}\n:::\na\nb\n:::'
    const written = withFact(src, '/children/0', { hardBreakOpener: true })
    expect(written.split('\n').slice(0, 2)).toEqual(['{.x}', '::: hardbreaks'])
    expect(keepsTree(written, src)).toBe(true)
  })

  it('C2-W-086, C2-L-006: the opener recorded on a div with no hardbreaks class is ignored', () => {
    expect(withFact('::: box\na\n:::', '/children/0', { hardBreakOpener: true })).toBe('::: box\na\n:::\n')
  })
})

describe('table form', () => {
  it('C2-W-083, C2-L-042: the formatter keeps a pipe table and a delimited table', () => {
    expect(format('|= a |= b |\n| c | d |')).toBe('|= a |= b |\n| c | d |\n')
    expect(format('{table}\n```csv\na,b\nc,d\n```')).toBe('{table}\n```csv\na,b\nc,d\n```\n')
    expect(format('{table}\n```tsv\na\tb\nc\td\n```')).toBe('{table}\n```tsv\na\tb\nc\td\n```\n')
  })

  it('C2-L-036: without the record a table is a pipe table, and a table with no rows a delimited one', () => {
    expect(write(parse('{table}\n```csv\na,b\nc,d\n```'))).toBe('|= a |= b |\n| c | d |\n')
    expect(write(parse('{table}\n```tsv\n```'))).toBe('{table}\n```csv\n```\n')
    expect(write(documentOf({ type: 'table', columns: [], children: [] }))).toBe('{table}\n```csv\n```\n')
  })

  it('C2-W-083: the fact decides where the tree allows both forms', () => {
    expect(withFact('|= a |= b |\n| c | d |', '/children/0', { sourceFormat: 'csv' })).toBe('{table}\n```csv\na,b\nc,d\n```\n')
    expect(withFact('|= a |= b |\n| c | d |', '/children/0', { sourceFormat: 'tsv' })).toBe('{table}\n```tsv\na\tb\nc\td\n```\n')
    expect(withFact('{table}\n```csv\na,b\nc,d\n```', '/children/0', { sourceFormat: 'pipe' })).toBe('|= a |= b |\n| c | d |\n')
  })

  it('C2-W-086, C2-L-006: a delimited format recorded on a table that a delimited table cannot hold is ignored', () => {
    expect(withFact('|= *a* |= b |\n| c | d |', '/children/0', { sourceFormat: 'csv' })).toBe('|= *a* |= b |\n| c | d |\n')
    expect(withFact('| a | b |', '/children/0', { sourceFormat: 'csv' })).toBe('| a | b |\n')
    expect(withFact('|= a |= b |\n| c | d |{.r}', '/children/0', { sourceFormat: 'tsv' })).toBe('|= a |= b |\n| c | d |{.r}\n')
  })

  it('C2-W-086, C2-L-006: the pipe form recorded on a table that needs the delimited form is ignored', () => {
    const src = '{table header-rows=2}\n```csv\na,b\nc,d\ne,f\n```'
    expect(withFact(src, '/children/0', { sourceFormat: 'pipe' })).toBe(`${src}\n`)
    expect(withFact('{table}\n```csv\n```', '/children/0', { sourceFormat: 'pipe' })).toBe('{table}\n```csv\n```\n')
  })
})

describe('continuation rows', () => {
  const cell = '/children/0/children/0/children/0/children/0'
  const textOfCell = `${cell}/children/0/children/0`

  it('C2-W-083, C2-L-042: the formatter keeps continuation rows at the recorded places', () => {
    expect(format('| a | b |\n+ c | |\n+ d | e |')).toBe('| a | b |\n+ c | |\n+ d | e |\n')
    expect(format('| a |\n+ b |\n| c | d |\n+ e | f |')).toBe('| a |\n+ b |\n| c | d |\n+ e | f |\n')
  })

  it('C2-L-019: a continuation row with only empty fragments is kept', () => {
    expect(format('| a | b |\n+ | |')).toBe('| a | b |\n+ | |\n')
  })

  it('C2-L-035: without the record a row is one line', () => {
    expect(write(parse('| a | b |\n+ c | |\n+ d | e |'))).toBe('| a c d | b e |\n')
  })

  it('C2-W-083: a row with no continuation rows recorded is one line', () => {
    expect(withFact('| a |\n+ b |', '/children/0/children/0/children/0', { continuationLines: 0 })).toBe('| a b |\n')
  })

  it('C2-W-086, C2-L-021: a wrap whose offset has no space before it is ignored', () => {
    const written = withFact('| a |\n+ b |', cell, { wraps: [{ line: 1, path: textOfCell, offset: 1 }] })
    expect(written).toBe('| a b |\n+ |\n')
    expect(keepsTree(written, '| a |\n+ b |')).toBe(true)
  })

  it('C2-W-086, C2-L-020: a wrap that names no text node or lies outside its value is ignored', () => {
    expect(withFact('| a |\n+ b |', cell, { wraps: [{ line: 1, path: `${cell}/children/9`, offset: 2 }] })).toBe('| a b |\n+ |\n')
    expect(withFact('| a |\n+ b |', cell, { wraps: [{ line: 1, path: textOfCell, offset: 9 }] })).toBe('| a b |\n+ |\n')
  })

  it('C2-W-083: a wrap at a joining space is taken', () => {
    expect(withFact('| a |\n+ b |', cell, { wraps: [{ line: 1, path: textOfCell, offset: 2 }] })).toBe('| a |\n+ b |\n')
  })
})

describe('reference text', () => {
  const link = '/children/0/children/0'

  it('C2-W-084, C2-L-022: the formatter keeps a reference as typed', () => {
    const src = '[a][ b ] [c][] [ D\ne ][]\n\n[b]: /u\n\n[c]: /u\n\n[D e]: /u'
    expect(format(src)).toBe(`${src}\n`)
  })

  it('C2-W-075: spaces at the end of a line of the recorded text are not written', () => {
    expect(withFact('[a][b]\n\n[b]: /u', link, { rawRef: '[a][b  \n ]' })).toBe('[a][b\n ]\n\n[b]: /u\n')
  })

  it('C2-L-040: without the record a reference is written from the tree', () => {
    expect(write(parse('[a][ b ] [c][]\n\n[b]: /u\n\n[c]: /u'))).toBe('[a][b] [c][]\n\n[b]: /u\n\n[c]: /u\n')
  })

  it('C2-W-083: the recorded text is taken where it reads back to the node', () => {
    expect(withFact('[a][b]\n\n[b]: /u', link, { rawRef: '[a][ b ]' })).toBe('[a][ b ]\n\n[b]: /u\n')
  })

  it('C2-W-086, C2-L-006: a recorded text that reads back to another key, content or form is ignored', () => {
    for (const rawRef of ['[a][c]', '[a][ B ]', '[x][b]', '[a][]', '[a](b)']) {
      expect(withFact('[a][b]\n\n[b]: /u', link, { rawRef })).toBe('[a][b]\n\n[b]: /u\n')
    }
  })

  it('C2-W-086, C2-L-006: a recorded text on a link that is no reference is ignored', () => {
    expect(withFact('[a](u)', link, { rawRef: '[a][b]' })).toBe('[a](u)\n')
  })
})

describe('the rest of the record', () => {
  it('C2-L-032: a bullet list is written with the character of the tree, with and without the record', () => {
    expect(format('* a\n* b\n\n- c')).toBe('* a\n* b\n\n- c\n')
    expect(write(parse('* a\n* b\n\n- c'))).toBe('* a\n* b\n\n- c\n')
  })

  it('C2-L-037, C2-L-038, C2-L-039, C2-L-043: the fence, the heading marker and the thematic break are normalized whatever is recorded', () => {
    const src = '## T\n\n*****\n\n~~~~js\nc\n~~~~\n\n::::: box\nx\n:::::'
    expect(format(src)).toBe('== T\n\n***\n\n```js\nc\n```\n\n::: box\nx\n:::\n')
    expect(write(parse(src))).toBe(format(src))
  })

  it('C2-L-041, C2-L-043: blank lines, the content column, the frontmatter opener and the title quotes are canonical', () => {
    const src = '---yaml\na: b\n---\n\n\n\n   -   a\n       b\n\n\n[c](/u \'t\')'
    expect(format(src)).toBe('---\na: b\n---\n\n- a\n  b\n\n[c](/u "t")\n')
    expect(write(parse(src))).toBe(format(src))
  })

  it('C2-L-044: neither the kept form nor the default changes the tree', () => {
    for (const src of ['1. a\n2. b', '::: >\na\n:::', '{.hardbreaks}\n:::\na\nb\n:::', '{table}\n```csv\na,b\nc,d\n```', '| a |\n+ b |', '[a][ b ]\n\n[b]: /u']) {
      expect(keepsTree(format(src), src)).toBe(true)
      expect(keepsTree(write(parse(src)), src)).toBe(true)
    }
  })

  it('C2-L-046, C2-W-085: the writer reads the seven facts and no other', () => {
    const src = '#  T\n\n3. a\n4. b\n\n::: >\nq\n:::\n\n::: \\\nx\ny\n:::\n\n| a |\n+ b |\n\n[r][ k ]\n\n[k]: /u'
    const { document, layout } = parseWithLayout(src)
    const seven = layout.nodes.map(({ path, bare, fenced, hardBreakOpener, wraps, continuationLines, sourceFormat, rawRef }) => (
      JSON.parse(JSON.stringify({ path, bare, fenced, hardBreakOpener, wraps, continuationLines, sourceFormat, rawRef })) as LayoutEntry
    ))
    const others = layout.nodes.map((entry) => {
      const { bare, fenced, hardBreakOpener, wraps, continuationLines, sourceFormat, rawRef, ...rest } = entry
      void [bare, fenced, hardBreakOpener, wraps, continuationLines, sourceFormat, rawRef]
      return rest
    })
    expect(write(document, { layout: { nodes: seven } })).toBe(format(src))
    expect(write(document, { layout: { nodes: others } })).toBe(write(document))
  })
})
