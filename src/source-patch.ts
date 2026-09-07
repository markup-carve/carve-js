/** A UTF-8 byte-range replacement against an exact source revision. */
export interface SourceEdit {
  start: number
  end: number
  replacement: string
  kind: 'formatting' | 'syntax-migration' | 'quick-fix' | 'refactor'
  code: string
}

/** A change that was deliberately not made because it needs writer judgment. */
export interface SourceSuggestion extends SourceEdit {
  message: string
}

export interface SourcePatch {
  version: 1
  sourceFingerprint: string
  sourceBytes: number
  edits: SourceEdit[]
  unresolved: SourceSuggestion[]
}

const encoder = new TextEncoder()
const decoder = new TextDecoder('utf-8', { fatal: true })
const EDIT_KINDS = new Set<SourceEdit['kind']>(['formatting', 'syntax-migration', 'quick-fix', 'refactor'])

function encodeSource(source: string): Uint8Array {
  const encoded = encoder.encode(source)
  if (decoder.decode(encoded) !== source) throw new Error('source must be well-formed Unicode')
  return encoded
}

/** Stable cross-engine fingerprint used as a stale-source precondition. */
export function sourceFingerprint(source: string): string {
  let hash = 0xcbf29ce484222325n
  for (const byte of encodeSource(source)) {
    hash ^= BigInt(byte)
    hash = BigInt.asUintN(64, hash * 0x100000001b3n)
  }
  return `fnv1a64:${hash.toString(16).padStart(16, '0')}`
}

/** Build the smallest single replacement that turns `source` into `replacement`. */
export function createSourcePatch(
  source: string,
  replacement: string,
  kind: SourceEdit['kind'] = 'refactor',
  code = 'replace-source',
): SourcePatch {
  const before = encodeSource(source)
  const after = encodeSource(replacement)
  let start = 0
  while (start < before.length && start < after.length && before[start] === after[start]) start++
  while (start > 0 && ((start < before.length && (before[start]! & 0xc0) === 0x80)
    || (start < after.length && (after[start]! & 0xc0) === 0x80))) start--
  let oldEnd = before.length
  let newEnd = after.length
  while (oldEnd > start && newEnd > start && before[oldEnd - 1] === after[newEnd - 1]) {
    oldEnd--
    newEnd--
  }
  while ((oldEnd < before.length && (before[oldEnd]! & 0xc0) === 0x80)
    || (newEnd < after.length && (after[newEnd]! & 0xc0) === 0x80)) {
    oldEnd++
    newEnd++
  }
  const edits = source === replacement ? [] : [{ start, end: oldEnd,
    replacement: decoder.decode(after.slice(start, newEnd)), kind, code }]
  return { version: 1, sourceFingerprint: sourceFingerprint(source), sourceBytes: before.length, edits, unresolved: [] }
}

/** Validate and apply a patch. Unmentioned source bytes are copied verbatim. */
export function applySourcePatch(source: string, patch: SourcePatch): string {
  const bytes = encodeSource(source)
  if (patch.version !== 1 || bytes.length !== patch.sourceBytes || sourceFingerprint(source) !== patch.sourceFingerprint) {
    throw new Error('source patch precondition does not match the source')
  }
  let cursor = 0
  const chunks: Uint8Array[] = []
  if (!Array.isArray(patch.edits)) throw new Error('source patch edits must be an array')
  for (const edit of patch.edits) {
    if (!Number.isInteger(edit.start) || !Number.isInteger(edit.end) || edit.start < cursor || edit.end < edit.start || edit.end > bytes.length) {
      throw new Error('source patch edits must be sorted, non-overlapping UTF-8 byte ranges')
    }
    if (!EDIT_KINDS.has(edit.kind) || edit.code.length === 0) throw new Error('source patch edits require a known kind and non-empty code')
    try { decoder.decode(bytes.slice(edit.start, edit.end)) } catch {
      throw new Error('source patch edits must be sorted, non-overlapping UTF-8 byte ranges')
    }
    chunks.push(bytes.slice(cursor, edit.start), encoder.encode(edit.replacement))
    cursor = edit.end
  }
  chunks.push(bytes.slice(cursor))
  const size = chunks.reduce((total, chunk) => total + chunk.length, 0)
  const output = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.length }
  return decoder.decode(output)
}
