// The text after the run of a fence or div opener (C2-B-117, C2-B-119): an optional word (the
// language, the name or the sigil), an optional quoted title and an optional label in brackets.
// Read on demand, not by the block pass. The label of a definition is read the same way.
import {
  BACKSLASH, BACKTICK, BRACKET_CLOSE, BRACKET_OPEN, CARET, CR, DOT, EQUALS, GREATER, HASH, LF, PIPE, PLUS, QUOTE_MARK, SLASH, SPACE,
  STAR,
} from './chars.ts'
import { quotedEnd, skipSpaces } from './lines.ts'
import { isSpaceOrTab } from './source.ts'
import { isAsciiLetter, isAsciiNameCharacter } from './unicode.ts'

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

/** `language_word` of data/line-shapes.json (C2-B-117): the name characters and `#`, `+`, `.` and `/`. */
function isLanguageCharacter(code: number): boolean {
  return isAsciiNameCharacter(code) || code === HASH || code === PLUS || code === DOT || code === SLASH
}

/** The end of the sigil at `p`, or `p` (C2-B-196): `>`, a backslash or `|`, then a space, a tab or the line end. */
function sigilEnd(src: string, p: number, end: number): number {
  const code = src.charCodeAt(p)
  if (code !== GREATER && code !== BACKSLASH && code !== PIPE) return p
  return p + 1 === end || isSpaceOrTab(src.charCodeAt(p + 1)) ? p + 1 : p
}

/**
 * The end of the word at `p`: the longest run of the characters its shape allows (C2-B-116, C2-B-117,
 * C2-B-119), so a character outside the set starts the further words (C2-B-105, C2-B-122).
 */
function wordEnd(src: string, p: number, end: number, fence: boolean): number {
  if (!fence) {
    const sigil = sigilEnd(src, p, end)
    if (sigil > p) return sigil
  } else if (src.charCodeAt(p) === EQUALS && isAsciiLetter(src.charCodeAt(p + 1))) {
    // C2-B-116 names no character set for the format; this is the name of raw inline (C2-I-021).
    let at = p + 2
    while (at < end && isAsciiNameCharacter(src.charCodeAt(at))) at++
    return at
  }
  const inWord = fence ? isLanguageCharacter : isAsciiNameCharacter
  let at = p
  while (at < end && inWord(src.charCodeAt(at))) at++
  return at
}

/** Reads the word at `p` into `info` and returns the offset behind it, or `p` when there is none. */
function readWord(src: string, p: number, end: number, info: OpenerInfo, fence: boolean): number {
  if (p >= end) return p
  const after = wordEnd(src, p, end, fence)
  if (after === p) return p
  info.wordStart = p
  info.wordEnd = after
  return after
}

/** Reads the quoted title at `p` into `info` and returns the offset behind it, or `p` when there is none. */
function readTitle(src: string, p: number, end: number, info: OpenerInfo): number {
  if (p >= end || src.charCodeAt(p) !== QUOTE_MARK) return p
  const after = quotedEnd(src, p, end)
  if (after < 0) return p
  info.titleStart = p + 1
  info.titleEnd = after - 1
  return after
}

/** Reads the bracketed label at `p` into `info` and returns the offset behind it, or `p` when there is none. */
function readLabel(src: string, p: number, end: number, info: OpenerInfo): number {
  if (p >= end || src.charCodeAt(p) !== BRACKET_OPEN) return p
  const close = labelClose(src, p, end)
  if (close < 0) return p
  info.labelStart = p + 1
  info.labelEnd = close
  return close + 1
}

/**
 * Where the next part may start after a part read from `start` to `after`: behind the spaces after
 * it, or `start` itself when there was no part. A part glued to what follows it gives `-after - 1`.
 */
function partEnd(src: string, start: number, after: number, end: number): number {
  if (after === start) return start
  const next = skipSpaces(src, after, end)
  return next > after || after === end ? next : -after - 1
}

/**
 * Reads the opener line from `pos`, the offset behind the run. The parts stand in order and spaces
 * separate them: what is glued to a part, or follows the parts, is further words (C2-B-122).
 */
export function readOpenerInfo(src: string, pos: number): OpenerInfo {
  let end = pos
  while (end < src.length && src.charCodeAt(end) !== LF) end++
  // C2-B-010: a lone CR is content; only the CR of a CR LF ends the line.
  if (end < src.length && end > pos && src.charCodeAt(end - 1) === CR) end--
  const info: OpenerInfo = {
    wordStart: -1, wordEnd: -1, titleStart: -1, titleEnd: -1, labelStart: -1, labelEnd: -1, extra: false, extraStart: -1,
  }
  // C2-B-117, `code_fence_opener`: at most one space stands before the first part of a fence; one or more before a div's.
  const fence = src.charCodeAt(pos - 1) === BACKTICK
  let p = fence ? (src.charCodeAt(pos) === SPACE ? pos + 1 : pos) : skipSpaces(src, pos, end)
  p = partEnd(src, p, readWord(src, p, end, info, fence), end)
  if (p >= 0) p = partEnd(src, p, readTitle(src, p, end, info), end)
  if (p >= 0) p = partEnd(src, p, readLabel(src, p, end, info), end)
  const rest = p >= 0 ? p : -p - 1
  info.extra = rest < end
  if (info.extra) info.extraStart = rest
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

/** The word of the opener whose run ends at `pos`: a fence language, a raw format with its `=`, a div name or a sigil. */
export function openerWord(src: string, pos: number): string {
  const info = readOpenerInfo(src, pos)
  return info.wordStart < 0 ? '' : src.slice(info.wordStart, info.wordEnd)
}
