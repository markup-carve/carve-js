// The text after the run of a fence or div opener (C2-B-117, C2-B-119): an optional word (the
// language, the name or the sigil), an optional quoted title and an optional label in brackets.
// Read on demand, not by the block pass. The label of a definition is read the same way.
import { BACKSLASH, BRACKET_CLOSE, BRACKET_OPEN, CARET, CR, LF, QUOTE_MARK, STAR } from './chars.ts'
import { quotedEnd, skipSpaces } from './lines.ts'
import { isSpaceOrTab } from './source.ts'

export interface OpenerInfo {
  wordStart: number
  wordEnd: number
  // The title without its quotes. Both are -1 when there is none.
  titleStart: number
  titleEnd: number
  // The label in brackets, without the brackets (C2-B-121). Both are -1 when there is none.
  labelStart: number
  labelEnd: number
  // Anything else on the line, which is a diagnostic; the block still opens (C2-B-122). -1 where there is none.
  extra: boolean
  extraStart: number
}

/** The offset of the first closing bracket after `p` on the line, or -1. A search to `end` keeps it linear. */
function labelClose(src: string, p: number, end: number): number {
  for (let at = p + 1; at < end; at++) if (src.charCodeAt(at) === BRACKET_CLOSE) return at
  return -1
}

/** C2-B-119: a title or a label may stand with no word before it. */
function startsLabel(src: string, p: number, end: number): boolean {
  return src.charCodeAt(p) === BRACKET_OPEN && labelClose(src, p, end) >= 0
}

/** Reads the word at `p` into `info` and returns the offset behind it and the spaces after it. */
function readWord(src: string, p: number, end: number, info: OpenerInfo): number {
  if (p >= end || src.charCodeAt(p) === QUOTE_MARK || startsLabel(src, p, end)) return p
  info.wordStart = p
  while (p < end && !isSpaceOrTab(src.charCodeAt(p))) p++
  info.wordEnd = p
  return skipSpaces(src, p, end)
}

/** Reads the quoted title at `p` into `info` and returns the offset behind it and the spaces after it. */
function readTitle(src: string, p: number, end: number, info: OpenerInfo): number {
  if (p >= end || src.charCodeAt(p) !== QUOTE_MARK) return p
  const after = quotedEnd(src, p, end)
  if (after < 0) return p
  info.titleStart = p + 1
  info.titleEnd = after - 1
  return skipSpaces(src, after, end)
}

/** Reads the bracketed label at `p` into `info` and returns the offset behind it and the spaces after it. */
function readLabel(src: string, p: number, end: number, info: OpenerInfo): number {
  if (p >= end || src.charCodeAt(p) !== BRACKET_OPEN) return p
  const close = labelClose(src, p, end)
  if (close < 0) return p
  info.labelStart = p + 1
  info.labelEnd = close
  return skipSpaces(src, close + 1, end)
}

/** Reads the opener line from `pos`, the offset behind the run. */
export function readOpenerInfo(src: string, pos: number): OpenerInfo {
  let end = pos
  while (end < src.length && src.charCodeAt(end) !== LF && src.charCodeAt(end) !== CR) end++
  const info: OpenerInfo = {
    wordStart: -1, wordEnd: -1, titleStart: -1, titleEnd: -1, labelStart: -1, labelEnd: -1, extra: false, extraStart: -1,
  }
  const p = readLabel(src, readTitle(src, readWord(src, skipSpaces(src, pos, end), end, info), end, info), end, info)
  info.extra = p < end
  if (info.extra) info.extraStart = p
  return info
}

/**
 * The label of the footnote, link or abbreviation definition that starts at `pos`, as the offsets
 * behind its opening bracket and of its closing bracket (C2-B-082 to C2-B-084). Which definition
 * of a label wins is decided at resolution (C2-B-085).
 */
export function definitionLabel(src: string, pos: number): [number, number] {
  let start = pos + 1
  const first = src.charCodeAt(pos)
  if (first === STAR || src.charCodeAt(start) === CARET) start++
  let end = start
  // C2-I-076: the label runs to the next bracket that no backslash escapes.
  while (src.charCodeAt(end) !== BRACKET_CLOSE) end += src.charCodeAt(end) === BACKSLASH ? 2 : 1
  return [start, end]
}
