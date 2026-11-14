// The grammar of an attribute block (C2-I-028 to C2-I-034). The scan reads a block to see that
// it is valid; the tree reads it again with a sink that takes its parts.
import { APOSTROPHE, BACKSLASH, BRACE_CLOSE, BRACE_OPEN, COLON, DOT, EQUALS, HASH, HYPHEN, LF, QUOTE_MARK, SPACE } from './chars.ts'
import {
  CHARACTER_CLASSES, CLASS_BARE_KEY_FIRST, CLASS_KEY_FIRST, CLASS_KEY_REST, CLASS_LANGUAGE, CLASS_NAME, CLASS_VALUE_END,
} from './inline-tables.ts'
import { isAsciiPunctuation } from './unicode.ts'

const NONE = -1
const ASCII = 128

/** Offsets up to which a search for the end of a value has already failed, so no opener repeats it. */
export interface AttributeMemo {
  doubleQuoteFailEnd: number
  singleQuoteFailEnd: number
  valueFailEnd: number
}

/** A memo with no failed read yet. Its offsets belong to one source, so a memo is never shared between sources. */
export function emptyMemo(): AttributeMemo {
  return { doubleQuoteFailEnd: -1, singleQuoteFailEnd: -1, valueFailEnd: -1 }
}

export interface AttributeSink {
  id(name: string): void
  className(name: string): void
  language(tag: string): void
  key(key: string, value: string): void
}

function inClass(code: number, mask: number): boolean {
  return code < ASCII && (CHARACTER_CLASSES[code]! & mask) !== 0
}

function skipSpaces(text: string, pos: number, end: number): number {
  while (pos < end && text.charCodeAt(pos) === SPACE) pos++
  return pos
}

/** End of the run of characters of the class `mask` that starts at `pos`. */
export function classRunEnd(text: string, pos: number, end: number, mask: number): number {
  while (pos < end && inClass(text.charCodeAt(pos), mask)) pos++
  return pos
}

/** C2-I-028: the offset behind the closing brace of the valid block at `pos`, or NONE. */
export function readAttributeBlock(text: string, pos: number, end: number, memo: AttributeMemo, sink: AttributeSink | null): number {
  let p = skipSpaces(text, pos + 1, end)
  for (let parts = 0; p < end; parts++) {
    if (text.charCodeAt(p) === BRACE_CLOSE) return parts > 0 ? p + 1 : NONE
    const after = readPart(text, p, end, memo, sink)
    if (after === NONE) return NONE
    p = skipSpaces(text, after, end)
    // C2-I-034: a part ends at a space or at the closing brace.
    if (p === after && p < end && text.charCodeAt(p) !== BRACE_CLOSE) return NONE
  }
  return NONE
}

/** C2-I-040: the offset behind the block with no part at `pos`, or NONE. */
export function emptyBlockEnd(text: string, pos: number, end: number): number {
  if (pos >= end || text.charCodeAt(pos) !== BRACE_OPEN) return NONE
  const p = skipSpaces(text, pos + 1, end)
  return p < end && text.charCodeAt(p) === BRACE_CLOSE ? p + 1 : NONE
}

/** C2-I-029: one part. Returns the offset behind it, or NONE. */
function readPart(text: string, pos: number, end: number, memo: AttributeMemo, sink: AttributeSink | null): number {
  const code = text.charCodeAt(pos)
  if (code === HASH || code === DOT) {
    const after = classRunEnd(text, pos + 1, end, CLASS_NAME)
    if (after === pos + 1) return NONE
    if (sink !== null && code === HASH) sink.id(text.slice(pos + 1, after))
    if (sink !== null && code === DOT) sink.className(text.slice(pos + 1, after))
    return after
  }
  if (code === COLON) return readLanguage(text, pos + 1, end, sink)
  return readKey(text, pos, end, memo, sink)
}

