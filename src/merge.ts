/** Conservative three-way merge over the normative PART 12 AST shape. */

import type { AstJsonDocument } from './ast-json.js'

export interface MergeConflict {
  /** JSON Pointer into the exchange tree. */
  path: string
  reason: 'both-changed' | 'delete-edit' | 'concurrent-sequence-edit'
  base: unknown
  ours: unknown
  theirs: unknown
}

export type MergeResult =
  | { ok: true; ast: AstJsonDocument; conflicts: [] }
  | { ok: false; ast: null; conflicts: MergeConflict[] }

const MISSING = Symbol('missing')
type Value = unknown | typeof MISSING

function pointer(path: string, key: string | number): string {
  const part = String(key).replaceAll('~', '~0').replaceAll('/', '~1')
  return `${path}/${part}`
}

function semantic(value: Value): unknown {
  if (value === MISSING) return MISSING
  if (Array.isArray(value)) return value.map(semantic)
  if (typeof value !== 'object' || value === null) return value
  const out = Object.create(null) as Record<string, unknown>
  for (const [key, child] of Object.entries(value)) {
    if (key === 'pos' || key === 'srcByteLength') continue
    out[key] = semantic(child)
  }
  return out
}

function equal(a: Value, b: Value): boolean {
  if (a === MISSING || b === MISSING) return a === b
  return JSON.stringify(semantic(a)) === JSON.stringify(semantic(b))
}

function conflictValue(value: Value): unknown {
  return value === MISSING ? null : value
}

function mergeValue(
  base: Value,
  ours: Value,
  theirs: Value,
  path: string,
  conflicts: MergeConflict[],
): Value {
  if (equal(ours, theirs)) return ours
  if (equal(ours, base)) return theirs
  if (equal(theirs, base)) return ours

  if (ours === MISSING || theirs === MISSING) {
    conflicts.push({
      path: path || '/',
      reason: 'delete-edit',
      base: conflictValue(base),
      ours: conflictValue(ours),
      theirs: conflictValue(theirs),
    })
    return MISSING
  }

  if (Array.isArray(base) && Array.isArray(ours) && Array.isArray(theirs)) {
    // Equal-length lists retain stable node identity by index and permit edits
    // to different descendants. Concurrent insertion/deletion/reordering needs
    // an identity policy; refusing it is safer than silently pairing the wrong
    // paragraphs. A later move-aware sequence layer can narrow this conflict.
    if (base.length !== ours.length || base.length !== theirs.length) {
      conflicts.push({
        path: path || '/',
        reason: 'concurrent-sequence-edit',
        base,
        ours,
        theirs,
      })
      return MISSING
    }
    return base.map((item, index) =>
      mergeValue(item, ours[index], theirs[index], pointer(path, index), conflicts),
    )
  }

  const objects = [base, ours, theirs].every(
    (value) => typeof value === 'object' && value !== null && !Array.isArray(value),
  )
  if (objects) {
    const b = base as Record<string, unknown>
    const o = ours as Record<string, unknown>
    const t = theirs as Record<string, unknown>
    const out = Object.create(null) as Record<string, unknown>
    for (const key of new Set([...Object.keys(b), ...Object.keys(o), ...Object.keys(t)])) {
      if (key === 'pos' || key === 'srcByteLength') continue
      const value = mergeValue(
        Object.hasOwn(b, key) ? b[key] : MISSING,
        Object.hasOwn(o, key) ? o[key] : MISSING,
        Object.hasOwn(t, key) ? t[key] : MISSING,
        pointer(path, key),
        conflicts,
      )
      if (value !== MISSING) out[key] = value
    }
    return out
  }

  conflicts.push({
    path: path || '/',
    reason: 'both-changed',
    base: conflictValue(base),
    ours: conflictValue(ours),
    theirs: conflictValue(theirs),
  })
  return MISSING
}

/**
 * Merge two revisions made from `base`.
 *
 * The function never chooses a winner for an ambiguous edit. It either returns
 * one position-free exchange tree or an explicit list of conflicts. Position
 * metadata is deliberately omitted because offsets from either input would be
 * false after combining the trees; `srcByteLength` is zero for the same reason
 * and is re-established when the merged tree is serialized to source.
 */
export function mergeAst(
  base: AstJsonDocument,
  ours: AstJsonDocument,
  theirs: AstJsonDocument,
): MergeResult {
  const conflicts: MergeConflict[] = []
  const merged = mergeValue(base, ours, theirs, '', conflicts)
  if (conflicts.length > 0 || merged === MISSING) return { ok: false, ast: null, conflicts }
  const ast = semantic(merged) as AstJsonDocument
  ast.srcByteLength = 0
  return { ok: true, ast, conflicts: [] }
}
