import type { BlockNode, Document } from './ast.js'

/**
 * PART 11 §10f's operative test, and how the two targets that answer it get an
 * answer that is true of the render rather than of the tree.
 *
 * The clause drops an abbreviation DEFINITION LINE on the plain-text and
 * terminal targets when that definition is consumed, and keeps it otherwise.
 * The test it states is NOT "is the term referenced":
 *
 *   THE TEST IS WHETHER THIS DEFINITION'S EXPANSION IS EMITTED, not whether
 *   its term appears. [...] the line goes because the content is emitted
 *   TWICE, and it is emitted twice only where the expansion is emitted.
 *
 * The definition lines come BEFORE the occurrences that would answer that, so
 * the answer has to exist before the output does. Each of those two renderers
 * therefore RENDERS THE DOCUMENT TWICE when it holds a definition at all: the
 * first pass throws its string away and keeps the `(term, expansion)` pairs it
 * actually emitted, the second pass renders for real and drops the definitions
 * whose pair is among them. `documentHasAbbreviationDef` gates that, so a
 * document without a definition - which is nearly all of them - pays nothing.
 *
 * A STRUCTURAL WALK OVER THE TREE WAS TRIED FIRST AND IS WRONG, in the
 * direction that deletes text. It has to predict the renderer, and it mispredicts
 * it in at least two ways that both end with an expansion emitted nowhere and its
 * definition line dropped anyway:
 *
 *   - A BRANCH THAT SKIPS ITS CHILDREN. An unresolved reference link renders
 *     as its raw source (PART 12 §3a), so the `abbreviation` under it is never
 *     reached. `*[HTML]: Hyper Text` over `[HTML][missing]` came out as
 *     `[HTML][missing]` alone, with `Hyper Text` nowhere in the document. Every
 *     such branch would have had to be mirrored, and mirrored again whenever one
 *     is added.
 *
 *   - THE EXPANSION BUDGET. An occurrence degrades to the bare key once
 *     cumulative expansion bytes pass the per-render bound (see abbr-budget.ts),
 *     and that bound is shared with cross-reference labels. A structural walk
 *     cannot see it without re-implementing the charge order of both.
 *
 * Rendering twice answers both exactly rather than approximately, because the
 * first pass IS the renderer. The two passes charge the budget identically: the
 * only thing that differs between them is whether a definition line is written,
 * and writing that line charges nothing.
 *
 * The direction of an error here is not symmetric, which is why "exactly" is
 * worth two passes. Missing a pair keeps a definition line whose words are also
 * expanded, which duplicates them; inventing one drops a line whose expansion is
 * emitted nowhere, which deletes the author's text and is the loss §10a exists to
 * prevent.
 */

/** The set key for one `(term, expansion)` pair. */
export function abbreviationPairKey(abbr: string, expansion: string): string {
  // NUL cannot occur in either half - the parser strips control characters
  // from both - so it separates them without a collision between, say,
  // `("A", "b c")` and `("A b", "c")`.
  //
  // The pair, not the term: under PART 9R R3 (last wins) `*[A]: a` and
  // `*[A]: b` are one term and two definitions, only one of which is emitted.
  // Keying by the term alone would drop both lines and delete the string `a`
  // from the document, which §10f considered and rejected for that reason.
  return `${abbr}\u0000${expansion}`
}

/**
 * Whether `ast` holds an abbreviation definition anywhere.
 *
 * The gate on the second render pass, so the cost of §10f falls only on
 * documents that have a definition to decide about.
 *
 * Iterative rather than recursive. A renderer refuses a tree past
 * `MAX_RENDER_DEPTH` with a typed `RenderDepthError`; this runs BEFORE that
 * refusal, so a recursive walk would turn a documented refusal into a stack
 * overflow on exactly the trees the refusal exists for.
 */
export function documentHasAbbreviationDef(ast: Document): boolean {
  const stack: unknown[] = [ast.children]
  for (const blocks of Object.values(ast.footnoteDefs ?? {}) as BlockNode[][]) {
    stack.push(blocks)
  }

  while (stack.length > 0) {
    const node = stack.pop()
    if (node === null || typeof node !== 'object') continue
    if (Array.isArray(node)) {
      for (const child of node) stack.push(child)
      continue
    }
    const record = node as Record<string, unknown>
    if (record.type === 'abbreviation_def') return true
    for (const [key, value] of Object.entries(record)) {
      // `attrs` holds strings and `pos` holds numbers; neither can contain a
      // node, and a definition is a block in any case.
      if (key === 'type' || key === 'attrs' || key === 'pos') continue
      stack.push(value)
    }
  }

  return false
}
