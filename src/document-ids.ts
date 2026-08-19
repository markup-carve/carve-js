import type { Document } from './ast.js'

/**
 * Document id namespace shared by explicit `{#id}` attributes, generated
 * heading ids, and extension-generated ids (tabs, code groups, citations).
 *
 * Spec: extensions contract §2.6 — extension-generated ids MUST be
 * deduplicated against explicit and heading ids with the same next-free-suffix
 * mechanism headings use. Mirrors carve-php's HeadingIdTracker::uniqueId().
 */
export class DocumentIdRegistry {
  /** id -> next 1-based suffix candidate (mirrors carve-php usedIds). */
  private usedIds = new Map<string, number>()

  /** Reserve an id verbatim (explicit attribute or already-assigned id). */
  reserve(id: string): void {
    if (id !== '' && !this.usedIds.has(id)) this.usedIds.set(id, 1)
  }

  /**
   * Reserve `baseId` in the namespace, or the next free numeric suffix
   * (`baseId-2`, `-3`, ...) when taken — skipping candidates already reserved
   * by explicit attributes or previously generated ids.
   */
  uniqueId(baseId: string): string {
    if (!this.usedIds.has(baseId)) {
      this.usedIds.set(baseId, 1)
      return baseId
    }
    let n = this.usedIds.get(baseId)!
    let candidate: string
    do {
      n++
      candidate = `${baseId}-${n}`
    } while (this.usedIds.has(candidate))
    this.usedIds.set(baseId, n)
    this.usedIds.set(candidate, 1)
    return candidate
  }
}

/**
 * Seed a registry with every id already present in the resolved AST: explicit
 * `{#id}` attributes anywhere plus the heading ids assigned by
 * resolveHeadingIds. A generic deep walk keeps this exhaustive as node kinds
 * grow — the AST is a finite tree, and non-node leaves are cheap to skip.
 */
export function collectDocumentIds(doc: Document): DocumentIdRegistry {
  const registry = new DocumentIdRegistry()
  // Walked with an EXPLICIT STACK rather than by recursion. §25 requires a
  // recursive resolve pass over a programmatically built tree to be bounded,
  // and a generic walk like this one cannot use the renderers' block-depth
  // ceiling honestly: it descends through arrays and wrapper objects too, so a
  // frame budget of MAX_RENDER_DEPTH would refuse a list the parser itself
  // produces at a quarter of the cap. An explicit stack has no frame budget to
  // exceed, so the pass is bounded by memory alone and never crashes ahead of
  // the renderer's own ceiling (carve#526).
  const stack: unknown[] = [doc]
  while (stack.length > 0) {
    const value = stack.pop()
    if (Array.isArray(value)) {
      for (const v of value) stack.push(v)
      continue
    }
    if (value === null || typeof value !== 'object') continue
    const attrs = (value as { attrs?: { id?: unknown } }).attrs
    if (attrs && typeof attrs.id === 'string') registry.reserve(attrs.id)
    // `attrs` was consumed above and `pos` contains only numeric source
    // metadata. Avoid enumerating/pushing either: together they account for a
    // large fraction of the short-lived objects on an ordinary resolved AST.
    for (const key in value as Record<string, unknown>) {
      if (key === 'attrs' || key === 'pos') continue
      const v = (value as Record<string, unknown>)[key]
      if (v !== null && typeof v === 'object') stack.push(v)
    }
  }
  return registry
}
