// Ancestor lookups by JSON path for the hand-written rules, memoized per lint run. A rule asks one per line or
// node, and a walk that slices the path once per step costs depth² characters each time: a document nested to the
// block depth cap took seconds to lint at 40 KB.
import { type LintContext } from './types.ts'

const caches = new WeakMap<LintContext, Map<string, Map<string, unknown>>>()

function memo<T>(context: LintContext, kind: string, path: string, compute: () => T): T {
  let byKind = caches.get(context)
  if (byKind === undefined) caches.set(context, byKind = new Map<string, Map<string, unknown>>())
  let cache = byKind.get(kind)
  if (cache === undefined) byKind.set(kind, cache = new Map<string, unknown>())
  if (cache.has(path)) return cache.get(path) as T
  const value = compute()
  cache.set(path, value)
  return value
}

function parentOf(path: string): string | undefined {
  const split = path.lastIndexOf('/children/')
  return split < 0 ? undefined : path.slice(0, split)
}

/** The nearest path at or above `path`, by `/children/` steps and short of the document, whose node has `type`. */
export function ancestorOf(path: string, context: LintContext, type: string): string | undefined {
  if (path === '') return undefined
  return memo(context, `a:${type}`, path, () => {
    if (context.nodeTypes.get(path) === type) return path
    const parent = parentOf(path)
    return parent === undefined ? undefined : ancestorOf(parent, context, type)
  })
}

/** Whether a node strictly above `path`, by `/children/` steps, has `type`. */
export function hasAncestor(path: string, context: LintContext, type: string): boolean {
  const parent = parentOf(path)
  return parent !== undefined && ancestorOf(parent, context, type) !== undefined
}

/** The block quotes at or above `path`, by `/children/` steps. */
export function quoteDepth(path: string, context: LintContext): number {
  return memo(context, 'q', path, () => {
    const own = context.nodeTypes.get(path) === 'block_quote' ? 1 : 0
    const parent = parentOf(path)
    return own + (parent === undefined ? 0 : quoteDepth(parent, context))
  })
}

/** The block quotes strictly above `path`, by `/children/` steps. */
export function quotesAbove(path: string, context: LintContext): number {
  const parent = parentOf(path)
  return parent === undefined ? 0 : quoteDepth(parent, context)
}

/** The first value `pick` gives for a path at or above `path` by `/` steps, or `fallback` at the root. */
export function nearestBySegment(path: string, context: LintContext, kind: string,
  pick: (type: string | undefined) => string | undefined, fallback: string): string {
  if (path === '') return fallback
  return memo(context, `s:${kind}`, path, () =>
    pick(context.nodeTypes.get(path)) ?? nearestBySegment(path.slice(0, path.lastIndexOf('/')), context, kind, pick, fallback))
}
