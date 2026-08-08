/**
 * Abbreviation-expansion output budget (DoS guard).
 *
 * Each occurrence of an abbreviation re-emits its full expansion
 * (`<abbr title="EXPANSION">KEY</abbr>` in HTML, a raw `<abbr>` in Markdown,
 * `(EXPANSION)` in ANSI). A tiny input that defines a huge expansion
 * (`*[KEY]: <50KB>`) and uses the key many times amplifies output by
 * expansion_len x occurrences - up to thousands of times - and can exceed
 * V8's max string length (`RangeError: Invalid string length`), crashing the
 * render. We bound the cumulative bytes contributed by expansions across a
 * single render: once the next occurrence would exceed the budget, that
 * occurrence (and all later ones) degrade gracefully to the plain key text
 * only (no `<abbr>` wrapper, no title). No throw, no giant allocation.
 *
 * Budget = max(BASE, FACTOR * sourceByteLength). This is far above any real
 * document and above every spec-corpus fixture, so the corpus is unaffected.
 *
 * Each occurrence is charged the RAW UTF-8 byte length of `expansion` (not the
 * HTML/Markdown-escaped form). This is deliberate: the same charge unit is used
 * by carve-rs and carve-php so all three impls degrade at the exact same
 * occurrence, keeping output cross-impl-aligned. An escape-heavy expansion
 * (e.g. all `&`, which inflates ~5x to `&amp;`) can therefore overshoot the
 * budget by that constant escape factor - a benign linear overage (a 1MB
 * budget tops out near ~5MB), nowhere near V8's max string length. The crash
 * DoS this guards against requires unbounded amplification, which the byte
 * cap removes regardless of the escape factor.
 *
 * The counter is per render call. A renderer constructs a fresh tracker at its
 * top-level entry; it must never leak across calls.
 */

// Shared encoder for UTF-8 byte counting. `Buffer` is Node-only; carve-js
// runs in browsers too (the playground), so the byte length must be computed
// with the universal TextEncoder, matching the rest of the public pipeline.
const UTF8_ENCODER = new TextEncoder()

/** UTF-8 byte length of a string (browser-safe; matches PHP's strlen). */
export function utf8ByteLength(s: string): number {
  return UTF8_ENCODER.encode(s).length
}

/** Base budget floor in bytes (applies even for empty/zero-length sources). */
export const ABBR_BUDGET_BASE = 1_000_000

/** Budget grows this many bytes per source byte. */
export const ABBR_BUDGET_FACTOR = 8

/** Compute the per-render expansion budget from the source byte length. */
export function abbrBudget(srcByteLength: number | undefined): number {
  return Math.max(ABBR_BUDGET_BASE, ABBR_BUDGET_FACTOR * (srcByteLength ?? 0))
}

/**
 * The budget for one render of `ast`.
 *
 * A cross-reference label charges this budget too, and it charges the RENDERED
 * label rather than the raw display text - the opposite of the abbreviation
 * charge one comment up. Deliberate, and for the same reason that one is
 * deliberate: the abbreviation charges raw so that three ENGINES degrade at the
 * same occurrence, and a crossref label charges what it emits so that the bound
 * is on the bytes that actually exist. The three engines still agree, because
 * for one target they render the same label to the same bytes; what differs is
 * that an escape-heavy label costs more in HTML than in plain text, which is
 * true of the output as well (raised by codex review).
 *
 * Every renderer and extension sizes its budget through this one call, so the
 * document's length is read in exactly ONE place. That matters because the
 * number is not always measured: on the AST-ingest path `srcByteLength` arrives
 * inside the payload, where a hostile tree can inflate it to widen the guard
 * meant to bound it. Whatever ends up bounding that claim binds every consumer
 * at once from here, instead of having to find five spellings of the same read.
 */
export function budgetForDocument(ast: { srcByteLength?: number }): AbbrBudget {
  return new AbbrBudget(expansionBudgetLength(ast))
}

/**
 * What an ingested document's payload ACTUALLY cost, keyed by the decoded
 * document.
 *
 * A WeakMap rather than a field on `Document`, deliberately. This is a fact
 * about how the document ARRIVED, not about the document: putting it on the
 * object would put one reader's measurement where the next reader reads it back
 * as a claim, and it would also have to be excluded by hand from the wire
 * whitelist, from the writer's tree comparison and from `diff`. Off the object,
 * none of those has anything new to exclude.
 *
 * Set by `fromAstJson` and by nothing else. A document from `parse` is absent
 * from the map, which is the right answer for it: the parser measured its own
 * input, so the claim IS the measurement.
 */
const ingestPayloadLength = new WeakMap<object, number>()

/** Record what the payload `doc` was decoded from actually cost, in bytes. */
export function recordIngestPayloadLength(doc: object, bytes: number): void {
  ingestPayloadLength.set(doc, bytes)
}

/**
 * The length a per-render expansion budget may be sized from.
 *
 * The budgets - abbreviations, the table of contents, the index, a
 * cross-reference label - are `max(BASE, FACTOR * this)`. A cap has to be
 * enforced against something the attacker does not supply, and on the PARSE
 * path `srcByteLength` is exactly that: the parser measured the input, so a
 * bigger budget costs a bigger document.
 *
 * On the INGEST path that number arrives INSIDE the payload (PART 12 §7 makes
 * it a field of the wire). Left alone it let the payload choose the size of the
 * guard meant to bound it: rewriting one number from 62,009 to 1,000,000,000
 * took a document from 1.01 MB of HTML to 200 MB, for nine extra bytes and no
 * extra payload. So an ingested document is bounded by what its payload cost as
 * well as by what it claims, and THE SMALLER WINS.
 *
 * The claim is still honored where it is smaller, because a document that says
 * it came from a short source is not made suspect by its AST being verbose - and
 * an encoded tree is larger than the source it came from, so on an honest round
 * trip this does not bind.
 *
 * A LEGITIMATE DIVERGENCE, stated rather than papered over: a source much larger
 * than its AST - mostly blank lines, past roughly 125 KB where the 1 MB floor
 * stops covering - renders with a smaller budget after a round trip than it did
 * on the parse path. That is not fixable. The bytes that would distinguish an
 * honest large source from a claim about one are exactly the bytes the AST does
 * not carry. carve-php and carve-rs accepted the same divergence.
 *
 * `srcByteLength` itself is untouched: it is read as written and re-encoded
 * unchanged, because PART 12 §7 requires the field to survive a round trip. What
 * moves is what the BUDGET trusts, not what the wire carries.
 */
export function expansionBudgetLength(ast: { srcByteLength?: number }): number {
  const claimed = ast.srcByteLength ?? 0
  const measured = ingestPayloadLength.get(ast as object)
  return measured === undefined ? claimed : Math.min(claimed, measured)
}

/**
 * Mutable per-render tracker. `charge(expansion)` returns true if emitting
 * `expansion` stays within budget (and accounts for it); false once the budget
 * is exhausted, signalling the renderer to degrade to plain key text.
 */
export class AbbrBudget {
  private remaining: number

  constructor(srcByteLength: number | undefined) {
    this.remaining = abbrBudget(srcByteLength)
  }

  /**
   * Try to spend `cost` bytes of budget. Returns true if it fit (and the
   * budget was decremented); false if it would overflow (budget untouched, so
   * a later shorter expansion could still fit - though in practice all
   * occurrences share one expansion, this keeps the bound monotonic).
   */
  charge(cost: number): boolean {
    if (cost > this.remaining) return false
    this.remaining -= cost
    return true
  }
}
