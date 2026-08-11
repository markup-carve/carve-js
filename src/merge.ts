/** Conservative three-way merge over the normative PART 12 AST shape. */

import type { AstJsonDocument } from './ast-json.js'
import { fromAstJson } from './ast-json.js'
import { NODE_POSITION_KIND } from './wire-fields.js'

export interface MergeConflict {
  /** Base-relative JSON Pointer into the exchange tree (the root is the empty string). */
  path: string
  reason: 'both-changed' | 'delete-edit' | 'concurrent-sequence-edit'
  base: unknown
  ours: unknown
  theirs: unknown
  deleted?: { base: boolean; ours: boolean; theirs: boolean }
}

export type MergeResolution = 'base' | 'ours' | 'theirs' | { value: unknown }

export interface MergeOptions {
  /** Resolve selected conflicts while merging; an undefined answer leaves one unresolved. */
  resolve?: (conflict: MergeConflict) => MergeResolution | undefined
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

function childIsNode(type: unknown, field: string): boolean {
  return typeof type === 'string' && Object.hasOwn(NODE_POSITION_KIND, `${type}.${field}`)
}

function semantic(value: Value, nodePosition = true): unknown {
  if (value === MISSING) return MISSING
  if (Array.isArray(value)) return value.map((child) => semantic(child, nodePosition))
  if (typeof value !== 'object' || value === null) return value
  const record = value as Record<string, unknown>
  const out = Object.create(null) as Record<string, unknown>
  for (const key of Object.keys(value).sort()) {
    if (nodePosition && (key === 'pos' || key === 'srcByteLength')) continue
    const child = record[key]
    out[key] = semantic(child, childIsNode(record.type, key))
  }
  return out
}

function equal(a: Value, b: Value, nodePosition = true): boolean {
  if (a === MISSING || b === MISSING) return a === b
  return JSON.stringify(semantic(a, nodePosition)) === JSON.stringify(semantic(b, nodePosition))
}

function semanticKey(value: unknown, nodePosition: boolean): string {
  return JSON.stringify(semantic(value, nodePosition))
}

function conflictValue(value: Value): unknown {
  return value === MISSING ? null : value
}

function conflict(
  reason: MergeConflict['reason'],
  path: string,
  base: Value,
  ours: Value,
  theirs: Value,
  conflicts: MergeConflict[],
  options: MergeOptions,
): Value {
  const item: MergeConflict = {
    path,
    reason,
    base: conflictValue(base),
    ours: conflictValue(ours),
    theirs: conflictValue(theirs),
  }
  if ([base, ours, theirs].includes(MISSING)) {
    item.deleted = {
      base: base === MISSING,
      ours: ours === MISSING,
      theirs: theirs === MISSING,
    }
  }
  const resolution = options.resolve?.(item)
  if (resolution === undefined) {
    conflicts.push(item)
    return MISSING
  }
  if (typeof resolution === 'object' && resolution !== null && Object.hasOwn(resolution, 'value')) {
    if (resolution.value === undefined) throw new TypeError('merge resolution value cannot be undefined')
    return resolution.value
  }
  if (resolution === 'base') return base
  if (resolution === 'ours') return ours
  if (resolution === 'theirs') return theirs
  throw new TypeError('merge resolver must return base, ours, theirs, { value }, or undefined')
}

interface SideMatch {
  baseToSide: Map<number, number>
  sideToBase: Map<number, number>
  additions: number[]
}

function kind(value: unknown): string {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    const type = (value as { type?: unknown }).type
    if (typeof type === 'string') return `node:${type}`
  }
  return Array.isArray(value) ? 'array' : typeof value
}

function identityHint(value: unknown): string | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const node = value as Record<string, unknown>
  if (typeof node['type'] !== 'string') return undefined
  for (const field of ['label', 'ref', 'name'] as const) {
    if (typeof node[field] === 'string') return `${node['type']}:${field}:${node[field]}`
  }
  const attrs = node['attrs']
  if (typeof attrs === 'object' && attrs !== null && !Array.isArray(attrs)) {
    const id = (attrs as Record<string, unknown>)['id']
    if (typeof id === 'string') return `${node['type']}:attrs.id:${id}`
  }
  return undefined
}

