/**
 * Picking a run of in-band markers a document cannot collide with.
 */

/**
 * The pool every run is taken from: the BMP private-use area, minus its first
 * code point. U+E000 is the parser's nbsp marker (see above), so it is never
 * allocatable no matter what the document contains.
 */
const ALLOCATABLE_START = 0xe001
const PRIVATE_USE_END = 0xf8ff

/**
 * Which private-use code points a tree's strings occupy.
 *
 * A SET rather than the joined text. Joining was the obvious spelling and it
 * does not survive contact with the documents §25 exists for: one string per
 * node, concatenated, is a second copy of the whole document, and a document
 * near the engine's own byte budget puts that copy past V8's maximum string
 * length - a `RangeError` thrown out of a renderer that was about to refuse the
 * input for its size anyway. The set is bounded by the private-use area, so it
 * costs one pass and at most 6400 entries however large the tree is.
 *
 * ITERATIVE on purpose: `JSON.stringify` would be one line, and it recurses - so
 * on an AST deeper than the JS stack it throws a RangeError before a writer can
 * reach its own §25 depth REFUSAL, which is a documented behaviour with tests on
 * it. An explicit stack has no such limit.
 */
export function occupiedPrivateUse(root: unknown): Set<number> {
  const occupied = new Set<number>()
  const stack: unknown[] = [root]
  while (stack.length > 0) {
    const node = stack.pop()
    if (typeof node === 'string') {
      for (let i = 0; i < node.length; i++) {
        const code = node.charCodeAt(i)
        if (code >= ALLOCATABLE_START && code <= PRIVATE_USE_END) occupied.add(code)
      }
      continue
    }
    if (node === null || typeof node !== 'object') continue
    if (Array.isArray(node)) {
      for (const item of node) stack.push(item)
      continue
    }
    for (const value of Object.values(node)) stack.push(value)
  }

  return occupied
}

/** The `length` code points starting at `base`, one per slot. */
function runFrom(base: number, length: number): string[] {
  const run: string[] = []
  for (let i = 0; i < length; i++) run.push(String.fromCharCode(base + i))
  return run
}

/**
 * `length` private-use code points, none of them in `occupied`.
 *
 * The preferred run is tried first: the common case is a document with no
 * private-use characters at all, and it should not pay for a scan. When any of
 * the preferred code points IS taken the scan walks the private-use area ONE
 * code point at a time, so a document that occupies every sixth character still
 * finds one of the runs between them - stepping a whole run at a time would
 * declare the area full while most of it was free.
 *
 * The last resort is the preferred run again rather than a throw. It needs the
 * whole private-use area occupied, and a writer that refuses to render is worse
 * than one that falls back to the behaviour it had before the run was picked at
 * all.
 */
export function pickSentinelRun(occupied: Set<number>, base: number, length: number): string[] {
  const taken = (from: number): boolean => {
    for (let i = 0; i < length; i++) if (occupied.has(from + i)) return true
    return false
  }

  if (!taken(base)) return runFrom(base, length)

  let start = ALLOCATABLE_START
  while (start + length - 1 <= PRIVATE_USE_END) {
    let i = 0
    while (i < length && !occupied.has(start + i)) i++
    // Every code point from `start` was free, so the run is.
    if (i === length) return runFrom(start, length)
    // `start + i` is occupied, so no run containing it can be taken: resume past
    // it rather than one code point on.
    start = start + i + 1
  }

  return runFrom(base, length)
}
