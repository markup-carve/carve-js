import { describe, it, expect } from 'vitest'
import { parse, toAstJson, fromAstJson, carveToAstJson, renderHtml } from '../src/index.js'
import {
  ABBR_BUDGET_BASE,
  ABBR_BUDGET_FACTOR,
  abbrBudget,
  budgetForDocument,
  expansionBudgetLength,
  utf8ByteLength,
} from '../src/abbr-budget.js'

/**
 * A cap has to be enforced against something the attacker does not supply.
 *
 * The expansion budgets - abbreviations, the table of contents, the index, a
 * cross-reference label - are `max(BASE, FACTOR * srcByteLength)`. On the parse
 * path that number is a MEASUREMENT: the parser measured its own input, so a
 * bigger budget costs a bigger document. On the ingest path it arrives INSIDE
 * the payload (PART 12 §7), where rewriting nine bytes widened the guard meant
 * to bound the document that rewrote it (markup-carve/carve-js#900).
 *
 * carve-php closed this at markup-carve/carve-php#1055 and carve-rs at
 * markup-carve/carve-rs#814, both by bounding the claim with the payload's
 * measured size and letting the smaller win. This is the same shape.
 *
 * WHAT THIS DOES NOT CLAIM. In this engine the bound is defense in depth and
 * not an output reduction on any shape that could be constructed for it, which
 * is a measurement rather than an assumption: the abbreviation wire carries
 * `expansion` per occurrence, and the TOC, index and cross-reference labels are
 * all likewise carried on the wire rather than derived at ingest, so emitted
 * bytes are proportional to payload bytes and `FACTOR * payload` is never the
 * binding constraint. The number the budget TRUSTS still moves, which is what
 * these rows assert.
 */