/**
 * Match base elements to one revision without assuming they stayed in place.
 * Exact values are paired first (including duplicate occurrences), then a
 * unique remaining node kind, then an LCS of kinds. The last two passes are
 * what recognize a moved node whose content was edited on that side.
 */
function matchSide(base: unknown[], side: unknown[], nodePosition: boolean): SideMatch {
  const baseToSide = new Map<number, number>()
  const sideToBase = new Map<number, number>()
  const take = (baseIndex: number, sideIndex: number): void => {
    baseToSide.set(baseIndex, sideIndex)
    sideToBase.set(sideIndex, baseIndex)
  }

  const exact = new Map<string, number[]>()
  side.forEach((value, index) => {
    const key = semanticKey(value, nodePosition)
    const queue = exact.get(key) ?? []
    queue.push(index)
    exact.set(key, queue)
  })
  for (let i = 0; i < base.length; i++) {
    const queue = exact.get(semanticKey(base[i], nodePosition))
    const j = queue?.shift()
    if (j !== undefined) take(i, j)
  }

  const remainingBase = (): number[] => base.map((_, i) => i).filter((i) => !baseToSide.has(i))
  const remainingSide = (): number[] => side.map((_, i) => i).filter((i) => !sideToBase.has(i))
  const sideHints = new Map<string, number[]>()
  const baseHints = new Map<string, number[]>()
  remainingBase().forEach((index) => {
    const hint = identityHint(base[index])
    if (hint === undefined) return
    const indexes = baseHints.get(hint) ?? []
    indexes.push(index)
    baseHints.set(hint, indexes)
  })
  remainingSide().forEach((index) => {
    const hint = identityHint(side[index])
    if (hint === undefined) return
    const indexes = sideHints.get(hint) ?? []
    indexes.push(index)
    sideHints.set(hint, indexes)
  })
  for (const baseIndex of remainingBase()) {
    const hint = identityHint(base[baseIndex])
    if (hint === undefined) continue
    const sideIndexes = sideHints.get(hint)
    if (
      baseHints.get(hint)?.length === 1 &&
      sideIndexes?.length === 1 &&
      !sideToBase.has(sideIndexes[0]!)
    ) take(baseIndex, sideIndexes[0]!)
  }
  const kinds = new Set(remainingBase().map((i) => kind(base[i])))
  for (const valueKind of kinds) {
    const bs = remainingBase().filter((i) => kind(base[i]) === valueKind)
    const ss = remainingSide().filter((i) => kind(side[i]) === valueKind)
    if (bs.length === 1 && ss.length === 1) take(bs[0]!, ss[0]!)
  }

  const bs = remainingBase()
  const ss = remainingSide()
  if (bs.length * ss.length > 1_000_000) {
    // The DP below is quadratic in sibling count. Past this guard, pair the
    // remaining kinds monotonically. Exact values and all unique kinds have
    // already been removed, so this fallback cannot hide an exact move; an
    // ambiguous mass edit gets conservative index-like pairing in linear time.
    let sideCursor = 0
    for (const baseIndex of bs) {
      while (sideCursor < ss.length && kind(base[baseIndex]) !== kind(side[ss[sideCursor]!])) {
        sideCursor++
      }
      if (sideCursor >= ss.length) break
      take(baseIndex, ss[sideCursor]!)
      sideCursor++
    }
    return {
      baseToSide,
      sideToBase,
      additions: side.map((_, index) => index).filter((index) => !sideToBase.has(index)),
    }
  }
  const table: number[][] = Array.from({ length: bs.length + 1 }, () =>
    new Array<number>(ss.length + 1).fill(0),
  )
  for (let i = bs.length - 1; i >= 0; i--) {
    for (let j = ss.length - 1; j >= 0; j--) {
      table[i]![j] =
        kind(base[bs[i]!]) === kind(side[ss[j]!])
          ? table[i + 1]![j + 1]! + 1
          : Math.max(table[i + 1]![j]!, table[i]![j + 1]!)
    }
  }
  let i = 0
  let j = 0
  while (i < bs.length && j < ss.length) {
    if (kind(base[bs[i]!]) === kind(side[ss[j]!])) {
      take(bs[i]!, ss[j]!)
      i++
      j++
    } else if (table[i + 1]![j]! >= table[i]![j + 1]!) i++
    else j++
  }

  return {
    baseToSide,
    sideToBase,
    additions: side.map((_, index) => index).filter((index) => !sideToBase.has(index)),
  }
}

