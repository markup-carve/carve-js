import type { Document, Position } from './ast.js'

/** Node positions and the sidecar fields that also carry source locations. */
const POSITION_FIELDS = [
  'pos',
  'footnoteDefPos',
  'termSpans',
  'definitionSpans',
  'definitionLines',
] as const

/**
 * Remove source-position fields from the finished tree. The parser still tracks positions;
 * this option reduces the returned tree rather than skipping scanner work.
 */
export function dropPositions(doc: Document): void {
  const seen = new Set<object>()
  const walk = (value: unknown): void => {
    if (!value || typeof value !== 'object') return
    if (seen.has(value)) return
    seen.add(value)
    if (Array.isArray(value)) {
      for (const item of value) walk(item)
      return
    }
    const record = value as Record<string, unknown>
    for (const field of POSITION_FIELDS) delete record[field]
    const node = typeof record['type'] === 'string'
    for (const key in record) {
      if (!Object.hasOwn(record, key)) continue
      if (key !== 'attrs' || !node) walk(record[key])
    }
  }
  walk(doc)
}

/**
 * Convert scanner UTF-16 indexes to the public codepoint offsets (PART 12 §4).
 * Columns are derived from converted offsets and line starts. BMP-only input
 * uses an identity path without allocating an offset table.
 */
export function toCodepointPositions(doc: Document, source: string): void {
  if (!/[\ud800-\udbff]/.test(source)) return

  // codepointAt[i] is the number of CODEPOINTS before UTF-16 index i.
  const codepointAt = new Uint32Array(source.length + 1)
  const lineStartCodepoint: number[] = [0]
  let count = 0
  for (let i = 0; i < source.length; i++) {
    codepointAt[i] = count
    const code = source.charCodeAt(i)
    if (code >= 0xd800 && code <= 0xdbff
      && source.charCodeAt(i + 1) >= 0xdc00 && source.charCodeAt(i + 1) <= 0xdfff) {
      // A surrogate pair is one codepoint; the low half shares its index.
      codepointAt[i + 1] = count
      i++
    }
    count++
    if (code === 10 || (code === 13 && source.charCodeAt(i + 1) !== 10)) {
      lineStartCodepoint.push(count)
    }
  }
  codepointAt[source.length] = count

  const codepointOffset = (utf16Offset: number): number => codepointAt[Math.min(utf16Offset, source.length)] ?? count

  const convert = (pos: Position): void => {
    const startOffset = pos.startOffset
    const endOffset = pos.endOffset
    if (typeof startOffset === 'number') {
      pos.startOffset = codepointOffset(startOffset)
      const lineStart = lineStartCodepoint[pos.startLine - 1]
      if (lineStart !== undefined && pos.startColumn !== undefined) {
        pos.startColumn = pos.startOffset - lineStart + 1
      }
    }
    if (typeof endOffset === 'number') {
      pos.endOffset = codepointOffset(endOffset)
      const lineStart = lineStartCodepoint[pos.endLine - 1]
      if (lineStart !== undefined && pos.endColumn !== undefined) {
        pos.endColumn = pos.endOffset - lineStart + 1
      }
    }
  }

  const seen = new Set<object>()
  const walk = (value: unknown): void => {
    if (!value || typeof value !== 'object') return
    if (seen.has(value as object)) return
    seen.add(value as object)
    if (Array.isArray(value)) {
      for (const item of value) walk(item)
      return
    }
    const record = value as Record<string, unknown>
    if (typeof record['startLine'] === 'number' && typeof record['endLine'] === 'number') {
      // A Position and nothing else: no node type in this engine carries
      // `startLine` directly, they all carry it inside a `pos`. Its fields are
      // scalars, so there is nothing below it to walk.
      convert(record as unknown as Position)
      return
    }
    for (const key of Object.keys(record)) {
      if (key !== 'attrs' || typeof record['type'] !== 'string') walk(record[key])
    }
  }
  walk(doc)
}
