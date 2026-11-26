// What the snippet pass leaves beside the render view for resolution and the renderer (C2-N-092, C2-N-094, C2-H-215).
import { type DocumentNode, type IncludeNode, type Node } from './ast.ts'

/** C2-H-215: what the carriers of one expanded use say. */
export interface SnippetCarrier {
  n: number
  mode: 'inline' | 'block'
  name: string
  include: boolean
  /** The element is a span the use adds only for the carriers. */
  carrierOnly: boolean
}

/** The state of the derived-text budget after the pass, which the renderer goes on from (C2-N-094). */
export interface SnippetBudget {
  budget: number
  left: number
  reported: boolean
}

/** The root nodes of each copy, with the include of its definition (C2-N-092), for resolution. */
export const COPY_SCOPE = new WeakMap<Node, IncludeNode | null>()
/** The element of each expanded use that carries its roundtrip carriers. */
export const SNIPPET_CARRIERS = new WeakMap<Node, SnippetCarrier>()
/** C2-H-215: the `N` of the innermost expanded use around each copied note reference. */
export const SNIPPET_MARKS = new WeakMap<Node, number>()
/** The budget each expanded document left. */
export const SNIPPET_BUDGETS = new WeakMap<DocumentNode, SnippetBudget>()
/** The definitions of each registry, so a later view can tell a transform's definition from an authored one. */
export const SNIPPET_DEFINITIONS = new WeakMap<DocumentNode, string[]>()