/** C2-I-030: a language tag is empty or runs of letters and digits joined by single hyphens. */
function readLanguage(text: string, pos: number, end: number, sink: AttributeSink | null): number {
  let p = classRunEnd(text, pos, end, CLASS_LANGUAGE)
  while (p > pos && p < end && text.charCodeAt(p) === HYPHEN) {
    const after = classRunEnd(text, p + 1, end, CLASS_LANGUAGE)
    if (after === p + 1) return NONE
    p = after
  }
  if (sink !== null) sink.language(text.slice(pos, p))
  return p
}

/** The value behind the `=` at `equals` of the key `[pos, equals)`: quoted or bare. Returns the offset behind it, or NONE. */
function readValue(text: string, pos: number, equals: number, end: number, memo: AttributeMemo, sink: AttributeSink | null): number {
  const first = equals + 1 < end ? text.charCodeAt(equals + 1) : NONE
  if (first === QUOTE_MARK || first === APOSTROPHE) {
    const close = quotedValueEnd(text, equals + 1, end, memo)
    if (close === NONE) return NONE
    sink?.key(text.slice(pos, equals), unescape(text, equals + 2, close))
    return close + 1
  }
  const after = unquotedValueEnd(text, equals + 1, end, memo)
  if (after !== NONE) sink?.key(text.slice(pos, equals), text.slice(equals + 1, after))
  return after
}

function readKey(text: string, pos: number, end: number, memo: AttributeMemo, sink: AttributeSink | null): number {
  if (!inClass(text.charCodeAt(pos), CLASS_KEY_FIRST)) return NONE
  const keyEnd = classRunEnd(text, pos + 1, end, CLASS_KEY_REST)
  if (keyEnd < end && text.charCodeAt(keyEnd) === EQUALS) return readValue(text, pos, keyEnd, end, memo, sink)
  // C2-I-031: a bare key does not start with an underscore.
  if (!inClass(text.charCodeAt(pos), CLASS_BARE_KEY_FIRST)) return NONE
  sink?.key(text.slice(pos, keyEnd), '')
  return keyEnd
}

/** C2-I-033: the offset of the quote that closes the value whose opening quote is at `pos`, on the same line. */
function quotedValueEnd(text: string, pos: number, end: number, memo: AttributeMemo): number {
  const quote = text.charCodeAt(pos)
  if (pos < (quote === QUOTE_MARK ? memo.doubleQuoteFailEnd : memo.singleQuoteFailEnd)) return NONE
  let p = pos + 1
  for (; p < end; p++) {
    const code = text.charCodeAt(p)
    if (code === quote) return p
    if (code === LF) break
    if (code === BACKSLASH) p++
  }
  if (quote === QUOTE_MARK) memo.doubleQuoteFailEnd = p
  else memo.singleQuoteFailEnd = p
  return NONE
}

/** C2-I-032: the offset behind the unquoted value at `pos`, which ends at a space or at the closing brace. */
function unquotedValueEnd(text: string, pos: number, end: number, memo: AttributeMemo): number {
  if (pos < memo.valueFailEnd) return NONE
  let p = pos
  while (p < end && !inClass(text.charCodeAt(p), CLASS_VALUE_END) && text.charCodeAt(p) !== LF) p++
  const code = p < end ? text.charCodeAt(p) : NONE
  if (p > pos && (code === SPACE || code === BRACE_CLOSE)) return p
  if (code !== SPACE && code !== BRACE_CLOSE) memo.valueFailEnd = p
  return NONE
}

/** The text of `[start, end)` with each backslash before ASCII punctuation dropped (C2-I-010). */
export function unescape(text: string, start: number, end: number): string {
  let value = ''
  let from = start
  for (let p = start; p + 1 < end; p++) {
    if (text.charCodeAt(p) !== BACKSLASH || !isAsciiPunctuation(text.charCodeAt(p + 1))) continue
    value += text.slice(from, p)
    from = p + 1
    p++
  }
  return value + text.slice(from, end)
}
