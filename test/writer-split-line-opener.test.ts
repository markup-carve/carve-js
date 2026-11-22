// C2-W-092, C2-W-090: a line whose opener spans several text nodes takes the escape of the joined text (carve-js#5363).
import { describe, expect, it } from 'vitest'
import { type DocumentNode, type Inline, parse, treesEqual, writeWithDiagnostics } from '../src/index.ts'
import { writeTreeWithStats } from '../src/write.ts'
import { documentOf, paragraph, text } from './support/tree.ts'

const emDash: Inline = { type: 'smart_punctuation', kind: 'em_dash', glyph: '—', source: '---' }
const softBreak: Inline = { type: 'soft_break' }

function written(tree: DocumentNode): string {
  const output = writeWithDiagnostics(tree)
  expect(output.diagnostics).toEqual([])
  expect(treesEqual(parse(output.source), tree)).toBe(true)
  return output.source
}

function repaired(tree: DocumentNode): string {
  const { output } = writeTreeWithStats(tree, undefined, 'repair')
  expect(output.diagnostics).toEqual([])
  expect(treesEqual(parse(output.source), tree)).toBe(true)
  return output.source
}

describe('a line opener split over text nodes', () => {
  it('escapes a split ordered marker before a colon and an em dash', () => {
    expect(written(documentOf(paragraph(text('1'), text('1. :'), emDash)))).toBe('11\\. :---\n')
    expect(written(documentOf(paragraph(text('1'), text('1.'), text(' :'), emDash)))).toBe('11\\. :---\n')
    expect(written(documentOf(paragraph(text('11. :'), emDash)))).toBe('11\\. :---\n')
  })

  it('escapes a split opener on the repair path as the joined one', () => {
    for (const parts of [['1', '1. a'], ['1', '1', ') a'], ['a', '. b'], ['-', '- a'], ['', '1. a']]) {
      const joined = repaired(documentOf(paragraph(text(parts.join('')))))
      expect(repaired(documentOf(paragraph(...parts.map((part) => text(part)))))).toBe(joined)
    }
  })

  it('escapes a split opener on a later line as the joined one', () => {
    for (const parts of [['1', '. :'], ['1', '. b'], ['-', ' :'], ['-', ' b'], ['>', ' b'], ['#', ' b']]) {
      const joined = documentOf(paragraph(text('a'), softBreak, text(parts.join('')), emDash))
      const split = documentOf(paragraph(text('a'), softBreak, ...parts.map((part) => text(part)), emDash))
      expect(repaired(split)).toBe(repaired(joined))
      expect(written(split)).toBe(written(joined))
    }
  })
})
