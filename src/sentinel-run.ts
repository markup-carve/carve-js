/**
 * Allocate private-use markers absent from the document. Writers and converters
 * use temporary markers whose authored equivalents would otherwise collide.
 * Each caller owns its run and slot meanings.
 *
 * U+E000 is reserved for the parser's non-breaking-space marker.
 */
const ALLOCATABLE_START = 0xe001
const PRIVATE_USE_END = 0xf8ff

/** Collect occupied points with a bounded set and an iterative tree walk.
 * Joining all strings can exceed V8's string limit; recursive traversal can
 * throw before the documented depth refusal. Shared subtrees are visited once.
 */
export function occupiedPrivateUse(root: unknown, includeKeys = false): Set<number> {
  const occupied = new Set<number>()
  const seenKeys = includeKeys ? new Set<string>() : undefined
  const visited = new WeakSet<object>()
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
    if (visited.has(node)) continue
    visited.add(node)
    if (Array.isArray(node)) {
      for (const item of node) stack.push(item)
      continue
    }
    for (const key in node) {
      if (!Object.prototype.hasOwnProperty.call(node, key)) continue
      if (seenKeys !== undefined && !seenKeys.has(key)) {
        seenKeys.add(key)
        if (/[\ue001-\uf8ff]/.test(key)) stack.push(key)
      }
      stack.push((node as Record<string, unknown>)[key])
    }
  }

  return occupied
}

/** The `length` code points starting at `base`, one per slot. */
function runFrom(base: number, length: number): string[] {
  const run: string[] = []
  for (let i = 0; i < length; i++) run.push(String.fromCharCode(base + i))
  return run
}

/** Pick an unused run, trying `base` first and then scanning the pool.
 * If none exists, retain the old fallback instead of refusing to render.
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
    if (i === length) return runFrom(start, length)
    // Every start from `start` through the occupied point would contain it.
    start = start + i + 1
  }

  return runFrom(base, length)
}

export function collectSentinelNonces(text: string, nonces: Set<number>): void {
  for (const match of text.matchAll(/\ue009m([0-9]{1,16})x[0-9]+\ue00a/g)) {
    const nonce = Number(match[1])
    if (Number.isSafeInteger(nonce)) nonces.add(nonce)
  }
}

export function shortSentinelTokens(nonces: Set<number>, length: number): string[] {
  let nonce = 0
  while (nonces.has(nonce)) nonce++
  return Array.from({ length }, (_, slot) => `\ue009m${nonce}x${slot}\ue00a`)
}

export function treeSentinelNonces(root: unknown): Set<number> {
  const nonces = new Set<number>()
  const seen = new WeakSet<object>()
  const stack: unknown[] = [root]
  while (stack.length > 0) {
    const value = stack.pop()
    if (typeof value === 'string') collectSentinelNonces(value, nonces)
    else if (value !== null && typeof value === 'object' && !seen.has(value)) {
      seen.add(value)
      if (Array.isArray(value)) {
        for (const child of value) stack.push(child)
      } else {
        for (const [key, child] of Object.entries(value)) stack.push(key, child)
      }
    }
  }
  return nonces
}
