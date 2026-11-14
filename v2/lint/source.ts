import { unitBytes } from '../src/positions.ts'
import { type Line } from './types.ts'

/** C2-W-103: one source pass builds line and byte positions. */
export function sourceLines(source: string): { bytes: Uint32Array, chars: Uint32Array, offsetLines: Uint32Array, lines: Line[] } {
  const bytes = new Uint32Array(source.length + 1)
  const offsetLines = new Uint32Array(source.length + 1)
  const lines: Line[] = []
  let start = 0
  for (let at = 0; at < source.length; at++) {
    bytes[at + 1] = bytes[at]! + unitBytes(source, at)
    offsetLines[at] = lines.length + 1
    if (source.charCodeAt(at) !== 10) continue
    let end = at
    if (end > start && source.charCodeAt(end - 1) === 13) end--
    lines.push({ text: source.slice(start, end), start, end, number: lines.length + 1, path: '', opaque: false,
      paragraph: false })
    start = at + 1
  }
  lines.push({ text: source.slice(start), start, end: source.length, number: lines.length + 1, path: '', opaque: false,
    paragraph: false })
  offsetLines[source.length] = lines.length
  const chars = new Uint32Array(bytes[source.length]! + 1)
  for (let at = 0; at < source.length; at++) {
    for (let byte = bytes[at]!; byte < bytes[at + 1]!; byte++) chars[byte] = at
  }
  chars[chars.length - 1] = source.length
  return { bytes, chars, offsetLines, lines }
}

/** The parser's leaf block positions decide whether a source line can be checked as text. */
export function markNodeLines(lines: Line[], type: string, path: string, firstLine: number, lastLine: number): void {
  const paragraph = type === 'paragraph' || type === 'caption' || type === 'definition_term'
  const opaque = type === 'code_block' || type === 'raw_block' || type === 'frontmatter' || type === 'comment_block'
  if (!paragraph && !opaque) return
  for (let index = firstLine - 1; index < lastLine; index++) {
    const line = lines[index]!
    if (paragraph) {
      line.path = path
      line.paragraph = true
    }
    if (opaque) line.opaque = true
  }
}
