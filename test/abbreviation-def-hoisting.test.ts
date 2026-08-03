import { describe, it, expect } from 'vitest'
import { parse } from '../src/parse.js'
import { toAstJson, fromAstJson } from '../src/ast-json.js'
import { carveToHtml } from '../src/index.js'
import type { BlockNode, Document } from '../src/ast.js'

/**
 * PART 12 §7: a definition is a child of the DOCUMENT even when it was authored
 * inside a container, because its scope is the document wherever it sits.
 *
 * A footnote definition already worked that way here - the parser never emits a
 * block for it, it goes to `lexer.footnoteDefs` and the encoder appends it - but
 * an `abbreviation_def` was left nested. Reading §7 as footnote-specific is what
 * split the engines: carve-php hoisted both kinds, carve-js and carve-rs hoisted
 * only the footnote, and all three rendered identical HTML, because an
 * abbreviation is document-global wherever it is written (carve-php#631).
 */

const types = (blocks: readonly BlockNode[]): string[] => blocks.map((b) => b.type)

const abbrDefs = (doc: Document) =>
  doc.children.filter((b) => b.type === 'abbreviation_def') as (BlockNode & {
    abbr: string
    pos?: { startLine: number }
  })[]

describe('an abbreviation definition hoists to the document (PART 12 §7)', () => {
  it('hoists out of a div', () => {
    const doc = parse(':::\n*[HTML]: HyperText\n\nbody\n:::\n')
    expect(types(doc.children)).toEqual(['div', 'abbreviation_def'])
    const div = doc.children[0] as BlockNode & { children: BlockNode[] }
    expect(types(div.children)).toEqual(['paragraph'])
  })

  it('hoists out of a list item', () => {
    const doc = parse('- a\n\n  *[X]: ex\n')
    expect(types(doc.children)).toEqual(['list', 'abbreviation_def'])
  })

  it('hoists out of a block quote', () => {
    const doc = parse('> a\n>\n> *[X]: ex\n')
    expect(types(doc.children)).toEqual(['block_quote', 'abbreviation_def'])
  })

  it('hoists out of a nested container, not only a top-level one', () => {
    const doc = parse(':::\n> a\n>\n> *[X]: ex\n:::\n')
    expect(types(doc.children)).toEqual(['div', 'abbreviation_def'])
  })

  it('leaves a definition the author already wrote at document level alone', () => {
    const doc = parse('*[HTML]: HyperText\n\nHTML rocks\n')
    expect(types(doc.children)).toEqual(['abbreviation_def', 'paragraph'])
  })

  it('keeps `pos` pointing at where the author wrote it', () => {
    // The whole basis for §7 saying nothing is lost by the move.
    const doc = parse(':::\n*[HTML]: HyperText\n\nbody\n:::\n')
    expect(abbrDefs(doc)[0]?.pos?.startLine).toBe(2)
  })

  it('hoists every definition, in the order they were written', () => {
    const doc = parse(':::\n*[A]: first\n\n*[B]: second\n:::\n')
    expect(abbrDefs(doc).map((d) => d.abbr)).toEqual(['A', 'B'])
  })
})

describe('hoisting changes the tree, not the document', () => {
  it('still expands the abbreviation inside the container it was written in', () => {
    expect(carveToHtml(':::\n*[HTML]: HyperText\n\nHTML rocks\n:::\n')).toContain(
      '<abbr title="HyperText">HTML</abbr>',
    )
  })

  it('expands it outside that container too, since the scope is the document', () => {
    expect(carveToHtml(':::\n*[HTML]: HyperText\n:::\n\nHTML rocks\n')).toContain(
      '<abbr title="HyperText">HTML</abbr>',
    )
  })
})

describe('the hoist is part of parse(), not of serialization (PART 12 §6)', () => {
  it('round-trips a hoisted definition to an identical tree', () => {
    // §6: `parse(x)` serialized and deserialized MUST equal `parse(x)`. An
    // implementation that leaves the node nested in the parsed tree and hoists
    // it in the encoder satisfies §7 and breaks this on the same document -
    // the mistake §1a already records for text-run coalescing.
    const doc = parse(':::\n*[HTML]: HyperText\n\nbody\n:::\n')
    expect(fromAstJson(toAstJson(doc))).toEqual(doc)
  })

  it('publishes the definition at document level on the wire', () => {
    const json = toAstJson(parse(':::\n*[HTML]: HyperText\n\nbody\n:::\n'))
    expect(json.children.map((c) => (c as { type: string }).type)).toEqual([
      'div',
      'abbreviation_def',
    ])
  })
})
