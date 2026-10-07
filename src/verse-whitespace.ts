import { trimEndMatchingEdges } from './trim-non-nbsp.js'

/** Whether UTF-16 index `i` opens a surrogate pair: one codepoint, two units. */
function isAstralAt(line: string, i: number): boolean {
  const high = line.charCodeAt(i)
  if (high < 0xd800 || high > 0xdbff) return false
  const low = line.charCodeAt(i + 1)
  return low >= 0xdc00 && low <= 0xdfff
}

/**
 * Preserve verse gaps with NUL placeholders, recording generated tab columns.
 * Callers must pass an offsets array for any line containing a tab.
 */
export function expandLineBlockWhitespace(line: string, sourceOffsets?: Array<number | undefined>): string {
  if (sourceOffsets === undefined) {
    return line.replace(/(^ +| {2,})/g, (spaces) => '\0'.repeat(spaces.length))
  }
  let out = ''
  let i = 0
  let column = 0
  let seenContent = false
  while (i < line.length) {
    const ch = line[i]
    if (ch !== ' ' && ch !== '\t') {
      // A column counts CODEPOINTS, so a surrogate pair advances the tab stop
      // by one. The offsets stay per code unit: the caller indexes them with
      // UTF-16 positions and `toCodepointPositions` converts the result.
      const start = i
      do {
        const units = isAstralAt(line, i) ? 2 : 1
        for (let unit = 0; unit < units; unit++) sourceOffsets.push(i + unit)
        column++
        i += units
      } while (i < line.length && line[i] !== ' ' && line[i] !== '\t')
      out += line.slice(start, i)
      seenContent = true
      continue
    }
    const sourceStart = i
    let width = 0
    while (i < line.length && (line[i] === ' ' || line[i] === '\t')) {
      if (line[i] === '\t') width += 4 - ((column + width) % 4)
      else width++
      i++
    }
    column += width
    const rewritten = !seenContent || width >= 2 ? '\0'.repeat(width) : ' '
    const hasTab = line.slice(sourceStart, i).includes('\t')
    for (let column = 0; column < rewritten.length; column++) {
      sourceOffsets.push(hasTab ? undefined : sourceStart + column)
    }
    out += rewritten
  }

  return out
}

/** Trim after expansion so alignment checks can use the untrimmed length. */
export function dropTrailingSpaces(line: string): string {
  return trimEndMatchingEdges(line, (code) => code === 32)
}

export interface VerseSourceLine {
  sourceOffsets: Array<number | undefined> | undefined
  sourceLength: number
}

/** Resolve identity columns or an explicit tab map to source UTF-16 offsets. */
export function verseSourceOffset(line: VerseSourceLine | undefined, index: number): number | undefined {
  return line?.sourceOffsets ? line.sourceOffsets[index]
    : line && index >= 0 && index < line.sourceLength ? index : undefined
}

/** Restore generated gaps in strings, including values returned by extensions. */
export function restoreVerseGaps(value: unknown): void {
  if (!value || typeof value !== 'object') return
  const record = value as Record<string, unknown>
  for (const key of Object.keys(record)) {
    const child = record[key]
    if (typeof child === 'string') {
      if (child.includes('\0')) record[key] = child.replace(/\0/g, '\u00a0')
    } else if (child !== null && typeof child === 'object') {
      restoreVerseGaps(child)
    }
  }
}
