import { MAX_NESTING_DEPTH } from './parse.js'

/**
 * Deepest nesting a renderer walks before it refuses.
 *
 * §25 states the bound as a property, not a number: a recursive render pass
 * over a programmatically constructed tree MUST be bounded, and its ceiling
 * MUST NOT be reachable by a tree the SAME implementation's parser produces. A
 * parsed tree is deeper than the containers that produced it - the paragraph
 * inside the innermost container is one level further down - so a ceiling EQUAL
 * to `MAX_NESTING_DEPTH` truncates a document the parser has just accepted.
 * The margin covers the blocks a container subtree adds (carve#517).
 *
 * Shared by all five renderers so the ceiling cannot drift between them, and so
 * `RenderDepthError` names one number.
 */
export const MAX_RENDER_DEPTH = MAX_NESTING_DEPTH + 32

/**
 * Thrown when a render pass reaches `MAX_RENDER_DEPTH`.
 *
 * §25: AT THE RENDER CEILING, A RENDERER REFUSES. Reaching it must produce a
 * typed, documented failure naming the depth bound - not silent truncation, not
 * a partial document, and not whatever the host raises when the stack runs out.
 * This is PART 12 §9(b) applied to the other end of the same pipe: "an ingest
 * that accepts a tree and then silently renders only part of it is the worst of
 * the three, because the caller is told nothing" is a statement about the
 * CALLER, and a renderer that returns a truncated string tells the caller
 * exactly as little.
 *
 * Truncation is not the safe default it looks like. The PARSE path degrades
 * VISIBLY - an over-cap opener becomes literal text the reader can see - while
 * a renderer that stops emitting produces a document that looks complete and is
 * not. Four of the five renderers here used to emit the nested markers and
 * delete only the body; `renderCarve` is the canonical writer, so a tree built
 * through the API came back with its body gone and nothing in the return value
 * to say so.
 *
 * Refusing costs nothing on any path a document travels: the ceiling exceeds
 * `MAX_NESTING_DEPTH` by construction, so no tree from `parse` can reach it,
 * and `fromAstJson` already refuses a deeper ingested tree. What is left is a
 * tree built through the API, where the caller built it and can act on the
 * error. (carve#526, carve#548)
 */
export class RenderDepthError extends Error {
  constructor(
    readonly renderer: string,
    readonly depth: number,
  ) {
    super(`${renderer}: tree nests ${depth} levels or deeper, past the render cap of ${MAX_RENDER_DEPTH}`)
    this.name = 'RenderDepthError'
  }
}
