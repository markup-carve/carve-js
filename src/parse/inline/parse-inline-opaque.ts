import { parseAttrs, isValidInlineAttrPayload, isEmptyAttrs } from '../../extension/attribute-parser.js'
import { crossrefBodyCanEnd, RE_AUTOLINK_STICKY, type CrossrefMemo } from './parse-brackets.js'
import { extendsGrapheme } from '../../grapheme-extender.js'
import { isCarveWhitespace } from '../../trim-non-nbsp.js'

// Raw inline passthrough tag, follows a verbatim span: `` `…`{=html} ``.
export const RE_RAW_INLINE = /^\{=([a-zA-Z][\w-]*)\}/
export const RE_INLINE_ATTR = /^\{((?:[^}"'\n]|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')+)\}/

// Suffix-existence tables used to skip the inline tail regexes when their
// mandatory close delimiter is absent from the rest of the input. Each tail
// pattern (the link tail, RE_SPAN_TAIL, the critic and forced-emphasis
// patterns) requires a specific literal (`)`, `}`, `+}`, `-}`) inside its
// match; if no such literal occurs at or after the position where the regex
// would be anchored, the regex CANNOT match, so running it is pure wasted work.
// Without this guard those patterns backtrack to end-of-input at O(n) distinct
// positions — quadratic on adversarial runs like `![x](`×n, `[x](`×n or
// `{+`×n. `suf[k] === 1` iff the delimiter occurs at some index >= k; built in
// one backward O(n) pass, so each guard is O(1). Skipping only ever elides a
// call that would have failed, keeping output byte-identical.
export function suffixHasChar(s: string, ch: string): Uint8Array {
  const n = s.length
  const suf = new Uint8Array(n + 1)
  let seen = 0
  for (let k = n - 1; k >= 0; k--) {
    if (s[k] === ch) seen = 1
    suf[k] = seen
  }
  return suf
}

export function suffixHasPair(s: string, a: string, b: string): Uint8Array {
  const n = s.length
  const suf = new Uint8Array(n + 1)
  let seen = 0
  for (let k = n - 1; k >= 0; k--) {
    if (s[k] === a && s[k + 1] === b) seen = 1
    suf[k] = seen
  }
  return suf
}

// Reject invalid attribute tokens before running a full tail match. Cached
// quoted and unquoted value ends avoid rescanning values at later candidates.
// The attribute parser remains authoritative for candidates reaching `}`.
// Whitespace RE_SPAN_TAIL content may contain: PART 7's four characters except
// `\n` (which its class `[^}"'\n]` excludes). Matches isValidAttrPayload's
// separator run on those chars, and it has to: this is the FAST PATH for the
// same production, so a wider class here declares a payload valid that the
// regex then rejects. It was `[^\S\n]`, and the two disagreed on a vertical
// tab, a form feed, NBSP and every Unicode space.
const WS_NO_NL = /[ \t\r]/
function isIdentStart(c: string): boolean {
  return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c === '_'
}
function isCssIdentStart(c: string): boolean {
  return isIdentStart(c) || (c >= '0' && c <= '9')
}
function isIdentPart(c: string): boolean {
  return isIdentStart(c) || (c >= '0' && c <= '9') || c === '-'
}
/** ASCII letter or digit, the only characters a BCP 47 subtag may hold. */
function isAsciiAlphanumeric(c: string): boolean {
  return /^[A-Za-z0-9]$/.test(c)
}

export function spanAttrProvablyInvalid(text: string, brace: number, quoteEnd: (start: number) => number, valueEnd: (start: number) => number): boolean {
  const n = text.length
  let i = brace + 1
  while (i < n) {
    const c = text[i]!
    // A candidate close at a token boundary: let the real regex decide/parse.
    if (c === '}') return false
    // A newline is the ONLY whitespace RE_SPAN_TAIL's content class excludes
    // (`[^}"'\n]`), so it ends the content run — defer (the regex stops here, no
    // far scan). Every OTHER `\s` (space, tab, NBSP, other Unicode spaces) is a
    // valid token separator for isValidAttrPayload's `\s+`, so skip it.
    if (c === '\n') return false
    if (WS_NO_NL.test(c)) {
      i++
      continue
    }
    // Quotes and escapes cannot begin an attribute token.
    if (c === '"' || c === "'" || c === '\\') return true
    if (c === '#' || c === '.') {
      // `#id` / `.class`: an explicit CSS identifier (letter, digit or `_`,
      // then `[\w-]`) MUST
      // follow, else the token — and the whole payload — is invalid (§14).
      const d = text[i + 1]
      if (d === undefined || !isCssIdentStart(d)) return true
      i += 2
      while (i < n && isIdentPart(text[i]!)) i++
      continue
    }
    if (c === ':') {
      // `{:TAG}` (and the empty `{:}`) is the language attribute, sugar for
      // `lang=TAG`. It is the THIRD place the attribute grammar is spelled -
      // `parseAttrs`'s `re` and `isValidAttrPayload`'s strip are the other two -
      // and the three move together or this fast path rejects a payload the
      // regexes accept, which is silent: the span simply never forms.
      i++
      while (i < n && (isAsciiAlphanumeric(text[i]!) || text[i] === '-')) i++
      continue
    }
    if (isIdentStart(c)) {
      // A bareword: a boolean attribute, or the name of a `key=value`.
      i++
      while (i < n && isIdentPart(text[i]!)) i++
      if (text[i] === '=') {
        const v = text[i + 1]
        // An empty value leaves a dangling `=`. For any other candidate,
        // defer to the value regex, which checks quoting and delimiters.
        if (v === undefined || v === '}' || isCarveWhitespace(v)) {
          return true
        }
        if (v === '"' || v === "'") {
          const end = quoteEnd(i + 1)
          if (end < 0) return true
          i = end + 1
          continue
        }
        const end = valueEnd(i + 1)
        if (end === i + 1) return true
        i = end
        continue
      }
      continue
    }
    // Any other character cannot begin a valid attribute token at a boundary
    // (`[`, `{`, `(`, a digit, `-`, `+`, `=`, `,`, …): the payload is invalid.
    return true
  }
  // Ran off the end without a closing `}`: RE_SPAN_TAIL would fail too.
  return true
}

/** Record opaque inline spans and extend `codeEnds` through raw-format tails. */
export function inlineOpaqueEnds(text: string, codeEnds: Int32Array | undefined, destinations: Map<number, number>, lineComments: Map<number, number>, attributeTails: Map<number, number>, brackets: ((at: number) => number | undefined) | undefined): Map<number, number> {
  if (codeEnds) {
    for (let at = 0; at < text.length; at++) {
      const end = codeEnds[at]!
      if (end >= 0 && text[end] === '{') {
        const raw = RE_RAW_INLINE.exec(text.slice(end))
        if (raw) codeEnds[at] = end + raw[0].length
      }
    }
  }
  const ends = new Map<number, number>()
  const labels: number[] = []
  let lastLabelClose = -1
  let crossrefs: CrossrefMemo | undefined
  const lastComment = text.lastIndexOf('%}')
  const lastEditorial = text.lastIndexOf('#}')
  const nextComments = new Map<string, number>()
  let valueStops: Int32Array | undefined
  const valueEnd = (start: number): number => {
    if (!valueStops) {
      valueStops = new Int32Array(text.length + 1)
      valueStops[text.length] = text.length
      for (let at = text.length - 1; at >= 0; at--) {
        valueStops[at] = /[}|"'\\ \t\n\r]/.test(text[at]!) ? at : valueStops[at + 1]!
      }
    }
    return valueStops[start]!
  }
  // Where a construct that takes an attribute run ends (CARVE-P4-002): a run
  // anywhere else attaches to nothing, so it is text and hides no closer.
  const constructEnds = new Set<number>()
  // Per delimiter, the last index before each position where it can open.
  const openers = new Map<string, Int32Array>()
  const openerBefore = (d: string, at: number): number => {
    let table = openers.get(d)
    if (!table) {
      table = new Int32Array(text.length + 1).fill(-1)
      // A `{X` with no `X}` after it forms nothing, so its `{` is text (CARVE-P9-043).
      const lastBraced = text.lastIndexOf(`${d}}`)
      for (let i = 0; i < text.length; i++) {
        const prev = text[i - 1]
        const next = text[i + 1]
        const opens = text[i] === d && next !== undefined && !isCarveWhitespace(next) && next !== d && prev !== d && (prev !== '{' || lastBraced <= i)
          && (prev === undefined || !/[\p{L}\p{N}]/u.test(prev))
        table[i + 1] = opens ? i : table[i]!
      }
      openers.set(d, table)
    }
    return table[at]!
  }
  // Per marker, the `X}` closers that pair with an earlier `{X` opener.
  const bracedClosers = new Map<string, Set<number>>()
  const closesBraced = (d: string, closer: number): boolean => {
    let closers = bracedClosers.get(d)
    if (!closers) {
      closers = new Set()
      const opens: number[] = []
      for (let i = 0; i < text.length; i++) {
        if (text[i] === '\\') i++
        else if (text[i] === '{' && text[i + 1] === d) { opens.push(i); i++ }
        else if (text[i] === d && text[i + 1] === '}' && opens.length && opens.at(-1)! + 2 < i) { opens.pop(); closers.add(i) }
      }
      bracedClosers.set(d, closers)
    }
    return closers.has(closer)
  }
  // The last `{~` opener and the last `~>` before each position.
  let tildes: { open: Int32Array; arrow: Int32Array } | undefined
  const attached = (at: number): boolean => {
    if (constructEnds.has(at) || (at > 0 && lastLabelClose === at - 1)) return true
    const before = text[at - 1]
    if (before === undefined) return false
    if (before === '}') {
      const marker = text[at - 2]
      if (marker === undefined || !'*_/~^,=+-'.includes(marker)) return false
      if (!closesBraced(marker, at - 2)) return false
      // A substitution takes no attribute run (CARVE-P3-017).
      if (marker === '~') {
        if (!tildes) {
          const open = new Int32Array(text.length + 1).fill(-1)
          const arrow = new Int32Array(text.length + 1).fill(-1)
          for (let i = 0; i < text.length; i++) {
            open[i + 1] = text[i] === '{' && text[i + 1] === '~' ? i : open[i]!
            arrow[i + 1] = text[i] === '~' && text[i + 1] === '>' ? i : arrow[i]!
          }
          tildes = { open, arrow }
        }
        const open = tildes.open[at - 2]!
        return open === -1 || tildes.arrow[at - 3]! < open + 2
      }
      return true
    }
    if (before === ':') return /:[A-Za-z0-9+-][A-Za-z0-9_+-]*:$/.test(text.slice(Math.max(0, at - 66), at))
    if (!'*_/~^,='.includes(before)) return false
    // A bare closer follows a non-space and closes an opener that can open.
    const inner = text[at - 2]
    if (inner === undefined || isCarveWhitespace(inner) || inner === before || inner === '{') return false
    return openerBefore(before, at - 2) !== -1
  }
  let quoteStops: { double: Int32Array; single: Int32Array } | undefined
  const quoteEnd = (start: number): number => {
    if (!quoteStops) {
      const double = new Int32Array(text.length + 2).fill(-1)
      const single = new Int32Array(text.length + 2).fill(-1)
      for (let at = text.length - 1; at >= 0; at--) {
        if (text[at] === '\\') {
          if (at + 1 < text.length && !/[\n\r\u2028\u2029]/.test(text[at + 1]!)) {
            double[at] = double[at + 2]!
            single[at] = single[at + 2]!
          }
        } else {
          double[at] = text[at] === '"' ? at : double[at + 1]!
          single[at] = text[at] === "'" ? at : single[at + 1]!
        }
      }
      quoteStops = { double, single }
    }
    return (text[start] === '"' ? quoteStops.double : quoteStops.single)[start + 1]!
  }
  for (let at = 0; at < text.length; at++) {
    while (labels.length && labels.at(-1)! <= at) lastLabelClose = labels.pop()!
    if (text[at] === '[') { const close = brackets?.(at); if (close !== undefined) labels.push(close) }
    if (text[at] === '\\') { at++; continue }
    const destinationEnd = destinations.get(at)
    if (destinationEnd !== undefined) constructEnds.add(destinationEnd + 1)
    const protectedEnd = destinationEnd ?? (text[at] === '`' && (codeEnds?.[at] ?? -1) !== -1 ? codeEnds![at] : undefined)
    if (protectedEnd !== undefined) { constructEnds.add(protectedEnd); at = protectedEnd - 1; continue }
    if (text.startsWith('%%', at) && (at === 0 || /[ \n]/.test(text[at - 1]!) || text[at - 1] === '[' && brackets?.(at - 1) !== undefined)) {
      const newline = text.indexOf('\n', at)
      const end = Math.min(newline === -1 ? text.length : newline, labels.at(-1) ?? text.length)
      lineComments.set(at, end)
      at = end - 1
      continue
    }
    if (text[at] === '<') {
      if (text.startsWith('</#', at) && text[at + 3] !== '>') {
        crossrefs ??= { lastCloser: text.lastIndexOf('>') }
        if (crossrefBodyCanEnd(text, at + 3, crossrefs)) {
          const end = text.indexOf('>', at + 3) + 1
          ends.set(at, end)
          at = end - 1
          continue
        }
      }
      RE_AUTOLINK_STICKY.lastIndex = at
      const autolink = RE_AUTOLINK_STICKY.exec(text)
      if (autolink) { ends.set(at, at + autolink[0].length); constructEnds.add(at + autolink[0].length); at += autolink[0].length - 1; continue }
    }
    if (text[at] === '{' && text[at + 1] === '#' && lastLabelClose === at - 1 && !spanAttrProvablyInvalid(text, at, quoteEnd, valueEnd)) {
      const attribute = RE_INLINE_ATTR.exec(text.slice(at))
      if (attribute && isValidInlineAttrPayload(attribute[1]!) && !isEmptyAttrs(parseAttrs(attribute[1]!))) {
        ends.set(at, at + attribute[0].length)
        attributeTails.set(at, at + attribute[0].length)
        at += attribute[0].length - 1
        continue
      }
    }
    if (text[at] === '{' && (text[at + 1] === '%' || text[at + 1] === '#') && !extendsGrapheme(text, at + 2)) {
      const marker = text[at + 1]!
      const last = marker === '%' ? lastComment : lastEditorial
      let close = nextComments.get(marker) ?? -1
      if (close < at + 2) {
        close = last >= at + 2 ? text.indexOf(`${marker}}`, at + 2) : -1
        nextComments.set(marker, close)
      }
      const prefix = marker === '#' && attached(at) && !spanAttrProvablyInvalid(text, at, quoteEnd, valueEnd) ? RE_INLINE_ATTR.exec(text.slice(at)) : null
      const prefixEnd = prefix && isValidInlineAttrPayload(prefix[1]!) && !isEmptyAttrs(parseAttrs(prefix[1]!)) ? at + prefix[0].length : undefined
      if (prefixEnd !== undefined) attributeTails.set(at, prefixEnd)
      if (close !== -1 && (marker === '%' || close > at + 2)) {
        ends.set(at, close + 2)
        at = (prefixEnd ?? close + 2) - 1
        continue
      }
    }
    if (text[at] !== '{' || !attached(at) || spanAttrProvablyInvalid(text, at, quoteEnd, valueEnd)) continue
    const match = RE_INLINE_ATTR.exec(text.slice(at))
    if (match && isValidInlineAttrPayload(match[1]!) && !isEmptyAttrs(parseAttrs(match[1]!))) {
      ends.set(at, at + match[0].length)
      attributeTails.set(at, at + match[0].length)
      constructEnds.add(at + match[0].length)
      at += match[0].length - 1
    }
  }
  return ends
}
