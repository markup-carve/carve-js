import { describe, it, expect } from 'vitest'
import { parse } from '../src/parse.js'
import { toAstJson, fromAstJson } from '../src/ast-json.js'
import { carveToHtml } from '../src/index.js'
import type { BlockNode, Document } from '../src/ast.js'

/**
 * PART 12 §7: `*[TERM]: expansion` is an abbreviation definition ONLY as a
 * direct child of the document. Inside a block quote, a list item or a div the
 * line is ordinary paragraph text: it defines nothing and is preserved as
 * written.
 *
 * This replaces a rule that hoisted a container-authored definition to the
 * document. Hoisting was dropped for two reasons. It could not be represented:
 * once hoisted, an inert definition and a real one are the same wire shape, so
 * a consumer decoding the tree expanded what the parser did not, failing §6's
 * round trip on a document this engine produced. And it deleted the author's
 * line: `> *[HTML]: Hyper Text` rendered an EMPTY block quote, because the
 * definition was collected out of it and then rendered nothing.
 *
 * An abbreviation is the only definition kind with no marker at the use site -
 * a footnote needs `[^a]`, a reference link needs `[text][ref]` - so its reach
 * is every occurrence of the term in the document. A container is where quoted
 * material lives, and quoted material may not rewrite the quoting document.
 * (carve#708, carve-php#708, carve-php#631)
 */

const types = (blocks: readonly BlockNode[]): string[] => blocks.map((b) => b.type)

const abbrDefs = (doc: Document) =>
  doc.children.filter((b) => b.type === 'abbreviation_def')

const squash = (html: string) => html.replace(/\s+/g, ' ').trim()

describe('an abbreviation definition is recognized only at document level', () => {
  it('defines at document level', () => {
    const doc = parse('*[HTML]: HyperText\n\nThe HTML spec.\n')
    expect(types(doc.children)).toEqual(['abbreviation_def', 'paragraph'])
    expect(squash(carveToHtml('*[HTML]: HyperText\n\nThe HTML spec.\n'))).toBe(
      '<p>The <abbr title="HyperText">HTML</abbr> spec.</p>',
    )
  })

  it('is paragraph text inside a block quote, and expands nothing', () => {
    const doc = parse('> *[HTML]: HyperText\n\nThe HTML spec.\n')
    expect(types(doc.children)).toEqual(['block_quote', 'paragraph'])
    expect(abbrDefs(doc)).toEqual([])
    expect(squash(carveToHtml('> *[HTML]: HyperText\n\nThe HTML spec.\n'))).toBe(
      '<blockquote><p>*[HTML]: HyperText</p></blockquote> <p>The HTML spec.</p>',
    )
  })

  it('is paragraph text inside a list item', () => {
    expect(squash(carveToHtml('- *[HTML]: HyperText\n\nThe HTML spec.\n'))).toBe(
      '<ul> <li>*[HTML]: HyperText</li> </ul> <p>The HTML spec.</p>',
    )
  })

  it('is paragraph text inside a div', () => {
    const doc = parse(':::\n*[HTML]: HyperText\n\nbody\n:::\n')
    expect(types(doc.children)).toEqual(['div'])
    expect(abbrDefs(doc)).toEqual([])
    expect(squash(carveToHtml(':::\n*[HTML]: HyperText\n\nbody\n:::\n\nThe HTML spec.\n'))).toBe(
      '<div> <p>*[HTML]: HyperText</p> <p>body</p> </div> <p>The HTML spec.</p>',
    )
  })

  it('does not leave the container empty - the author keeps the line', () => {
    // The concrete defect the old hoisting rule had: the quote rendered blank.
    expect(squash(carveToHtml('> *[HTML]: HyperText\n'))).not.toBe('<blockquote> </blockquote>')
  })
})

describe('the definition form is inert in a container for every purpose', () => {
  it('holds an open paragraph, so a lazy line folds into it', () => {
    // It claims to be paragraph text, so it must behave as paragraph text. The
    // tab-separated fallback (`*[A]:<TAB>b`, not a definition because the
    // separator must be a literal space) has always folded; these now agree.
    expect(squash(carveToHtml('> *[A]: b\nc\n'))).toBe('<blockquote><p>*[A]: b c</p></blockquote>')
    // Not squashed: the tab has to survive as a tab, or the comparison with
    // the space-separated form above proves nothing.
    expect(carveToHtml('> *[A]:\tb\nc\n').trim()).toBe(
      '<blockquote><p>*[A]:\tb\nc</p></blockquote>',
    )
  })

  it('does not interrupt an open paragraph inside a list item', () => {
    expect(squash(carveToHtml('- x\n  *[A]: b\n'))).toBe('<ul> <li>x *[A]: b</li> </ul>')
  })

  it('folds as a lazy continuation rather than ending the item', () => {
    // Flush left but directly after an open item: item content, so no
    // definition is collected and `A` stays literal.
    expect(squash(carveToHtml('- x\n*[A]: b\n\nThe A spec.\n'))).toBe(
      '<ul> <li>x *[A]: b</li> </ul> <p>The A spec.</p>',
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
    // The reason hoisting was dropped: the decoded tree must expand exactly
    // what the parsed tree expands. With the line held as text in its
    // container, there is no shape for a consumer to misread.
    const src = '> *[HTML]: HyperText\n\nThe HTML spec.\n'
    const doc = parse(src)
    const round = fromAstJson(toAstJson(doc)) as Document
    expect(types(round.children)).toEqual(types(doc.children))
    expect(abbrDefs(round)).toEqual([])
  })

  it('a document-level definition round trips as a node', () => {
    const doc = parse('*[HTML]: HyperText\n\nThe HTML spec.\n')
    const round = fromAstJson(toAstJson(doc)) as Document
    expect(types(round.children)).toEqual(['abbreviation_def', 'paragraph'])
  })
})