describe('an expansion budget is sized from what the payload cost, not what it claims', () => {
  const roundTrip = (src: string, edit?: (json: Record<string, unknown>) => void) => {
    const payload = JSON.stringify(toAstJson(parse(src)))
    const json = JSON.parse(payload) as Record<string, unknown>
    edit?.(json)
    return { json, payloadBytes: utf8ByteLength(payload) }
  }

  it('the policy constants are unchanged, and shared with carve-rs and carve-php', () => {
    expect(ABBR_BUDGET_BASE).toBe(1_000_000)
    expect(ABBR_BUDGET_FACTOR).toBe(8)
  })

  it('a rewritten srcByteLength no longer widens the budget', () => {
    const src = '*[AB]: expanded\n\nAB AB AB\n'
    const { json, payloadBytes } = roundTrip(src, (j) => {
      j['srcByteLength'] = 1_000_000_000
    })
    const doc = fromAstJson(json as never, payloadBytes)
    // The claim is 1e9; the payload cost a few hundred bytes, and that is what
    // the budget is sized from.
    expect(expansionBudgetLength(doc)).toBe(payloadBytes)
    expect(expansionBudgetLength(doc)).toBeLessThan(1_000_000_000)
    expect(abbrBudget(expansionBudgetLength(doc))).toBe(ABBR_BUDGET_BASE)
  })

  it('a claim SMALLER than the payload is still honored', () => {
    // An encoded tree is larger than the source it came from, so on an honest
    // round trip the payload bound does not bind - and a document that says it
    // came from a short source is not made suspect by its AST being verbose.
    const src = '*[AB]: expanded\n\nAB AB AB\n'
    const { json, payloadBytes } = roundTrip(src)
    const doc = fromAstJson(json as never, payloadBytes)
    expect(doc.srcByteLength).toBe(utf8ByteLength(src))
    expect(expansionBudgetLength(doc)).toBe(utf8ByteLength(src))
    expect(expansionBudgetLength(doc)).toBeLessThan(payloadBytes)
  })

  it('measures the payload itself when the caller did not', () => {
    // A library caller hands over an object that has already lost its string.
    // Omitting the measurement must not restore the claim's authority.
    const { json } = roundTrip('*[AB]: expanded\n\nAB AB AB\n', (j) => {
      j['srcByteLength'] = 1_000_000_000
    })
    const doc = fromAstJson(json as never)
    expect(expansionBudgetLength(doc)).toBeLessThan(1_000_000)
    expect(abbrBudget(expansionBudgetLength(doc))).toBe(ABBR_BUDGET_BASE)
  })

  it('every budget CONSUMER is sized from the bound, not from the claim', () => {
    // The seam between the bound and the five consumers is `budgetForDocument`,
    // and asserting `expansionBudgetLength` alone leaves it untested: the
    // consumers could still read `srcByteLength`. Charged directly, because no
    // rendered output in this engine can show the difference - the wire carries
    // every expansion, so emitted bytes stay proportional to payload bytes.
    const { json, payloadBytes } = roundTrip('*[AB]: e\n\nAB\n', (j) => {
      j['srcByteLength'] = 1_000_000_000
    })
    const doc = fromAstJson(json as never, payloadBytes)
    // With the claim honored the budget would be 8e9 and this would fit.
    expect(budgetForDocument(doc).charge(2_000_000)).toBe(false)
    // The floor is still underneath it.
    expect(budgetForDocument(doc).charge(ABBR_BUDGET_BASE)).toBe(true)
  })

  it('the measurement is the bytes that arrived, not the bytes re-encoded', () => {
    // A pretty-printed payload costs more to send than its compact form. The
    // caller that read it knows that; a re-encode here does not, and would size
    // the budget from a smaller number than the input actually was.
    const compact = JSON.stringify(toAstJson(parse('*[AB]: e\n\nAB\n')))
    const pretty = JSON.stringify(JSON.parse(compact), null, 2)
    expect(utf8ByteLength(pretty)).toBeGreaterThan(utf8ByteLength(compact))
    const doc = fromAstJson(JSON.parse(pretty), utf8ByteLength(pretty))
    // The claim is smaller than either, so raise it out of the way first.
    const claimed = JSON.parse(pretty) as Record<string, unknown>
    claimed['srcByteLength'] = 1_000_000_000
    expect(expansionBudgetLength(fromAstJson(claimed as never, utf8ByteLength(pretty)))).toBe(
      utf8ByteLength(pretty),
    )
    expect(doc.srcByteLength).toBe(utf8ByteLength('*[AB]: e\n\nAB\n'))
  })

  it('a payload that cannot be re-encoded measures 0, not everything', () => {
    // The realistic trigger is a payload past the host's maximum string length,
    // which is exactly the case that must not be handed a budget sized from its
    // own claim. Forced here rather than allocated: the failure branch is
    // otherwise unreachable, and an unreachable branch that reports the wrong
    // direction is the shape this repository keeps finding.
    const { json } = roundTrip('*[AB]: e\n\nAB\n', (j) => {
      j['srcByteLength'] = 1_000_000_000
    })
    Object.setPrototypeOf(json, {
      toJSON() {
        throw new RangeError('Invalid string length')
      },
    })
    const doc = fromAstJson(json as never)
    expect(expansionBudgetLength(doc)).toBe(0)
    expect(abbrBudget(expansionBudgetLength(doc))).toBe(ABBR_BUDGET_BASE)
  })

  it('CONTROL: a parsed document is bounded by its own measurement, unchanged', () => {
    // No mutation of the ingest bound moves this row: `parse` measured the
    // input, so the claim IS the measurement and there is nothing to bound.
    const src = `*[AB]: expanded\n\n${'AB '.repeat(200)}\n`
    const doc = parse(src)
    expect(expansionBudgetLength(doc)).toBe(utf8ByteLength(src))
    expect(expansionBudgetLength(doc)).toBe(doc.srcByteLength)
  })

  it('CONTROL: a hand-built document with no srcByteLength gets the floor', () => {
    expect(expansionBudgetLength({ type: 'document', children: [] } as never)).toBe(0)
    expect(abbrBudget(0)).toBe(ABBR_BUDGET_BASE)
  })

  it('PART 12 §7: srcByteLength is re-encoded exactly as it arrived', () => {
    // The fix changes what the BUDGET trusts, not what the wire carries. A
    // reader that repaired the field would have silently rewritten the record.
    const { json, payloadBytes } = roundTrip('*[AB]: e\n\nAB\n', (j) => {
      j['srcByteLength'] = 1_000_000_000
    })
    const doc = fromAstJson(json as never, payloadBytes)
    expect(doc.srcByteLength).toBe(1_000_000_000)
    expect(toAstJson(doc).srcByteLength).toBe(1_000_000_000)
  })

  it('the rendered output of an honest round trip does not move', () => {
    // The legitimate divergence this accepts is a source much larger than its
    // AST; an ordinary document must render identically through the wire.
    const src = `*[AB]: expanded\n\n${'AB '.repeat(50)}\n`
    const direct = renderHtml(parse(src), {})
    const payload = JSON.stringify(carveToAstJson(src))
    const ingested = renderHtml(fromAstJson(JSON.parse(payload), utf8ByteLength(payload)), {})
    expect(ingested).toBe(direct)
  })
})
