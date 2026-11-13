// The text after the run of a fence or div opener (C2-B-085): an optional word (the language,
// the name or the sigil) and an optional quoted title. Read on demand, not by the block pass.
import { CR, LF, QUOTE_MARK } from './chars.ts'
import { quotedEnd, skipSpaces } from './lines.ts'
import { isSpaceOrTab } from './source.ts'

export interface OpenerInfo {
  wordStart: number
  wordEnd: number
  // The title without its quotes. Both are -1 when there is none.
  titleStart: number
  titleEnd: number
  // Anything else on the line, which is a diagnostic; the block still opens.
  extra: boolean
}

/** Reads the opener line from `pos`, the offset behind the run. */
export function readOpenerInfo(src: string, pos: number): OpenerInfo {
  let end = pos
  while (end < src.length && src.charCodeAt(end) !== LF && src.charCodeAt(end) !== CR) end++
  const info: OpenerInfo = { wordStart: -1, wordEnd: -1, titleStart: -1, titleEnd: -1, extra: false }
  let p = skipSpaces(src, pos, end)
  if (p < end && src.charCodeAt(p) !== QUOTE_MARK) {
    info.wordStart = p
    while (p < end && !isSpaceOrTab(src.charCodeAt(p))) p++
    info.wordEnd = p
    p = skipSpaces(src, p, end)
  }
  if (p < end && src.charCodeAt(p) === QUOTE_MARK) {
    const after = quotedEnd(src, p, end)
    if (after >= 0) {
      info.titleStart = p + 1
      info.titleEnd = after - 1
      p = skipSpaces(src, after, end)
    }
  }
  info.extra = p < end
  return info
}
