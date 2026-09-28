import { domTag, type P5Node } from './html-import-dom.js'

/**
 * The diagnostic codes, as the `code` enum of the published report schema
 * (`spec/resources/html-import-schema.json`) lists them.
 *
 * A runtime list rather than a hand-written union, because the union alone is
 * a constraint nothing can check: types are gone by the time a test runs, so
 * a code added here and not to the schema - or to the schema and not here -
 * diverged in silence. Deriving `HtmlImportDiagnosticCode` from this array
 * makes the two one thing, and a test then holds this array against the
 * schema's own enum.
 *
 * Not re-exported from `index.ts`: the package publishes the TYPE, and this
 * is the machinery the type is built from.
 */
export const HTML_IMPORT_DIAGNOSTIC_CODES = [
  'element-dropped',
  'element-unwrapped',
  'attribute-dropped',
  /**
   * An attribute the policy refused to represent as a Carve attribute, and
   * that reached the output ANYWAY, inside the bytes of an element `roundtrip`
   * keeps whole (markup-carve/carve-js#1468).
   *
   * NOT `attribute-dropped` carrying a different message. The two are opposite
   * facts about the same attribute, and a consumer that filters on the code
   * rather than reading the prose would be told a drop happened that did not -
   * which is the row somebody acts on, because `roundtrip` is the mode that is
   * not safe for untrusted input.
   */
  'attribute-preserved',
  'style-unmapped',
  'table-degraded',
  'structure-unspellable',
  'raw-preserved',
  'encoding-assumed',
  'diagnostics-truncated',
] as const

export type HtmlImportDiagnosticCode = (typeof HTML_IMPORT_DIAGNOSTIC_CODES)[number]

/** How much of the source survived this decision (format-bridges, v2). */
export type HtmlImportFidelity = 'preserved' | 'normalized' | 'degraded' | 'dropped'

/** How sure the importer is that the decision was the right one. */
export type HtmlImportConfidence = 'exact' | 'inferred' | 'fallback'

export interface HtmlImportDiagnostic {
  code: HtmlImportDiagnosticCode
  message: string
  severity: 'info' | 'warning' | 'error'
  /**
   * Fidelity and confidence are a property of the CODE, so they are stamped
   * here rather than recomputed by each consumer. The migration report used to
   * derive them on its way out, which meant the plain import report - the one
   * the shared fixtures compare - carried a decision the format defines and
   * this engine knew.
   */
  fidelity: HtmlImportFidelity
  confidence: HtmlImportConfidence
  path?: string
  line?: number
  column?: number
}

/**
 * The default fidelity of a diagnostic code, from the v2 contract. A mapping
 * may override it when the same operation has a narrower declared outcome.
 *
 * Ordered `preserved < normalized < degraded < dropped`, and the producer's
 * answer is FINAL: a binding must not reclassify it, and it must never be
 * inferred from the message text.
 */
export function diagnosticFidelity(code: HtmlImportDiagnosticCode): HtmlImportFidelity {
  switch (code) {
    // Nothing of the attribute was lost: it reached the output inside the bytes
    // of an element kept whole.
    case 'attribute-preserved':
      return 'preserved'
    // The bytes survive but structured editing does not.
    case 'raw-preserved':
    case 'element-unwrapped':
    case 'style-unmapped':
    case 'table-degraded':
    case 'encoding-assumed':
      return 'degraded'
    // The cap hides findings that may include irreversible loss, so it reports
    // the worst case rather than the state it could see.
    case 'diagnostics-truncated':
    case 'element-dropped':
    case 'attribute-dropped':
    case 'structure-unspellable':
      return 'dropped'
  }
}

/** The confidence of a diagnostic code, from the v2 contract. */
function diagnosticConfidence(code: HtmlImportDiagnosticCode): HtmlImportConfidence {
  switch (code) {
    // The importer assumed an encoding the source never declared.
    case 'encoding-assumed':
      return 'inferred'
    // Every code whose decision the importer can see for itself.
    case 'element-dropped':
    case 'attribute-dropped':
    case 'attribute-preserved':
    case 'element-unwrapped':
    case 'style-unmapped':
    case 'table-degraded':
    case 'raw-preserved':
    case 'structure-unspellable':
      return 'exact'
    // FAILS CLOSED. `diagnostics-truncated` reports a sample, so nothing about
    // the omitted findings is known - and a code a future version adds, arriving
    // here through a cast or a bindings boundary, says nothing about how sure
    // anyone can be either. Both take the weakest answer rather than the
    // strongest, which is what carve-php's own test for an unknown code
    // requires.
    case 'diagnostics-truncated':
    default:
      return 'fallback'
  }
}

