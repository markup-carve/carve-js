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


function carryNode(from: Node, to: Node): void {
  const carrier = SNIPPET_CARRIERS.get(from)
  if (carrier !== undefined) SNIPPET_CARRIERS.set(to, carrier)
  const mark = SNIPPET_MARKS.get(from)
  if (mark !== undefined) SNIPPET_MARKS.set(to, mark)
  if (COPY_SCOPE.has(from)) COPY_SCOPE.set(to, COPY_SCOPE.get(from)!)
}

/**
 * Carries the side tables of an expanded view onto `copy`, a clone of it of the same shape, so the nodes a document
 * transform keeps still carry their snippet carriers and note marks (C2-H-215).
 */
export function carrySnippetMarks(view: DocumentNode, copy: DocumentNode): void {
  const budget = SNIPPET_BUDGETS.get(view)
  if (budget === undefined) return
  SNIPPET_BUDGETS.set(copy, budget)
  const pending: [unknown, unknown][] = [[view, copy]]
  for (let pair = pending.pop(); pair !== undefined; pair = pending.pop()) {
    const [from, to] = pair
    if (typeof from !== 'object' || from === null || typeof to !== 'object' || to === null) continue
    if (Array.isArray(from)) {
      for (let at = 0; at < from.length; at++) pending.push([from[at], (to as unknown[])[at]])
      continue
    }
    carryNode(from as Node, to as Node)
    for (const key of Object.keys(from)) pending.push([(from as Record<string, unknown>)[key], (to as Record<string, unknown>)[key]])
  }
}

/** The budget the copies of `from` left, for `to`, a new root a transform returned. */
export function carrySnippetBudget(from: DocumentNode, to: DocumentNode): void {
  const budget = SNIPPET_BUDGETS.get(from)
  if (budget !== undefined && !SNIPPET_BUDGETS.has(to)) SNIPPET_BUDGETS.set(to, budget)
}
