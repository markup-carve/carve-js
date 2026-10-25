import type { Document, Position } from '../ast.js'

const offsets = new WeakMap<Document, number[]>()

export function rememberAstSource(doc: Document, source: string): void {
  const map = [0]
  const encoder = new TextEncoder()
  for (const point of source) map.push(map[map.length - 1]! + encoder.encode(point).length)
  offsets.set(doc, map)
}

export function astByteOffset(doc: Document, offset: number): number | undefined {
  if (!Number.isSafeInteger(offset) || offset < 0) return undefined
  return offsets.get(doc)?.[offset]
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