export interface DiagnosticMark { readonly length: number; readonly truncated: boolean }

/** Provisional import decisions, finalized after the output representation is known. */
export class HtmlImportReportCollector {
  /**
   * Every diagnostic, with what it takes to put it in the order the page
   * promises: `at` is the document position of the LOSING ELEMENT and `seq`
   * the order this one was constructed in, which only ever breaks a tie.
   */
  private readonly entries: Array<{
    diagnostic: HtmlImportDiagnostic
    at: number
    seq: number
    /**
     * The element this row is ABOUT, and the row it becomes if that element
     * ends up preserved whole as raw HTML (markup-carve/carve-js#1468).
     *
     * Only `attrs()` fills these in, and only for an attribute it refused: a
     * refusal is a claim about what the OUTPUT lost, and the walk cannot know
     * yet whether the output keeps the element verbatim. Recording both
     * readings at the point that knows the attribute, and swapping at the point
     * that knows the outcome, is what keeps the two from drifting - the
     * alternative is a second copy of the wording next to every preserve arm.
     */
    owner?: P5Node
    refusal?: { subject: string; reason: string; live: boolean }
    /** Reported only if its element ends up kept raw (markup-carve/carve#2261). */
    latent?: boolean
  }> = []
  private latentCount = 0
  private capSuspended = false
  /** Whether the diagnostic cap turned a row away (carve-js#2034). */
  private truncated = false
  /** The report, in the order docs/html-import.md states. */
  get diagnostics(): HtmlImportDiagnostic[] {
    // An element's own row comes before its other rows, so a reader learns the
    // element is gone before its attributes are (carve-php#1737).
    const rank = (entry: { diagnostic: HtmlImportDiagnostic }) => (entry.diagnostic.code.startsWith('element-') ? 0 : 1)
    const rows = this.entries
      .filter((entry) => !entry.latent)
      .sort((a, b) => a.at - b.at || rank(a) - rank(b) || a.seq - b.seq)
      .map((entry) => entry.diagnostic)
    if (!this.truncated) return rows
    // LAST, and it REPLACES the row it stands behind: the marker reports the
    // state of the report rather than a loss at a place, so it has no element
    // to be ordered by, and replacing keeps the cap a bound on the rows a
    // reader gets. With a cap of zero there is no row to replace and the marker
    // is the whole report, a truncated report having to be able to say so.
    rows.pop()
    rows.push({
      code: 'diagnostics-truncated',
      message: 'HTML import diagnostics limit reached',
      severity: 'error',
      fidelity: diagnosticFidelity('diagnostics-truncated'),
      confidence: diagnosticConfidence('diagnostics-truncated'),
    })
    return rows
  }
  constructor(private readonly maxDiagnostics: number, private readonly positionOf: (node: P5Node) => number) {}

  mark(): DiagnosticMark { return { length: this.entries.length, truncated: this.truncated } }

  restore(mark: DiagnosticMark): void {
    this.entries.length = mark.length
    this.truncated = mark.truncated
    this.recountLatent()
  }

  discardWalk(before: DiagnosticMark, walked: DiagnosticMark): void {
    const after = this.entries.slice(walked.length)
    this.restore(before)
    for (const entry of after) {
      entry.seq = this.entries.length
      this.entries.push(entry)
    }
    this.recountLatent()
  }

  hasOwnedSince(mark: DiagnosticMark, node: P5Node): boolean {
    return this.entries.slice(mark.length).some((entry) => entry.owner === node)
  }

  ownLast(node: P5Node): void {
    const entry = this.entries.at(-1)
    if (entry) entry.owner = node
  }

  preserveOwner(node: P5Node): void {
    for (const entry of this.entries) {
      if (entry.owner === node && entry.diagnostic.code === 'style-unmapped') this.withhold(entry)
    }
    for (const entry of this.entries) {
      if (entry.owner === node && entry.refusal) this.preserveRow(entry, undefined)
    }
  }

  preserveDescendant(child: P5Node, kept: P5Node, inspect: () => void): void {
    const start = this.entries.length
    const suspended = this.capSuspended
    this.capSuspended = true
    try { inspect() } finally { this.capSuspended = suspended }
    const refused = this.entries.slice(start).filter((entry) => entry.owner === child && entry.refusal)
    this.entries.length = start
    for (const entry of refused) {
      entry.seq = this.entries.length
      entry.latent = true
      this.entries.push(entry)
    }
    this.recountLatent()
    for (const entry of refused) this.preserveRow(entry, kept)
  }
  add(
    code: HtmlImportDiagnosticCode,
    message: string,
    severity: HtmlImportDiagnostic['severity'],
    path: string,
    node: P5Node,
    fidelity = diagnosticFidelity(code),
  ): boolean {
    if (this.capReached()) return false
    this.entries.push({
      diagnostic: {
        code,
        message,
        severity,
        fidelity,
        confidence: diagnosticConfidence(code),
        path,
      },
      at: this.positionOf(node),
      seq: this.entries.length,
    })
    return true
  }

