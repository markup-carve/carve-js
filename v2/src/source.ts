import { CR, LF, SPACE, TAB } from './chars.ts'

const TAB_STOP = 4

/** Index of the line that holds `offset`. The line ending belongs to its line. */
export function lineAt(lineStarts: Int32Array, lineCount: number, offset: number): number {
  let low = 0
  let high = lineCount - 1
  while (low < high) {
    const middle = (low + high + 1) >> 1
    if (lineStarts[middle]! <= offset) low = middle
    else high = middle - 1
  }
  return low
}

/** The offset of the line feed behind `pos`, or the end of the source. */
export function lineFeedAt(src: string, pos: number): number {
  const feed = src.indexOf('\n', pos)
  return feed < 0 ? src.length : feed
}

/** Offset of the end of line `line`, before its line ending. */
export function lineEndAt(src: string, lineStarts: Int32Array, lineCount: number, line: number): number {
  if (line + 1 >= lineCount) {
    const length = src.length
    return length > 0 && src.charCodeAt(length - 1) === LF ? contentEnd(src, lineStarts[line]!, length - 1) : length
  }
  return contentEnd(src, lineStarts[line]!, lineStarts[line + 1]! - 1)
}

function contentEnd(src: string, start: number, end: number): number {
  return end > start && src.charCodeAt(end - 1) === CR ? end - 1 : end
}

/** Column after the character `code` that starts at `column` (C2-B-004). */
export function advanceColumn(column: number, code: number): number {
  return code === TAB ? column + TAB_STOP - (column % TAB_STOP) : column + 1
}

/** Column of `offset`, counted from the start of its line (C2-B-005). */
export function columnAt(src: string, lineStarts: Int32Array, lineCount: number, offset: number): number {
  let column = 0
  for (let pos = lineStarts[lineAt(lineStarts, lineCount, offset)]!; pos < offset; pos++) {
    column = advanceColumn(column, src.charCodeAt(pos))
  }
  return column
}

export function isSpaceOrTab(code: number): boolean {
  return code === SPACE || code === TAB
}
