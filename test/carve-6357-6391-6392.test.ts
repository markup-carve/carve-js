// carve#6392 and carve-js#5386 (C2-W-044, C2-B-043, C2-B-229), carve#6391 (C2-W-088) and carve#6357 (catalog deprecated-continuation-marker).
import { describe, expect, it } from 'vitest'
import { type DocumentNode, type Inline, format, lint, parse, treesEqual, writeWithDiagnostics } from '../src/index.ts'
import { documentOf, paragraph, text } from './support/tree.ts'

const enDash: Inline = { type: 'smart_punctuation', kind: 'en_dash', glyph: '–', source: '--' }

function written(tree: DocumentNode): string {
  const output = writeWithDiagnostics(tree)
  expect(output.diagnostics).toEqual([])
  expect(treesEqual(parse(output.source), tree)).toBe(true)
  return output.source
}

describe('carve#6392: a bare dot behind a task box or quote mark', () => {
  it.each([
    '. [ ] . a\n',
    '. > . a\n',
    '. [x] > . a\n',
    '. > > . a\n',
    '> . > . a\n',
  ])('keeps %j', (source) => {
    expect(format(source)).toBe(source)
  })

  it('writes digits directly behind the bare dot', () => {
    expect(format('. 1. a\n')).toBe('. 1. a\n')
    const tree = parse('. [ ] . a\n')
    const task = (tree.children[0] as { children: { children: unknown[] }[] }).children[0]!
    task.children = (parse('. a\n').children as unknown[])
    delete (task as { task?: unknown }).task
    expect(written(tree)).toBe('. 1. a\n')
  })

  it('writes the bare dot for a tree without sidecar facts', () => {
    const tree = parse('. > . a\n')
    expect(written(JSON.parse(JSON.stringify(tree)) as DocumentNode)).toBe('. > . a\n')
  })
})

describe('carve-js#5386: an item whose text starts with a dot and a space', () => {
  it('numbers the list, since a bare dot before that text is no marker', () => {
    expect(format('. z\n1. . . a\n')).toBe('1. z\n2. . . a\n')
    expect(format('. z\n1. .\ta\n')).toBe('. z\n. .\ta\n')
    expect(format('. z\n. [ ] . . a\n')).toBe('. z\n. [ ] . . a\n')
  })
})

describe('carve#6391: a single hyphen is no potential opener of the hyphen kind', () => {
  it('keeps a single hyphen bare beside an escaped hyphen run before a dash', () => {
    expect(written(documentOf(paragraph(text('é- x 2) -'), enDash, text('$'))))).toBe('é- x 2) \\---$\n')
  })

  it('still escapes a lone hyphen next to a dash elsewhere in the block', () => {
    expect(written(documentOf(paragraph(text('a -'), enDash, text(' b -'), enDash)))).toBe('a \\--- b \\---\n')
  })
})

describe('carve#6357: a plus behind an item marker and a quote mark', () => {
  const found = (source: string) => lint(source, {}).filter((entry) => entry.code === 'deprecated-continuation-marker')
    .map((entry) => [entry.range?.startOffset, entry.range?.endOffset, entry.message])

  it.each(['* > > +\n', '1. > +\n', '- [ ] > +\n'])('reports nothing for %j', (source) => {
    expect(found(source)).toEqual([])
  })

  it('reports the item and quote forms of the Expected section', () => {
    expect(found('- > - +\n').map(([start, end, message]) => [start, end, String(message).includes('indented past')]))
      .toEqual([[6, 7, true]])
    expect(found('> - +\n').map(([start, end]) => [start, end])).toEqual([[4, 5]])
    expect(String(found('> > +\n')[0]?.[2])).toContain('If a block was intended')
  })
})