  /**
   * An attribute this importer will not write as a Carve attribute, reported
   * in BOTH of the readings the walk cannot yet choose between
   * (markup-carve/carve-js#1468).
   *
   * The row goes out as `attribute-dropped`, which is what it is for every
   * element the import rewrites. `keepRaw` turns it into
   * `attribute-preserved` where the element turned out to be kept whole, from
   * the same subject and the same reason - so the pair cannot say two
   * different things about one attribute.
   *
   * `live` is the half that decides severity, and it is the SAFETY test rather
   * than the old severity: an event handler, an injection sink or a value
   * carrying a denied scheme is in the output and executable, in a mode
   * `docs/html-import.md` calls unsafe for untrusted input. A dropped handler
   * already spends `warning`, so a preserved one spending `warning` too would
   * tell a filter nothing about which of the two it is looking at. `error` is
   * not a failed import here; it is the only level left that separates them.
   */
  refuseAttribute(
    node: P5Node,
    path: string,
    subject: string,
    reason: string,
    severity: HtmlImportDiagnostic['severity'],
    live: boolean,
  ): void {
    // No row means the cap turned this one away, and there is nothing to record
    // the preserve reading on.
    if (!this.add('attribute-dropped', `Dropped ${subject} on <${domTag(node)}>${reason}`, severity, path, node)) return
    const entry = this.entries[this.entries.length - 1]!
    entry.owner = node
    entry.refusal = { subject, reason, live }
  }

  /**
   * A value the renderer's URL sanitizer blanks. Kept or consumed on an element
   * the import rewrites, so it is only a row where the element is kept raw
   * (markup-carve/carve#2261).
   */
  refuseIfKept(node: P5Node, path: string, subject: string, live = true): void {
    this.entries.push({
      diagnostic: {
        code: 'attribute-dropped',
        message: '',
        severity: live ? 'error' : 'info',
        fidelity: diagnosticFidelity('attribute-dropped'),
        confidence: diagnosticConfidence('attribute-dropped'),
        path,
      },
      at: this.positionOf(node),
      seq: this.entries.length,
      owner: node,
      refusal: { subject, reason: '', live },
      latent: true,
    })
    this.latentCount++
  }

  /**
   * Hold a row out of the report without dropping the entry, for a row the
   * kept bytes supersede rather than contradict.
   */
  private withhold(entry: (typeof this.entries)[number]): void {
    if (entry.latent) return
    entry.latent = true
    this.latentCount++
  }

  /**
   * Whether the diagnostic cap has been reached, marking the report truncated
   * where it has.
   *
   * The cap bounds the REPORT, not the document: what it turns away is a row,
   * not a node, so refusing the conversion threw away a conversion that had
   * already succeeded. PART 9 lets a diagnostic cap replace its last entry with
   * the `diagnostics-truncated` row instead, which is what a consumer can act
   * on and what carve-rs writes (carve-js#2034). The depth and node caps stay
   * a refusal, the document itself being what they bound.
   */
  private capReached(): boolean {
    if (this.capSuspended) return false
    if (this.entries.length - this.latentCount < this.maxDiagnostics) return false
    this.truncated = true
    return true
  }

  private recountLatent(): void {
    this.latentCount = this.entries.filter((entry) => entry.latent).length
  }

  /** Restate a refusal row as what the kept bytes make it (markup-carve/carve-js#1468). */
  private preserveRow(entry: (typeof this.entries)[number], kept: P5Node | undefined): void {
    const { subject, reason, live } = entry.refusal!
    const where = kept ? `inside the raw HTML <${domTag(kept)}> is kept as` : 'in the raw HTML this element is kept as'
    // A latent row promoted past the cap stays latent, so it stays out of the
    // report and the marker below says a row was turned away.
    if (entry.latent) {
      if (this.capReached()) return
      entry.latent = false
      this.latentCount--
    }
    entry.diagnostic = {
      ...entry.diagnostic,
      code: 'attribute-preserved',
      fidelity: diagnosticFidelity('attribute-preserved'),
      confidence: diagnosticConfidence('attribute-preserved'),
      message: `Preserved ${subject} on <${domTag(entry.owner!)}> ${where}${reason}`,
      severity: live ? 'error' : 'info',
    }
  }

}
