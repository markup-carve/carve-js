const LF = 0x0a
const CR = 0x0d
const SPACE = 0x20
const TAB = 0x09

/** The lines of a source text. Lines are counted from 1, as the 0.1 tree counts them. */
export interface Lines {
  src: string
  /** `starts[n]` is the offset of line `n + 1`; one more entry stands at the end of the text. */
  starts: number[]
  count: number
}

export function readLines(src: string): Lines {
  const starts = [0]
  for (let at = 0; at < src.length; at++) {
    if (src.charCodeAt(at) === LF) starts.push(at + 1)
  }
  // A text that ends with a line ending has no line after it.
  if (starts[starts.length - 1] === src.length) return { src, starts, count: starts.length - 1 }
  starts.push(src.length)
  return { src, starts, count: starts.length - 1 }
}

/** Offset of the first character of `line`. A line past the end starts at the end of the text. */
export function lineStart(lines: Lines, line: number): number {
  return line > lines.count ? lines.src.length : lines.starts[line - 1]!
}

/** Offset after the last character of `line`, before its line ending. */
export function lineEnd(lines: Lines, line: number): number {
  if (line > lines.count) return lines.src.length
  const start = lines.starts[line - 1]!
  let end = lines.starts[line]!
  if (end > start && lines.src.charCodeAt(end - 1) === LF) end--
  if (end > start && lines.src.charCodeAt(end - 1) === CR) end--
  return end
}

export function lineText(lines: Lines, line: number): string {
  return line < 1 || line > lines.count ? '' : lines.src.slice(lineStart(lines, line), lineEnd(lines, line))
}

/** The line that holds `offset`. */
export function lineOf(lines: Lines, offset: number): number {
  let low = 0
  let high = lines.count - 1
  while (low < high) {
    const middle = (low + high + 1) >> 1
    if (lines.starts[middle]! <= offset) low = middle
    else high = middle - 1
  }
  return low + 1
}

/** Number of leading spaces and tabs of `text`. */
export function indentOf(text: string): number {
  let at = 0
  while (at < text.length && (text.charCodeAt(at) === SPACE || text.charCodeAt(at) === TAB)) at++
  return at
}

export function isBlank(text: string): boolean {
  return indentOf(text) === text.length
}
