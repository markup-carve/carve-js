import { describe, expect, it } from 'vitest'
import { htmlToAst, htmlToCarve, parse, toAstJson } from '../src/index.js'

/**
 * The fields PART 12 fills in from a SOURCE - which spelling a marker used,
 * which slot an attribute sat in. An import read HTML and had no source to read
 * one off, so the published tree records none of them
 * (markup-carve/carve#1647), and a comparison against a parse has to look past
 * them for that reason rather than as a convenience. The spec's own reading of
 * these two exits skips the same set
 * (`spec/tests/the-two-import-exits-agree.test.mjs`).
 */
const SOURCE_LAYOUT_FIELDS = new Set([
  'order',
  'bulletChar',
  'bareMarker',
  'delim',
  'definitionLines',
  'definitionSpans',
  'termSpans',
])

const sourceLayoutKeys = (value: unknown, path = ''): string[] => {
  if (Array.isArray(value)) return value.flatMap((item, i) => sourceLayoutKeys(item, `${path}[${i}]`))
  if (value === null || typeof value !== 'object') return []
  return Object.entries(value as Record<string, unknown>).flatMap(([key, inner]) =>
    SOURCE_LAYOUT_FIELDS.has(key) ? [`${path}.${key}`] : sourceLayoutKeys(inner, `${path}.${key}`),
  )
}

/**
 * Plus the two fields that record WHERE a node was written. A parse read bytes
 * and an import did not, so `pos` and `srcByteLength` differ by construction -
 * the shared fixture comparison drops them for the same reason
 * (`test/html-import-conformance.test.ts`).
 */
const IGNORED = new Set([...SOURCE_LAYOUT_FIELDS, 'pos', 'srcByteLength'])

const comparable = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(comparable)
  if (value === null || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !IGNORED.has(key))
      .map(([key, inner]) => [key, comparable(inner)]),
  )
}

describe('authored HTML heading ids', () => {
  const html = '<h1 id="Target">Target</h1><p>See <a href="#Target">Target</a>.</p>'

  /*
   * THE CONTROL FOR markup-carve/carve-js#1416, and it is the half a fix for
   * the slot can silently undo. `Target` IS the slug `# Target` generates, so a
   * writer told nothing about the id reads it as generated and omits it - which
   * is the loss #1416 closed. Asserting the written source rather than the slot
   * keeps the requirement stated in terms of what a reader loses.
   */
  it('writes the authored id back, even where it equals the generated slug', () => {
    expect(htmlToCarve(html).value).toBe('{#Target}\n# Target\n\nSee [Target](#Target).\n')
  })

  it('keeps the authored id on the published tree', () => {
    const heading = (toAstJson(htmlToAst(html).value) as { children: Array<{ attrs?: { id?: string } }> }).children[0]
    expect(heading?.attrs?.id).toBe('Target')
  })

  /*
   * AND RECORDS NO SPELLING FOR IT (markup-carve/carve#1647). #1416 carried the
   * id by pushing an `#id` slot into `attrs.order`, and `order` is a
   * source-layout field: an import read HTML and saw no source, so stating one
   * states a spelling that was never read. The slot is a writer-only channel
   * now - `htmlToCarve` above still gets it, `htmlToAst` never does.
   */
  it('records no source-layout field, because the import read no source', () => {
    expect(sourceLayoutKeys(toAstJson(htmlToAst(html).value))).toEqual([])
  })

  it('says the same thing as a parse of the source it writes', () => {
    const source = htmlToCarve(html).value
    const imported = htmlToAst(html).value
    expect(comparable(toAstJson(parse(source, { positions: false })))).toEqual(
      comparable(toAstJson(imported)),
    )
  })
})
