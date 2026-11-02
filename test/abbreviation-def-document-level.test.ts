import { describe, it, expect } from 'vitest'
import { parse } from '../src/parse.js'
import { toAstJson, fromAstJson } from '../src/ast-json.js'
import { carveToHtml } from '../src/index.js'
import type { BlockNode, Document } from '../src/ast.js'

/**
 * CARVE-P12-026 (carve#4865): `*[TERM]: expansion` is a definition in every
 * container, with document scope. It reads as a link reference definition does
 * and hoists to the document as a node. Escape the line to show it.
 */

const types = (blocks: readonly BlockNode[]): string[] => blocks.map((b) => b.type)

const abbrDefs = (doc: Document) =>
  doc.children.filter((b) => b.type === 'abbreviation_def')

const squash = (html: string) => html.replace(/\s+/g, ' ').trim()

describe('an abbreviation definition is recognized in every container', () => {
  it('defines at document level', () => {
    const doc = parse('*[HTML]: HyperText\n\nThe HTML spec.\n')
    expect(types(doc.children)).toEqual(['abbreviation_def', 'paragraph'])
    expect(squash(carveToHtml('*[HTML]: HyperText\n\nThe HTML spec.\n'))).toBe(
      '<p>The <abbr title="HyperText">HTML</abbr> spec.</p>',
    )
  })

  it('defines inside a block quote and hoists to the document', () => {
    const doc = parse('> *[HTML]: HyperText\n\nThe HTML spec.\n')
    expect(types(doc.children)).toEqual(['block_quote', 'abbreviation_def', 'paragraph'])
    expect(abbrDefs(doc)[0]!.pos?.startLine).toBe(1)
    expect(squash(carveToHtml('> *[HTML]: HyperText\n\nThe HTML spec.\n'))).toBe(
      '<blockquote> </blockquote> <p>The <abbr title="HyperText">HTML</abbr> spec.</p>',
    )
  })

  it('defines inside a list item', () => {
    expect(squash(carveToHtml('- *[HTML]: HyperText\n\nThe HTML spec.\n'))).toBe(
      '<ul> <li></li> </ul> <p>The <abbr title="HyperText">HTML</abbr> spec.</p>',
    )
  })

  it('defines inside a div', () => {
    const doc = parse(':::\n*[HTML]: HyperText\n\nbody\n:::\n')
    expect(types(doc.children)).toEqual(['div', 'abbreviation_def'])
    expect(squash(carveToHtml(':::\n*[HTML]: HyperText\n\nbody\n:::\n\nThe HTML spec.\n'))).toBe(
      '<div> <p>body</p> </div> <p>The <abbr title="HyperText">HTML</abbr> spec.</p>',
    )
  })

  it('stays text when escaped', () => {
    expect(squash(carveToHtml('> \\*[HTML]: HyperText\n'))).toBe('<blockquote><p>*[HTML]: HyperText</p></blockquote>')
  })
})

describe('the definition is invisible in a container for every purpose', () => {
  it('leaves no open paragraph, so a line below it does not fold', () => {
    expect(squash(carveToHtml('> *[A]: b\nc\n'))).toBe('<blockquote> </blockquote> <p>c</p>')
    // Not squashed: `*[A]:<TAB>b` is no definition, since the separator must be a
    // literal space, so it stays a paragraph the next line folds into.
    expect(carveToHtml('> *[A]:\tb\nc\n').trim()).toBe(
      '<blockquote><p>*[A]:\tb\nc</p></blockquote>',
    )
  })

  it('interrupts an open paragraph inside a list item', () => {
    expect(squash(carveToHtml('- x\n  *[A]: b\n'))).toBe('<ul> <li>x</li> </ul>')
  })

  it('defines after missing the item content column', () => {
    expect(squash(carveToHtml('- x\n*[A]: b\n\nThe A spec.\n'))).toBe(
      '<ul> <li>x</li> </ul> <p>The <abbr title="b">A</abbr> spec.</p>',
    )
  })

  it('is a definition once a blank line closes the item', () => {
    expect(squash(carveToHtml('- x\n\n*[A]: b\n\nThe A spec.\n'))).toBe(
      '<ul> <li>x</li> </ul> <p>The <abbr title="b">A</abbr> spec.</p>',
    )
  })
})

describe('order independence is unchanged', () => {
  it('a document-level definition after its use still expands', () => {
    expect(squash(carveToHtml('The HTML spec.\n\n*[HTML]: HyperText\n'))).toBe(
      '<p>The <abbr title="HyperText">HTML</abbr> spec.</p>',
    )
  })
})

describe('the tree survives the round trip (PART 12 §6)', () => {
  it('a container-authored definition decodes to the same tree', () => {
    const src = '> *[HTML]: HyperText\n\nThe HTML spec.\n'
    const doc = parse(src)
    const round = fromAstJson(toAstJson(doc)) as Document
    expect(types(round.children)).toEqual(types(doc.children))
    expect(abbrDefs(round)).toHaveLength(1)
  })

  it('a document-level definition round trips as a node', () => {
    const doc = parse('*[HTML]: HyperText\n\nThe HTML spec.\n')
    const round = fromAstJson(toAstJson(doc)) as Document
    expect(types(round.children)).toEqual(['abbreviation_def', 'paragraph'])
  })
})
