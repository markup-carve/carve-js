// Tree diff and patch: a JSON Patch (RFC 6902) over the encoded tree, addressed with RFC 6901 pointers as diagnostics
// are, and the fingerprints that bind a patch to the tree it was made against.
import { type DocumentNode } from './ast.ts'
import { decodeTree, encodeTree } from './ast-json.ts'
import { CarveTreeError } from './ast-validate.ts'
import { type ExtensionDefinition } from './extensions/types.ts'

type Json = null | boolean | number | string | Json[] | { [key: string]: Json }

/** One operation of RFC 6902. */
export type PatchOperation =
  | { op: 'add' | 'replace' | 'test', path: string, value: unknown }
  | { op: 'remove', path: string }
  | { op: 'move' | 'copy', from: string, path: string }

/** A patch that cannot be applied: `path` points into the patch, or into the tree the patch gave (C2-A-167). */
export class CarvePatchError extends Error {
  path: string
  reason: string

  constructor(path: string, reason: string) {
    super(`${path === '' ? '/' : path}: ${reason}`)
    this.name = 'CarvePatchError'
    this.path = path
    this.reason = reason
  }
}

const K = Uint32Array.from([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01,
  0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc,
  0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
  0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08,
  0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
])

/** The SHA-256 of `bytes` in lower-case hex (FIPS 180-4), synchronous so it runs in every host. */
function sha256(bytes: Uint8Array): string {
  const length = bytes.length
  const padded = new Uint8Array(((length + 9 + 63) >> 6) << 6)
  padded.set(bytes)
  padded[length] = 0x80
  const view = new DataView(padded.buffer)
  view.setUint32(padded.length - 8, Math.floor(length / 0x20000000))
  view.setUint32(padded.length - 4, (length << 3) >>> 0)
  const h = Uint32Array.from([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19])
  const w = new Uint32Array(64)
  const rotr = (x: number, n: number): number => (x >>> n) | (x << (32 - n))
  for (let block = 0; block < padded.length; block += 64) {
    for (let t = 0; t < 16; t++) w[t] = view.getUint32(block + t * 4)
    for (let t = 16; t < 64; t++) {
      const a = w[t - 15]!
      const b = w[t - 2]!
      w[t] = (w[t - 16]! + (rotr(a, 7) ^ rotr(a, 18) ^ (a >>> 3)) + w[t - 7]! + (rotr(b, 17) ^ rotr(b, 19) ^ (b >>> 10))) >>> 0
    }
    let [a, b, c, d, e, f, g, k] = h as unknown as number[]
    for (let t = 0; t < 64; t++) {
      const t1 = (k! + (rotr(e!, 6) ^ rotr(e!, 11) ^ rotr(e!, 25)) + ((e! & f!) ^ (~e! & g!)) + K[t]! + w[t]!) >>> 0
      const t2 = ((rotr(a!, 2) ^ rotr(a!, 13) ^ rotr(a!, 22)) + ((a! & b!) ^ (a! & c!) ^ (b! & c!))) >>> 0
      k = g; g = f; f = e; e = (d! + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0
    }
    h[0] = h[0]! + a!; h[1] = h[1]! + b!; h[2] = h[2]! + c!; h[3] = h[3]! + d!
    h[4] = h[4]! + e!; h[5] = h[5]! + f!; h[6] = h[6]! + g!; h[7] = h[7]! + k!
  }
  return Array.from(h, (word) => word.toString(16).padStart(8, '0')).join('')
}

/** The fingerprint of a source: `sha256:` and the hash of its UTF-8 bytes, so text and bytes of one source agree. */
export function sourceFingerprint(source: string | Uint8Array): string {
  return `sha256:${sha256(typeof source === 'string' ? new TextEncoder().encode(source) : source)}`
}

/** The fingerprint of a tree: `sha256:` and the hash of the UTF-8 bytes of `encodeTree(tree)`. */
export function treeFingerprint(document: DocumentNode): string {
  return sourceFingerprint(encodeTree(document))
}

function escapePointer(key: string): string {
  return key.replaceAll('~', '~0').replaceAll('/', '~1')
}

function isObject(value: Json): value is { [key: string]: Json } {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** RFC 6902, section 4.6: equal values, members compared without regard to their order. */
function same(a: Json, b: Json): boolean {
  if (a === b) return true
  if (Array.isArray(a)) return Array.isArray(b) && a.length === b.length && a.every((item, at) => same(item, b[at]!))
  if (!isObject(a) || !isObject(b)) return false
  const keys = Object.keys(a)
  return keys.length === Object.keys(b).length && keys.every((key) => Object.hasOwn(b, key) && same(a[key]!, b[key]!))
}

/** Whether `value` is a JSON value: what a patch may carry. */
function isJson(value: unknown): value is Json {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true
  if (typeof value === 'number') return Number.isFinite(value)
  if (Array.isArray(value)) return value.every(isJson)
  if (typeof value !== 'object') return false
  const prototype: unknown = Object.getPrototypeOf(value)
  return (prototype === Object.prototype || prototype === null) && Object.values(value).every(isJson)
}

/** Two nodes of one type are patched field by field; anything else is replaced whole. */
function comparable(a: Json, b: Json): boolean {
  if (Array.isArray(a) && Array.isArray(b)) return true
  return isObject(a) && isObject(b) && a['type'] === b['type']
}

function diffValue(a: Json, b: Json, path: string, out: PatchOperation[]): void {
  if (same(a, b)) return
  if (!comparable(a, b)) {
    out.push({ op: 'replace', path, value: b })
    return
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    diffArray(a, b, path, out)
    return
  }
  const left = a as { [key: string]: Json }
  const right = b as { [key: string]: Json }
  for (const key of Object.keys(left)) if (!Object.hasOwn(right, key)) out.push({ op: 'remove', path: `${path}/${escapePointer(key)}` })
  for (const key of Object.keys(right)) {
    const at = `${path}/${escapePointer(key)}`
    if (!Object.hasOwn(left, key)) out.push({ op: 'add', path: at, value: right[key] })
    else diffValue(left[key]!, right[key]!, at, out)
  }
}

/** Equal heads and tails stay; the middle is patched pairwise, then the rest is removed or added. */
function diffArray(a: Json[], b: Json[], path: string, out: PatchOperation[]): void {
  let head = 0
  while (head < a.length && head < b.length && same(a[head]!, b[head]!)) head++
  let tail = 0
  while (tail < a.length - head && tail < b.length - head && same(a[a.length - 1 - tail]!, b[b.length - 1 - tail]!)) tail++
  const left = a.length - head - tail
  const right = b.length - head - tail
  const pairs = Math.min(left, right)
  for (let at = 0; at < pairs; at++) diffValue(a[head + at]!, b[head + at]!, `${path}/${head + at}`, out)
  for (let at = pairs; at < left; at++) out.push({ op: 'remove', path: `${path}/${head + pairs}` })
  for (let at = pairs; at < right; at++) out.push({ op: 'add', path: `${path}/${head + at}`, value: b[head + at] })
}

/** The JSON Patch that turns the encoded tree `a` into the encoded tree `b`. Applied to `a`, it gives `b`. */
export function diffTree(a: DocumentNode, b: DocumentNode): PatchOperation[] {
  const out: PatchOperation[] = []
  diffValue(JSON.parse(encodeTree(a)) as Json, JSON.parse(encodeTree(b)) as Json, '', out)
  return out
}

function parsePointer(pointer: unknown, at: string): string[] {
  if (typeof pointer !== 'string' || (pointer !== '' && !pointer.startsWith('/'))) throw new CarvePatchError(at, 'not a JSON pointer')
  if (pointer === '') return []
  return pointer.slice(1).split('/').map((part) => part.replaceAll('~1', '/').replaceAll('~0', '~'))
}

type Slot = { container: Json[] | { [key: string]: Json }, key: string | number }

function child(container: Json, key: string, at: string, adding: boolean): Slot {
  if (Array.isArray(container)) {
    if (adding && key === '-') return { container, key: container.length }
    if (!/^(0|[1-9][0-9]*)$/.test(key)) throw new CarvePatchError(at, `${key} is no index`)
    const index = Number(key)
    if (index > container.length || (!adding && index === container.length)) throw new CarvePatchError(at, `index ${key} is out of range`)
    return { container, key: index }
  }
  if (!isObject(container)) throw new CarvePatchError(at, 'the target has no members')
  if (!adding && !Object.hasOwn(container, key)) throw new CarvePatchError(at, `no member ${key}`)
  return { container, key }
}

function walk(root: Json, parts: readonly string[], at: string): Json {
  let value = root
  for (const part of parts) {
    const found = child(value, part, at, false)
    value = (found.container as Record<string | number, Json>)[found.key]!
  }
  return value
}

function insert(root: Json, parts: readonly string[], value: Json, at: string, replace: boolean): Json {
  if (parts.length === 0) return value
  const target = child(walk(root, parts.slice(0, -1), at), parts.at(-1)!, at, !replace)
  if (Array.isArray(target.container)) {
    if (replace) target.container[target.key as number] = value
    else target.container.splice(target.key as number, 0, value)
  } else target.container[target.key as string] = value
  return root
}

function remove(root: Json, parts: readonly string[], at: string): Json {
  if (parts.length === 0) throw new CarvePatchError(at, 'the root cannot be removed')
  const target = child(walk(root, parts.slice(0, -1), at), parts.at(-1)!, at, false)
  if (Array.isArray(target.container)) target.container.splice(target.key as number, 1)
  else delete target.container[target.key as string]
  return root
}

function transfer(root: Json, entry: Record<string, unknown>, path: readonly string[], at: string): Json {
  const from = parsePointer(entry['from'], `${at}/from`)
  const moved = structuredClone(walk(root, from, `${at}/from`))
  if (entry['op'] === 'move') {
    if (path.length > from.length && from.every((part, i) => path[i] === part)) {
      throw new CarvePatchError(`${at}/path`, 'a value cannot move into itself')
    }
    root = remove(root, from, `${at}/from`)
  }
  return insert(root, path, moved, `${at}/path`, false)
}

function applyOperation(root: Json, operation: unknown, index: number): Json {
  const at = `/${index}`
  if (!isObject(operation as Json)) throw new CarvePatchError(at, 'not an operation')
  const entry = operation as Record<string, unknown>
  const path = parsePointer(entry['path'], `${at}/path`)
  const needsValue = entry['op'] === 'add' || entry['op'] === 'replace' || entry['op'] === 'test'
  if (needsValue && !Object.hasOwn(entry, 'value')) throw new CarvePatchError(`${at}/value`, 'missing')
  if (needsValue && !isJson(entry['value'])) throw new CarvePatchError(`${at}/value`, 'not a JSON value')
  const value = structuredClone(entry['value']) as Json
  switch (entry['op']) {
    case 'add': return insert(root, path, value, `${at}/path`, false)
    case 'replace':
      walk(root, path, `${at}/path`)
      return insert(root, path, value, `${at}/path`, true)
    case 'remove': return remove(root, path, `${at}/path`)
    case 'test':
      if (!same(walk(root, path, `${at}/path`), value)) throw new CarvePatchError(`${at}/value`, 'the test failed')
      return root
    case 'move':
    case 'copy': return transfer(root, entry, path, at)
    default: throw new CarvePatchError(`${at}/op`, `unknown operation ${JSON.stringify(entry['op'])}`)
  }
}

/** The options of `applyPatch`. */
export interface ApplyPatchOptions {
  /** The fingerprint of the tree the patch was made against (`treeFingerprint`); a tree with another one is refused. */
  fingerprint?: string
  /** Provisional: the registered extensions the decoded result is checked with (C2-X-038). */
  extensions?: readonly ExtensionDefinition[]
}

/**
 * Applies a JSON Patch to the encoded tree and decodes the result. Refuses with one `CarvePatchError` when the
 * fingerprint differs, an operation fails, or the result is no tree of contract 2.0; `document` is not changed.
 */
export function applyPatch(document: DocumentNode, patch: readonly unknown[], options: ApplyPatchOptions = {}): DocumentNode {
  if (!Array.isArray(patch)) throw new CarvePatchError('', 'the patch is not a list of operations')
  if (options.fingerprint !== undefined) {
    const actual = treeFingerprint(document)
    if (actual !== options.fingerprint) throw new CarvePatchError('', `the tree has the fingerprint ${actual}, not ${options.fingerprint}`)
  }
  let root = JSON.parse(encodeTree(document)) as Json
  patch.forEach((operation, index) => { root = applyOperation(root, operation, index) })
  try {
    return decodeTree(JSON.stringify(root), undefined, options.extensions)
  } catch (error) {
    if (error instanceof CarveTreeError) throw new CarvePatchError(error.path, `the result is no tree: ${error.reason}`)
    throw error
  }
}
