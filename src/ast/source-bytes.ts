import type { Document, Position } from '../ast.js'

// The codepoint-to-byte map is built on first use: most parses never reach the wire.
const sources = new WeakMap<Document, string>()
const offsets = new WeakMap<Document, number[] | null>()

export function rememberAstSource(doc: Document, source: string): void {
  sources.set(doc, source)
  offsets.delete(doc)
}

/** `null` means the source is ASCII, so codepoint and byte offsets agree. */
function byteMap(doc: Document): number[] | null | undefined {
  const known = offsets.get(doc)
  if (known !== undefined) return known
  const source = sources.get(doc)
  if (source === undefined) return undefined
  let map: number[] | null = null
  if (/[^\x00-\x7f]/.test(source)) {
    map = [0]
    let bytes = 0
    for (let i = 0; i < source.length; i++) {
      const unit = source.charCodeAt(i)
      if (unit < 0x80) bytes += 1
      else if (unit < 0x800) bytes += 2
      else if (unit >= 0xd800 && unit <= 0xdbff && i + 1 < source.length &&
          (source.charCodeAt(i + 1) & 0xfc00) === 0xdc00) {
        bytes += 4
        i++
      } else bytes += 3
      map.push(bytes)
    }
  }
  offsets.set(doc, map)
  return map
}

export function astByteOffset(doc: Document, offset: number): number | undefined {
  if (!Number.isSafeInteger(offset) || offset < 0) return undefined
  const map = byteMap(doc)
  if (map === undefined) return undefined
  if (map === null) return offset <= sources.get(doc)!.length ? offset : undefined
  return map[offset]
}

export function positionToBytes(doc: Document, pos: Position): Position {
  const startOffset = pos.startOffset === undefined ? undefined : astByteOffset(doc, pos.startOffset)
  const endOffset = pos.endOffset === undefined ? undefined : astByteOffset(doc, pos.endOffset)
  return {
    ...pos,
    ...(startOffset === undefined ? {} : { startOffset }),
    ...(endOffset === undefined ? {} : { endOffset }),
  }
}
