import { describe, expect, it } from 'vitest'
import { carveToAstJson, carveToHtml } from '../src/index.js'

/**
 * A definition written in a description is collected inside a container too
 * (markup-carve/carve#840).
 *
 * Collecting empties the `dd` (markup-carve/carve#801) and hoists the node to
 * the document (PART 12 section 10: "a definition authored inside a block quote
 * or a list item is a child of the DOCUMENT"). Inside a block quote or a list
 * item this engine did the first half and not the second: the `dd` came out
 * empty, the node was published nowhere, and a reference to it stayed literal.
 * The author's line was neither visible nor active.
 *
 * The document-wide prepass strips container prefixes before matching, but it
 * answered "is this line a description?" from the RAW previous line - so
 * `> :: term` did not read as a term and the `:  ` marker was never stripped
 * off the line below it. A div has no per-line prefix, which is why that one
 * container always worked.
 */
describe('a definition in a description inside a container', () => {
  const published = (src: string): boolean =>
    JSON.stringify(carveToAstJson(src)).includes('link_reference_definition')
  const resolved = (src: string): boolean => carveToHtml(src).includes('href="/u"')

  const IN_QUOTE = '> :: term\n> :  [r]: /u\n>\n> see [t][r]\n'
  const IN_ITEM = '- :: term\n  :  [r]: /u\n\nsee [t][r]\n'

  it('is hoisted to the document from a block quote', () => {
    expect(published(IN_QUOTE)).toBe(true)
  })

  it('is hoisted to the document from a list item', () => {
    expect(published(IN_ITEM)).toBe(true)
  })

  it('resolves the reference that names it', () => {
    // The consequence a reader sees, asserted apart from the tree: a definition
    // published nowhere still emptied the `dd`, so the line vanished AND the
    // reference stayed literal.
    expect(resolved(IN_QUOTE)).toBe(true)
    expect(resolved(IN_ITEM)).toBe(true)
  })

  it('empties the description, as it does at top level', () => {
    // The other half of the collection contract. A fix that stopped collecting
    // inside containers would satisfy nothing above but would look similar.
    expect(carveToHtml(IN_QUOTE)).toContain('<dd></dd>')
  })

  it('still works at top level and in a div', () => {
    // The controls: the shapes that already passed must keep passing.
    expect(published(':: term\n:  [r]: /u\n\nsee [t][r]\n')).toBe(true)
    expect(published('::: note\n:: term\n:  [r]: /u\n:::\n\nsee [t][r]\n')).toBe(true)
  })

  it('does not collect a description line with no term above it', () => {
    // The boundary the prepass gate exists for (corpus
    // 216-a-description-line-needs-a-term-above-it): a lone `:  ` line is not
    // a description, so what follows its marker is not a definition.
    expect(published(':  [r]: /u\n\nsee [t][r]\n')).toBe(false)
  })
})