function additionAnchor(sideIndex: number, match: SideMatch, sideLength: number): string {
  let before = -1
  let after = -1
  for (let i = sideIndex - 1; i >= 0; i--) {
    const baseIndex = match.sideToBase.get(i)
    if (baseIndex !== undefined) {
      before = baseIndex
      break
    }
  }
  for (let i = sideIndex + 1; i < sideLength; i++) {
    const baseIndex = match.sideToBase.get(i)
    if (baseIndex !== undefined) {
      after = baseIndex
      break
    }
  }
  return `${before}:${after}`
}

function topoSort(
  tokens: Set<string>,
  edges: Map<string, Set<string>>,
): string[] | null {
  const compareTokens = (a: string, b: string): number => {
    const prefix = a.charCodeAt(0) - b.charCodeAt(0)
    return prefix || Number(a.slice(1)) - Number(b.slice(1))
  }
  const incoming = new Map([...tokens].map((token) => [token, 0]))
  for (const tos of edges.values()) {
    for (const to of tos) incoming.set(to, (incoming.get(to) ?? 0) + 1)
  }
  const ready = [...tokens].filter((token) => incoming.get(token) === 0)
  const out: string[] = []
  while (ready.length > 0) {
    ready.sort(compareTokens)
    const token = ready.shift()!
    out.push(token)
    for (const to of edges.get(token) ?? []) {
      const count = (incoming.get(to) ?? 1) - 1
      incoming.set(to, count)
      if (count === 0) ready.push(to)
    }
  }
  return out.length === tokens.size ? out : null
}

function mergeSequence(
  base: unknown[],
  ours: unknown[],
  theirs: unknown[],
  path: string,
  conflicts: MergeConflict[],
  options: MergeOptions,
  nodePosition: boolean,
): Value {
  const om = matchSide(base, ours, nodePosition)
  const tm = matchSide(base, theirs, nodePosition)
  const values = new Map<string, unknown>()
  const omitted = new Set<string>()

  for (let i = 0; i < base.length; i++) {
    const oi = om.baseToSide.get(i)
    const ti = tm.baseToSide.get(i)
    const token = `b${i}`
    if (oi === undefined && ti === undefined) {
      omitted.add(token)
      continue
    }
    if (oi === undefined || ti === undefined) {
      const present = oi === undefined ? theirs[ti!] : ours[oi]
      if (equal(base[i], present, nodePosition)) {
        omitted.add(token)
        continue
      }
      const resolved = conflict(
        'delete-edit',
        pointer(path, i),
        base[i],
        oi === undefined ? MISSING : ours[oi],
        ti === undefined ? MISSING : theirs[ti],
        conflicts,
        options,
      )
      if (resolved === MISSING) omitted.add(token)
      else values.set(token, resolved)
      continue
    }
    const merged = mergeValue(base[i], ours[oi], theirs[ti], pointer(path, i), conflicts, options, nodePosition)
    if (merged === MISSING) omitted.add(token)
    else values.set(token, merged)
  }

  const oursAdditionTokens = new Map<number, string>()
  const theirsAdditionTokens = new Map<number, string>()
  const usedTheirs = new Set<number>()
  for (const oi of om.additions) {
    const anchor = additionAnchor(oi, om, ours.length)
    const identityCollision = tm.additions.find((ti) => {
      const hint = identityHint(ours[oi])
      return hint !== undefined &&
        identityHint(theirs[ti]) === hint &&
        additionAnchor(ti, tm, theirs.length) === anchor &&
        !equal(ours[oi], theirs[ti], nodePosition)
    })
    if (identityCollision !== undefined) {
      return conflict('concurrent-sequence-edit', path, base, ours, theirs, conflicts, options)
    }
    const same = tm.additions.find(
      (ti) =>
        !usedTheirs.has(ti) &&
        additionAnchor(ti, tm, theirs.length) === anchor &&
        equal(ours[oi], theirs[ti], nodePosition),
    )
    const token = `o${oi}`
    oursAdditionTokens.set(oi, token)
    values.set(token, ours[oi])
    if (same !== undefined) {
      theirsAdditionTokens.set(same, token)
      usedTheirs.add(same)
    }
  }
  for (const ti of tm.additions) {
    if (usedTheirs.has(ti)) continue
    const token = `t${ti}`
    theirsAdditionTokens.set(ti, token)
    values.set(token, theirs[ti])
  }

  const tokensFor = (
    side: unknown[],
    match: SideMatch,
    additions: Map<number, string>,
  ): string[] =>
    side
      .map((_, index) => {
        const baseIndex = match.sideToBase.get(index)
        return baseIndex === undefined ? additions.get(index) : `b${baseIndex}`
      })
      .filter((token): token is string => token !== undefined && !omitted.has(token))

  const oursTokens = tokensFor(ours, om, oursAdditionTokens)
  const theirsTokens = tokensFor(theirs, tm, theirsAdditionTokens)
  const survivingBase = base.map((_, i) => `b${i}`).filter((token) => !omitted.has(token))
  const basePart = (tokens: string[]): string[] => tokens.filter((token) => token.startsWith('b'))
  const oursMoved = !equal(basePart(oursTokens), survivingBase)
  const theirsMoved = !equal(basePart(theirsTokens), survivingBase)

  const allTokens = new Set([...oursTokens, ...theirsTokens])
  const edges = new Map<string, Set<string>>()
  const addEdges = (tokens: string[], includeBaseEdges: boolean): void => {
    for (let i = 1; i < tokens.length; i++) {
      const from = tokens[i - 1]!
      const to = tokens[i]!
      if (!includeBaseEdges && from.startsWith('b') && to.startsWith('b')) continue
      if (from !== to) (edges.get(from) ?? (edges.set(from, new Set()), edges.get(from)!)).add(to)
    }
  }
  if (!oursMoved && !theirsMoved) {
    addEdges(survivingBase, true)
    addEdges(oursTokens, false)
    addEdges(theirsTokens, false)
  } else {
    addEdges(oursTokens, oursMoved)
    addEdges(theirsTokens, theirsMoved)
  }

  const order = topoSort(allTokens, edges)
  if (order === null) {
    return conflict('concurrent-sequence-edit', path, base, ours, theirs, conflicts, options)
  }
  return order.map((token) => values.get(token))
}

