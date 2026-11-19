// C2-A-141: 0.1 offsets count code points, 2.0 offsets count UTF-8 bytes.
import { integer, loss, object, type Fields, type MigrationState } from './shared.ts'

type Visit = (node: Fields, path: string) => void

function walk(value: unknown, path: string, visit: Visit): void {
  if (Array.isArray(value)) { value.forEach((entry, index) => walk(entry, `${path}/${index}`, visit)); return }
  if (!object(value)) return
  if (typeof value['type'] === 'string') visit(value, path)
  for (const [key, entry] of Object.entries(value)) {
    if (key !== 'pos' && key !== 'data' && key !== 'payload' && key !== 'props') walk(entry, `${path}/${key}`, visit)
  }
}

function nonAscii(value: unknown): boolean {
  if (typeof value === 'string') return /[^\x00-\x7f]/u.test(value)
  if (Array.isArray(value)) return value.some(nonAscii)
  return object(value) && Object.entries(value).some(([key, entry]) => key !== 'pos' && nonAscii(entry))
}

/** The UTF-8 byte offset of each code point offset of `source`, its length included. */
function byteOffsets(source: string): number[] {
  const offsets = [0]
  let bytes = 0
  for (const character of source) {
    const point = character.codePointAt(0) ?? 0
    bytes += point < 0x80 ? 1 : point < 0x800 ? 2 : point < 0x10000 ? 3 : 4
    offsets.push(bytes)
  }
  return offsets
}

function convert(pos: Fields, offsets: readonly number[]): boolean {
  const start = offsets[integer(pos['startOffset']) ?? -1]
  const end = offsets[integer(pos['endOffset']) ?? -1]
  if (start === undefined || end === undefined) return false
  pos['startOffset'] = start
  pos['endOffset'] = end
  return true
}

/**
 * With the source each offset is converted; without it an offset is kept only when no string of the tree holds a
 * character past ASCII, and otherwise every `pos` is dropped with one loss at the first.
 */
export function byteOffsetPositions(document: Fields, state: MigrationState, base: string): void {
  const offsets = state.source === undefined ? undefined : byteOffsets(state.source)
  if (offsets === undefined && !nonAscii(document)) return
  let reported = false
  walk(document, base, (node, path) => {
    if (!object(node['pos'])) return
    const pos = { ...node['pos'] }
    if (offsets !== undefined && convert(pos, offsets)) { node['pos'] = pos; return }
    delete node['pos']
    if (reported) return
    reported = true
    loss(state, `${path}/pos`, offsets === undefined
      ? 'positions dropped: 0.1 offsets count code points and no source was given to count bytes'
      : 'positions dropped: an offset lies past the end of the source')
  })
}
