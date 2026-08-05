import { describe, expect, it } from 'vitest'
import { carveToAstJson, fromAstJson, parse, renderHtml, toAstJson } from '../src/index.js'

/*
 * `refId` does not cross the wire in either direction.
 *
 * It is a RENDERING convention - `fnref1`, the anchor an endnotes section links
 * back to - not a resolution result. `resources/ast-schema.json` declared it on
 * `footnote_ref` and `inline_footnote` and no engine ever produced one, so
 * markup-carve/carve#762 removed it. With `additionalProperties: false`, a tree
 * carrying it is now invalid.
 *
 * This engine never WROTE one. It ECHOED one (carve-js#707): the codec copies a
 * wire record wholesale, so a `refId` that arrived on a payload came straight
 * back out, and a document read and re-published here became one the published
 * format rejects. carve-php already refuses such a payload outright.
 *
 * THE RUNTIME FIELD STAYS. `renderHtml` assigns it while numbering footnotes and
 * builds the backlinks from it; the last case here is what keeps "do not publish
 * it" from being satisfied by never computing it.
 */

const SOURCE = 'Text[^a] and[^a].\n\n[^a]: note\n'

/** The published tree for SOURCE, with `refId` injected on every reference. */
function treeWithInjectedRefId(): Record<string, unknown> {
  const tree = carveToAstJson(SOURCE) as unknown as Record<string, unknown>
  const walk = (node: unknown): void => {
    if (node === null || typeof node !== 'object') return
    const record = node as Record<string, unknown>
    if (record['type'] === 'footnote_ref' || record['type'] === 'inline_footnote') {
      record['refId'] = 'fnref9'
    }
    for (const value of Object.values(record)) walk(value)
  }
  walk(tree)

  return tree
}

describe('footnote refId', () => {
  it('is not produced by a fresh parse', () => {
    // The baseline the issue rests on: nothing here ever wrote one.
    expect(JSON.stringify(carveToAstJson(SOURCE))).not.toContain('refId')
  })

  it('does not reach the runtime tree when a payload carries one', () => {
    // "Stop reading it." An inherited anchor would be the PREVIOUS document's
    // numbering, which is worse than absent.
    const document = fromAstJson(treeWithInjectedRefId() as never)

    expect(JSON.stringify(document)).not.toContain('refId')
  })

  it('is not echoed back onto the wire', () => {
    // The reported symptom: read a tree carrying one, publish it again, and the
    // field came back - a document the schema now rejects.
    const republished = toAstJson(fromAstJson(treeWithInjectedRefId() as never))

    expect(JSON.stringify(republished)).not.toContain('refId')
  })

  it('leaves everything else on the reference intact', () => {
    // The boundary. Dropping the whole node, or its `id` or `number`, would also
    // satisfy the assertions above.
    const republished = JSON.stringify(
      toAstJson(fromAstJson(treeWithInjectedRefId() as never)),
    )

    expect(republished).toContain('"footnote_ref"')
    expect(republished).toContain('"id":"a"')
    expect(republished).toContain('"number":1')
  })

  it('is still assigned for the HTML backlinks', () => {
    // The other half. `renderHtml` computes it from the number, so the endnotes
    // section still links back - twice here, since the note is referenced twice.
    const html = renderHtml(parse(SOURCE))

    expect(html).toContain('id="fnref1"')
    expect(html).toContain('id="fnref1-2"')
    expect(html).toContain('id="fn1"')
  })

  it('an inline footnote is treated the same way', () => {
    // Both node types carried the field, so both have to drop it.
    const tree = carveToAstJson('a ^[note] b\n') as unknown as Record<string, unknown>
    const walk = (node: unknown): void => {
      if (node === null || typeof node !== 'object') return
      const record = node as Record<string, unknown>
      if (record['type'] === 'inline_footnote') record['refId'] = 'fnref1'
      for (const value of Object.values(record)) walk(value)
    }
    walk(tree)

    const republished = JSON.stringify(toAstJson(fromAstJson(tree as never)))
    expect(republished).toContain('"inline_footnote"')
    expect(republished).not.toContain('refId')
  })
})
