const TASK_STATES = ' xX-_>/!?'

const isBlank = (char: string | undefined): boolean => char === ' ' || char === '\t'
const isDigit = (char: string | undefined): boolean => char !== undefined && char >= '0' && char <= '9'
const isLetter = (char: string | undefined): boolean =>
  char !== undefined && ((char >= 'a' && char <= 'z') || (char >= 'A' && char <= 'Z'))

function opensListMarker(line: string, at: number): boolean {
  let end = at
  if (line[end] === '-' || line[end] === '*' || line[end] === '+') end++
  else {
    while (isDigit(line[end])) end++
    if (end === at && isLetter(line[end])) end++
    if (end === at || (line[end] !== '.' && line[end] !== ')')) return false
    end++
  }
  return isBlank(line[end])
}

function columnAt(line: string, offset: number): number {
  let column = 0
  for (let index = 0; index < offset; index++) column += line[index] === '\t' ? 4 - column % 4 : 1
  return column
}

/** The `[start, end)` offsets of a task box behind a marker line's quote and list prefixes, its spaces included. */
export function markerLineTaskBox(line: string): [number, number] | null {
  if (!line.includes('] ')) return null
  let at = 0
  for (;;) {
    while (isBlank(line[at])) at++
    const char = line[at]
    if (char === '>') {
      at++
      if (isBlank(line[at])) at++
      continue
    }
    const bullet = char === '-' || char === '*'
    let end = at
    if (bullet || char === '+') end++
    else {
      while (isDigit(line[end])) end++
      if (end === at && isLetter(line[end])) end++
      if (end === at || (line[end] !== '.' && line[end] !== ')')) return null
      end++
    }
    if (!isBlank(line[end])) return null
    while (isBlank(line[end])) end++
    if (bullet && line[at + 1] === ' ' && line[end] === '[' && TASK_STATES.includes(line[end + 1] ?? '\n') &&
        line[end + 2] === ']' && line[end + 3] === ' ') {
      let boxEnd = end + 3
      while (line[boxEnd] === ' ') boxEnd++
      // A sub-item after the box stands at its own column, and the walk reads the lines below from there.
      if (!opensListMarker(line, boxEnd)) return [end, boxEnd]
      end = boxEnd
    }
    at = end
  }
}

/**
 * Columns a marker line's task box adds before `column`. The ownership walk reads a task item's
 * follower lines from the box's column, so measured in the `rootLines` frame the box takes none.
 */
export function taskBoxColumns(line: string, column: number, box = markerLineTaskBox(line)): number {
  if (!box) return 0
  const end = columnAt(line, box[1])
  return end > column ? 0 : end - columnAt(line, box[0])
}
