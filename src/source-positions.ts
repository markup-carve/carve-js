import { isAtContentColumn, markAboveContentColumn } from './paragraph-indent.js'
import type { Document, Paragraph, Position } from './ast.js'

/** Node positions and the sidecar fields that also carry source locations. */
const POSITION_FIELDS: readonly string[] = [
  'pos',
  'footnoteDefPos',
  'termSpans',
  'definitionSpans',
  'definitionLines',
]

/** Position an authored definition using the lexer's indexed line starts. */
export function definitionLinePosition(
  lines: readonly string[],
  lineOffsets: readonly number[],
  line: number,
  sourceLength: number,
  startColumn = 1,
): Position {
  const text = lines[line] ?? ''
  const startOffset = Math.min(lineOffsets[line] ?? 0, sourceLength)
  return {
    startLine: line + 1,
    endLine: line + 1,
    startColumn,
    endColumn: text.length + startColumn,
    startOffset,
    endOffset: Math.min(startOffset + text.length, sourceLength),
  }
}

/** Copy position-bearing records without changing their property shapes by deletion. */
export function dropPositions(doc: Document): Document {
  const copies = new WeakMap<object, unknown>()
  const walk = (value: unknown, preserveKeys = false): unknown => {
    if (!value || typeof value !== 'object') return value
    if (!Array.isArray(value)) {
      const record = value as Record<string, unknown>
      let leaf = true
      for (const key in record) {
        if (!Object.hasOwn(record, key) || (!preserveKeys && (key === 'attrs' || key === 'headAttrs' || key === 'footAttrs'))) continue
        if ((!preserveKeys && POSITION_FIELDS.includes(key)) || (record[key] && typeof record[key] === 'object')) {
          leaf = false
          break
        }
      }
      if (leaf) return value
    }
    const existing = copies.get(value)
    if (existing) return existing
    if (Array.isArray(value)) {
      const copy: unknown[] = []
      copies.set(value, copy)
      let changed = false
      for (const item of value) {
        const next = walk(item)
        copy.push(next)
        if (next !== item) changed = true
      }
      const result = changed ? copy : value
      copies.set(value, result)
      return result
    }
    const record = value as Record<string, unknown>
    const prototype = Object.getPrototypeOf(value) as object | null
    const copy = Object.create(prototype) as Record<string, unknown>
    copies.set(value, copy)
    if (record['type'] === 'paragraph' && !isAtContentColumn(record as unknown as Paragraph)) {
      markAboveContentColumn(copy as unknown as Paragraph)
    }
    let changed = false
    for (const key in record) {
      if (!Object.hasOwn(record, key)) continue
      if (!preserveKeys && POSITION_FIELDS.includes(key)) { changed = true; continue }
      const next = !preserveKeys && (key === 'attrs' || key === 'headAttrs' || key === 'footAttrs')
        ? record[key] : walk(record[key], key === 'footnoteDefs')
      if (next !== record[key]) changed = true
      if (key === '__proto__' || (prototype !== null && prototype !== Object.prototype)) {
        Object.defineProperty(copy, key, { value: next, enumerable: true, configurable: true, writable: true })
      } else copy[key] = next
    }
    const result = changed ? copy : value
    copies.set(value, result)
    return result
  }
  return walk(doc) as Document
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
