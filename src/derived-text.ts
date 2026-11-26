// C2-H-201: the budget for derived text, `derived_text_bytes` and `derived_text_factor` of data/limits.json.
import { type DocumentNode, type Node } from './ast.ts'
import { loss, type Render } from './html-attributes.ts'
import { utf8Length } from './positions.ts'
import { JSON_SOURCE_LENGTH } from './ast-json.ts'
import { testDerivedTextBytes } from './harness-limits.ts'

export const DERIVED_TEXT_BYTES = 1_000_000
export const DERIVED_TEXT_FACTOR = 8

/** The budget of one render; a supplied tree without `srcByteLength` has the fixed one. */
export function derivedTextBudget(document: DocumentNode, source: string | number | undefined): number {
  const lowered = testDerivedTextBytes()
  if (lowered !== undefined) return lowered
  const supplied = document.srcByteLength ?? 0
  const jsonLength = (document as DocumentNode & { [JSON_SOURCE_LENGTH]?: number })[JSON_SOURCE_LENGTH]
  const bounded = jsonLength === undefined ? supplied : Math.min(supplied, jsonLength)
  const bytes = typeof source === 'string' ? utf8Length(source) : source ?? bounded
  return Math.max(DERIVED_TEXT_BYTES, DERIVED_TEXT_FACTOR * bytes)
}

/**
 * Draws `text` on the budget of the render and returns true, or returns false where it does not fit what remains; the
 * first node that does not fit is reported, once per render.
 */
export function drawDerivedText(r: Render, node: Node, text: string, knownCost?: number): boolean {
  if (r.derivedBudget < 0) {
    r.derivedBudget = derivedTextBudget(r.document, r.source)
    r.derivedLeft = r.derivedBudget
  }
  const cost = knownCost ?? utf8Length(text)
  if (cost <= r.derivedLeft) {
    r.derivedLeft -= cost
    return true
  }
  if (!r.derivedReported) {
    r.derivedReported = true
    const message = `Wrote an abbreviation or a cross-reference in its plain form: the derived text of this render reached its budget of ${
      r.derivedBudget} bytes`
    loss(r, node, 'derived-text-budget', message)
  }
  return false
}
