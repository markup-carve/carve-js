// The two shapes of named snippets: the definition marker `{$name}:` (C2-B-236) and the use `{{ $name }}`
// (C2-I-128, C2-B-237). The block pass, the inline scan, the writer and lint all read them here.
import { readAttributeBlock, emptyMemo, type AttributeSink } from './attributes.ts'
import { BRACE_CLOSE, BRACE_OPEN, COLON, CR, DOLLAR, HYPHEN, SPACE, TAB, UNDERSCORE } from './chars.ts'
import { isAttributeLine } from './lines.ts'
import { isAsciiDigit, isAsciiLetter } from './unicode.ts'

const NONE = -1

/** The parts of a definition line: the name, the end of the marker (behind `:`) and whether the marker holds an id. */
export interface SnippetMarker {
  nameStart: number
  nameEnd: number
  markerEnd: number
  hasId: boolean
}

function isNameFirst(code: number): boolean {
  return isAsciiLetter(code) || isAsciiDigit(code) || code === UNDERSCORE
}

/** C2-B-236: the end of the snippet name at `pos`, or NONE. */
export function snippetNameEnd(src: string, pos: number, end: number): number {
  if (pos >= end || !isNameFirst(src.charCodeAt(pos))) return NONE
  let p = pos + 1
  while (p < end && (isNameFirst(src.charCodeAt(p)) || src.charCodeAt(p) === HYPHEN)) p++
  return p
}

/** C2-B-236: whether `text` is a snippet name. */
export function isSnippetName(text: string): boolean {
  return snippetNameEnd(text, 0, text.length) === text.length
}

const ID_SINK = (found: { id: boolean }): AttributeSink => ({
  id: () => { found.id = true },
  className: () => {},
  lang: () => {},
  key: (key) => { if (key.toLowerCase() === 'id') found.id = true },
})

/**
 * C2-B-236: the snippet marker at `pos`, `{$`, a name, optionally spaces and attribute parts, `}`, glued attribute
 * blocks and `:`, or null. A marker that holds an id is returned with `hasId`: it makes no definition.
 */
export function readSnippetMarker(src: string, pos: number, end: number): SnippetMarker | null {
  if (src.charCodeAt(pos) !== BRACE_OPEN || src.charCodeAt(pos + 1) !== DOLLAR) return null
  const nameEnd = snippetNameEnd(src, pos + 2, end)
  if (nameEnd === NONE) return null
  const found = { id: false }
  const sink = ID_SINK(found)
  const memo = emptyMemo()
  let p = nameEnd
  if (src.charCodeAt(p) === SPACE) {
    // The parts after the name read as the inside of an attribute block whose brace is the last name character.
    const after = readAttributeBlock(src, nameEnd - 1, end, memo, sink)
    if (after === NONE) return null
    p = after
  } else if (src.charCodeAt(p) === BRACE_CLOSE) {
    p++
  } else {
    return null
  }
  while (p < end && src.charCodeAt(p) === BRACE_OPEN) {
    const after = readAttributeBlock(src, p, end, memo, sink)
    if (after === NONE) return null
    p = after
  }
  if (p >= end || src.charCodeAt(p) !== COLON) return null
  return { nameStart: pos + 2, nameEnd, markerEnd: p + 1, hasId: found.id }
}

/**
 * C2-B-236: whether the attribute lines between `pos` and `end` hold an id, which refuses the definition below them. Only
 * attribute lines are read: a comment line between them holds no attributes.
 */
export function attributeLinesHoldId(src: string, pos: number, end: number): boolean {
  const found = { id: false }
  const sink = ID_SINK(found)
  for (let line = pos; line < end && !found.id;) {
    let lineEnd = src.indexOf('\n', line)
    if (lineEnd < 0 || lineEnd > end) lineEnd = end
    const next = lineEnd + 1
    if (lineEnd > line && src.charCodeAt(lineEnd - 1) === CR) lineEnd--
    if (isAttributeLine(src, line, lineEnd)) {
      const memo = emptyMemo()
      for (let p = line; p < lineEnd && src.charCodeAt(p) === BRACE_OPEN;) p = readAttributeBlock(src, p, lineEnd, memo, sink)
    }
    line = next
  }
  return found.id
}

/**
 * C2-B-236: the start of the value of the snippet definition whose line is `[pos, end)`, or NONE: a marker without
 * an id, one space, and a value that holds a character other than a space or a tab.
 */
export function snippetValueStart(src: string, end: number, marker: SnippetMarker | null): number {
  if (marker === null || marker.hasId) return NONE
  const at = marker.markerEnd
  if (at >= end || src.charCodeAt(at) !== SPACE) return NONE
  for (let p = at + 1; p < end; p++) {
    const code = src.charCodeAt(p)
    if (code !== SPACE && code !== TAB) return at + 1
  }
  return NONE
}

/** C2-I-128: the offset behind the snippet use at `pos`, `{{`, spaces, `$`, a name, spaces and `}}`, or NONE. */
export function snippetUseEnd(src: string, pos: number, end: number): number {
  if (src.charCodeAt(pos) !== BRACE_OPEN || src.charCodeAt(pos + 1) !== BRACE_OPEN) return NONE
  let p = pos + 2
  while (p < end && src.charCodeAt(p) === SPACE) p++
  if (p === pos + 2 || src.charCodeAt(p) !== DOLLAR) return NONE
  const nameEnd = snippetNameEnd(src, p + 1, end)
  if (nameEnd === NONE) return NONE
  p = nameEnd
  while (p < end && src.charCodeAt(p) === SPACE) p++
  if (p === nameEnd || src.charCodeAt(p) !== BRACE_CLOSE || src.charCodeAt(p + 1) !== BRACE_CLOSE) return NONE
  return p + 2
}

/** The name of the snippet use that starts at `pos` and is known to be one. */
export function snippetUseName(src: string, pos: number): string {
  const dollar = src.indexOf('$', pos)
  return src.slice(dollar + 1, snippetNameEnd(src, dollar + 1, src.length))
}

/** C2-B-237: whether the line `[pos, end)` is a block snippet use: a use with only spaces and tabs after it. */
export function isBlockSnippetUse(src: string, pos: number, end: number): boolean {
  const after = snippetUseEnd(src, pos, end)
  if (after === NONE) return false
  for (let p = after; p < end; p++) {
    const code = src.charCodeAt(p)
    if (code !== SPACE && code !== TAB) return false
  }
  return true
}

/** The source spelling of a use, as a use that was not expanded is written (C2-N-093). */
export function snippetUseSpelling(name: string): string {
  return `{{ $${name} }}`
}
