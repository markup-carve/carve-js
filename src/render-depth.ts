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
