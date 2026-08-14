import type { BlockNode, Document } from './ast.js'

/**
 * PART 11 §10f's operative test, computed once per render.
 *
 * The clause drops an abbreviation DEFINITION LINE on the plain-text and
 * terminal targets when that definition is consumed, and keeps it otherwise.
 * The test it states is NOT "is the term referenced":
 *
 *   THE TEST IS WHETHER THIS DEFINITION'S EXPANSION IS EMITTED, not whether
 *   its term appears. [...] the line goes because the content is emitted
 *   TWICE, and it is emitted twice only where the expansion is emitted.
 *
 * So this collects the `(term, expansion)` pairs the render will actually
 * expand, and the definition arms ask whether their own pair is among them.
 * Stating it that way settles all three of the clause's exempt shapes without
 * a branch for any of them, because in each one no matching pair is produced:
 *
 *   - the term never appears, which is §10a and unchanged;
 *   - an authored `abbr` outranks the definition (PART 9 §9), so the resolved
 *     `abbreviation` under that span contributes only its visible text and its
 *     expansion reaches no target - `45-inline-extensions-11`;
 *   - a later definition of the same term won (PART 9R R3, last wins), so of
 *     `*[A]: a` and `*[A]: b` only `b` is ever emitted. The pair carries the
 *     EXPANSION as well as the term precisely so those two are distinguished:
 *     `*[A]: b` goes and `*[A]: a` stays.
 *
 * The direction of any error here is not symmetric. Missing a pair keeps a
 * definition line that is also expanded, which duplicates words; inventing one
 * drops a line whose expansion is emitted nowhere, which deletes the author's
 * text outright and is the loss §10a exists to prevent. Where the two targets
 * differ, this errs toward keeping the line.
 */

/** The set key for one `(term, expansion)` pair. */
export function abbreviationPairKey(abbr: string, expansion: string): string {
  // NUL cannot occur in either half - the parser strips control characters
  // from both - so it separates them without a collision between, say,
  // `("A", "b c")` and `("A b", "c")`.
  return `${abbr}\u0000${expansion}`
}

/**
 * The node types on which an authored `abbr` attribute suppresses the
 * automatic expansion inside it.
 *
 * A PARAMETER rather than a constant, because the two targets do not agree.
 * `renderPlainText` honors an authored `abbr` on `emphasis`, `strong`,
 * `underline`, `superscript` and `span`; `renderAnsi` honors it on `span`
 * only. A union would be wrong for the terminal in the harmless direction and
 * an intersection wrong for plain in the harmful one, so each caller passes
 * what its own inline switch does.
 */
export type AuthoredAbbrCarriers = ReadonlySet<string>

/**
 * Every `(term, expansion)` pair `ast` will expand on a target whose authored
 * `abbr` carriers are `carriers`.
 *
 * Iterative rather than recursive on purpose. A renderer refuses a tree past
 * `MAX_RENDER_DEPTH` with a typed `RenderDepthError`; this pass runs BEFORE
 * that refusal, so a recursive walk would turn a documented refusal into a
 * stack overflow on exactly the trees the refusal is for. An explicit stack has
 * no such ceiling and needs no second bound to keep in step with the first.
 */
export function emittedAbbreviationExpansions(
  ast: Document,
  carriers: AuthoredAbbrCarriers,
): ReadonlySet<string> {
  const emitted = new Set<string>()
  const stack: { node: unknown; suppressed: boolean }[] = [
    { node: ast.children, suppressed: false },
  ]
  // The footnote definitions are rendered too, by `renderFootnoteDefs`, and
  // they hang off the document rather than off `children`.
  for (const blocks of Object.values(ast.footnoteDefs ?? {}) as BlockNode[][]) {
    stack.push({ node: blocks, suppressed: false })
  }

  while (stack.length > 0) {
    const frame = stack.pop()
    if (frame === undefined) break
    const { node, suppressed } = frame
    if (node === null || typeof node !== 'object') continue
    if (Array.isArray(node)) {
      for (const child of node) stack.push({ node: child, suppressed })
      continue
    }

    const record = node as Record<string, unknown>
    const type = record.type
    if (type === 'abbreviation') {
      // Suppressed by an enclosing authored `abbr`: the span emits its own
      // value and this expansion reaches no target, so it makes no pair.
      if (suppressed) continue
      const { abbr, expansion } = record
      if (typeof abbr === 'string' && typeof expansion === 'string') {
        emitted.add(abbreviationPairKey(abbr, expansion))
      }
      // An abbreviation is a leaf: it has no children to descend into.
      continue
    }

    let childSuppressed = suppressed
    if (typeof type === 'string' && carriers.has(type) && authoredAbbrOf(record) !== undefined) {
      childSuppressed = true
    }
    for (const [key, value] of Object.entries(record)) {
      // `attrs` holds strings, and `pos` holds numbers. Neither can contain a
      // node, and skipping them keeps the walk off the authored `abbr` value
      // that was just read above.
      if (key === 'type' || key === 'attrs' || key === 'pos') continue
      stack.push({ node: value, suppressed: childSuppressed })
    }
  }

  return emitted
}

/** The authored `abbr` attribute on a node, if it carries one. */
function authoredAbbrOf(record: Record<string, unknown>): string | undefined {
  const attrs = record.attrs
  if (attrs === null || typeof attrs !== 'object') return undefined
  const keyValues = (attrs as Record<string, unknown>).keyValues
  if (keyValues === null || typeof keyValues !== 'object') return undefined
  const value = (keyValues as Record<string, unknown>).abbr
  return typeof value === 'string' ? value : undefined
}