function mergeValue(
  base: Value,
  ours: Value,
  theirs: Value,
  path: string,
  conflicts: MergeConflict[],
  options: MergeOptions,
  nodePosition = true,
): Value {
  if (equal(ours, theirs, nodePosition)) return ours
  if (equal(ours, base, nodePosition)) return theirs
  if (equal(theirs, base, nodePosition)) return ours

  if (ours === MISSING || theirs === MISSING) {
    return conflict('delete-edit', path, base, ours, theirs, conflicts, options)
  }

  if (Array.isArray(base) && Array.isArray(ours) && Array.isArray(theirs)) {
    return mergeSequence(base, ours, theirs, path, conflicts, options, nodePosition)
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
      if (nodePosition && (key === 'pos' || key === 'srcByteLength')) continue
      const value = mergeValue(
        Object.hasOwn(b, key) ? b[key] : MISSING,
        Object.hasOwn(o, key) ? o[key] : MISSING,
        Object.hasOwn(t, key) ? t[key] : MISSING,
        pointer(path, key),
        conflicts,
        options,
        childIsNode(b.type ?? o.type ?? t.type, key),
      )
      if (value !== MISSING) out[key] = value
    }
    return out
  }

  return conflict('both-changed', path, base, ours, theirs, conflicts, options)
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
  options: MergeOptions = {},
): MergeResult {
  const conflicts: MergeConflict[] = []
  const merged = mergeValue(base, ours, theirs, '', conflicts, options)
  if (conflicts.length > 0 || merged === MISSING) return { ok: false, ast: null, conflicts }
  const ast = semantic(merged, true) as AstJsonDocument
  ast.srcByteLength = 0
  const payload = JSON.stringify(ast)
  fromAstJson(ast, new TextEncoder().encode(payload).byteLength)
  return { ok: true, ast, conflicts: [] }
}
