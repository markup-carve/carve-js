/*
 * PART 12 §6: an ingested tree is the runtime shape all the way down.
 *
 * `definitionListsFromWire` returned as soon as it had rewritten a definition
 * list's own `items`, so a list nested inside a DESCRIPTION was never reached
 * and stayed in its `definition_term` / `definition_description` wire shape.
 * The next ingest pass reads `entry.definitions` off those entries and threw
 * (carve-js#1616, corpus 447 row 6).
 */
import { describe, it, expect } from 'vitest'
import { carveToAstJson, carveToHtml, fromAstJson, renderHtml, toAstJson } from '../src/index.js'

/** Corpus `447-...-6`: a definition list inside a description body. */
const NESTED = ':: t\n:  :: u\n   : d\n    [r]: /url\n\nSee [r][].\n'

/** The same document with no nesting - the control a whole-file revert keeps green. */
const FLAT = ':: t\n:  d\n   [r]: /url\n\nSee [r][].\n'

const roundTrip = (src: string) => {
  const json = carveToAstJson(src)
  return { json, back: toAstJson(fromAstJson(JSON.parse(JSON.stringify(json)))) }
}

describe('a definition list inside a description decodes', () => {
  it('ingests the nested list and round-trips to identity', () => {
    const { json, back } = roundTrip(NESTED)
    expect(back).toEqual(json)
  })

  it('gives the inner list runtime entries, not wire nodes', () => {
    const doc = fromAstJson(JSON.parse(JSON.stringify(carveToAstJson(NESTED))))
    const outer = doc.children[0] as { items: { definitions: unknown[][] }[] }
    const inner = outer.items[0]!.definitions[0]![0] as { items: { definitions?: unknown }[] }
    expect(inner.items.every((entry) => Array.isArray(entry.definitions))).toBe(true)
  })

  it('renders the ingested tree the way the source renders', () => {
    const doc = fromAstJson(JSON.parse(JSON.stringify(carveToAstJson(NESTED))))
    expect(renderHtml(doc)).toBe(carveToHtml(NESTED))
  })

  it('control: an unnested description still round-trips', () => {
    const { json, back } = roundTrip(FLAT)
    expect(back).toEqual(json)
  })
})
