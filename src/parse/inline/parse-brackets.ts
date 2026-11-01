import { destinationSlotEnds } from '../../link-destination.js'
import { extendsGrapheme } from '../../grapheme-extender.js'

export const AUTOLINK_BODY_EXCLUDED = '\\p{White_Space}\\p{Cf}\\p{Cc}'

export const RE_AUTOLINK = new RegExp(
  '^<([a-zA-Z][a-zA-Z0-9+.\\-]*:[^>' +
    AUTOLINK_BODY_EXCLUDED +
    '<"\\\\`{}|^]+|[A-Za-z0-9._+\\-]+@[A-Za-z0-9._+\\-]+\\.[A-Za-z]+)>',
  'u',
)

// Resolve the verbatim (code) span opening at `i` (a backtick). The opener is
// the MAXIMAL run of backticks (`openLen`); it closes on a run of EXACTLY that
// length. An opener with no equal-length closer is opaque to the end of the
// string. `end` is the index just past the closing run, or text.length when
// unclosed; `closed` flags which. Shared by scanInline's tokenizer,
// findEmphasisClose, and buildBracketMap so all three agree on what a span hides.
export function verbatimSpanEnd(text: string, i: number): { end: number; closed: boolean; openLen: number } {
  let openLen = 1
  while (text[i + openLen] === '`') openLen++
  let k = i + openLen
  while (k < text.length) {
    if (text[k] === '`') {
      let m = 1
      while (text[k + m] === '`') m++
      if (m === openLen) return { end: k + openLen, closed: true, openLen }
      k += m
    } else {
      k++
    }
  }
  return { end: text.length, closed: false, openLen }
}

/** Check the written bracket boundary; scalar escape decoding is separate. */
export function rawBracketRunCloses(text: string): boolean {
  return buildBracketMap(`[${text}]`)(0) === text.length + 1
}

/** Image alt keeps delimited comments literal and editorial comments opaque. */
export function rawImageBracketRunCloses(text: string): boolean {
  const structural = new Set<number>()
  // The destination lets a `[^` alt read as the image it is written in.
  const close = buildBracketMap(`![${text}](u)`, false, structural)
  return close(1) === text.length + 2 && !close.footnotes?.has(1) && !structural.has(-1)
}

/** The start of the last maximal backtick run of each length. */
function lastBacktickRunStarts(s: string): Map<number, number> {
  const last = new Map<number, number>()
  for (let k = 0; k < s.length; k++) {
    if (s[k] !== '`') continue
    let m = 1
    while (s[k + m] === '`') m++
    last.set(m, k)
    k += m - 1
  }
  return last
}

/**
 * The balancing `]` of the `[` at an offset, or undefined. `footnotes` holds
 * each `[` after a `^` or `!` that closes as a footnote reference instead.
 */
export type BracketClose = ((open: number) => number | undefined) & {
  footnotes?: ReadonlySet<number>
  declinedImageAsLink?: (open: number) => number | undefined
}

/**
 * How many characters the per-bracket scans below may walk in one text, as a
 * multiple of its length. A DoS guard: past it an unanswered `[` stays
 * literal, the way carve-php caps its own scan.
 */
const BRACKET_RESCAN_BUDGET = 8

/**
 * Each `[`'s balancing `]`, scanned from the `[` itself (CARVE-P3-001): escape
 * aware, and blind to brackets inside a verbatim span or a delimited comment.
 *
 * One pass from the start of the text answers every `[` outside a closed
 * verbatim span. A `[` inside one is reached only when something else used the
 * span's opening run up, and from that `[` the run is not there, so it is
 * scanned from itself (carve-js#1815).
 */
export function buildBracketMap(
  s: string,
  outsideOnly = false,
  structural?: Set<number>,
  sharedSlots?: { first: number; ends?: Map<number, number> },
  // False inside an inline note, where no `[^` is a reference (PART 9 §16).
  footnoteRefs = true,
): BracketClose {
  const lastRunStart = s.includes('`') ? lastBacktickRunStarts(s) : new Map<number, number>()
  const closedRunEnd = (j: number, openLen: number): number | undefined =>
    (lastRunStart.get(openLen) ?? -1) >= j + openLen ? verbatimSpanEnd(s, j).end : undefined
  let lastDelimitedCommentClose: number | undefined
  let lastEditorialCommentClose: number | undefined
  const opaqueEnd = (j: number, inImageAlt: boolean): number | undefined => {
    if (s[j] !== '{' || (s[j + 1] !== '%' && s[j + 1] !== '#') || extendsGrapheme(s, j + 2)) return undefined
    if (inImageAlt && s[j + 1] === '%') return undefined
    const last = s[j + 1] === '%'
      ? (lastDelimitedCommentClose ??= s.lastIndexOf('%}'))
      : (lastEditorialCommentClose ??= s.lastIndexOf('#}'))
    if (last < j + 2) return undefined
    const close = s.indexOf(`${s[j + 1]}}`, j + 2)
    return close === -1 ? undefined : close + 2
  }
  // An autolink or cross-reference body resolves no escapes, so a `]` inside
  // it is content (CARVE-P3-001); its attribute block is not skipped.
  const hasAngle = s.includes('<')
  const crossrefs: CrossrefMemo = { lastCloser: hasAngle ? s.lastIndexOf('>') : -1 }
  const autolinkEnd = (j: number): number | undefined => {
    if (!hasAngle || s[j] !== '<') return undefined
    if (s.startsWith('</#', j) && s[j + 3] !== '>' && crossrefBodyCanEnd(s, j + 3, crossrefs)) return s.indexOf('>', j + 3) + 1
    RE_AUTOLINK_STICKY.lastIndex = j
    const m = RE_AUTOLINK_STICKY.exec(s)
    return m ? j + m[0].length : undefined
  }
  // A nested run's destination slot is content of the run around it, so a `]`
  // inside `(/u])` closes nothing (grammar `nested`/`altNested`, CARVE-P3-001).
  let slotEnds: Map<number, number> | undefined
  const nestedSlotEnd = (j: number): number | undefined => {
    if (s[j + 1] !== '(') return undefined
    if (sharedSlots) return (sharedSlots.ends ??= destinationSlotEnds(s, sharedSlots.first)).get(j + 1)
    return (slotEnds ??= destinationSlotEnds(s)).get(j + 1)
  }
  // The first `]` at or after each offset, or -1 where a newline comes first.
  let labelStops: Int32Array | undefined
  const stops = (): Int32Array => {
    if (labelStops !== undefined) return labelStops
    labelStops = new Int32Array(s.length + 1)
    labelStops[s.length] = -1
    for (let k = s.length - 1; k >= 0; k--) {
      const c = s[k]
      labelStops[k] = c === ']' ? k : c === '\n' || c === '\r' ? -1 : labelStops[k + 1]!
    }
    return labelStops
  }
  const footnoteLabelEnd = (j: number): number => {
    if (s[j + 1] !== '^') return -1
    const end = stops()[j + 2]!
    return end > j + 2 ? end : -1
  }
  // An inline note's content starts with `^`, so a closed one always forms. An
  // image needs a destination or a reference label after its alt.
  const ownerForms = (open: number, close: number): boolean => {
    if (s[open - 1] === '^') return true
    if (s[close + 1] === '(') return (slotEnds ??= destinationSlotEnds(s)).has(close + 1)
    return s[close + 1] === '[' && stops()[close + 2]! >= close + 2
  }
  let map = new Map<number, number>()
  // Closed verbatim spans the pass skipped, as [content start, end].
  let spans: Array<[number, number]> = []
  const hasFootnote = footnoteRefs && s.includes('[^')
  // `literal`: openers a first pass left unclosed. They are text, so a `[^`
  // after one is read at the top level, as the grammar does after it fails.
  // `demoted`: a note or image opener whose construct does not form.
  const owners: number[] = []
  const footnotes = new Set<number>()
  const walk = (structural: Set<number> | undefined, literal?: Set<number>, demoted?: Set<number>): number[] => {
    const unclosed: number[] = []
    const stack: number[] = []
    // Most inline runs have no image label. Avoid tracking its nesting there.
    const imageAlt: boolean[] | undefined = s.includes('![') ? [] : undefined
    let lastBang = -1
    let lastEscaped = -1
    for (let j = 0; j < s.length; j++) {
      const ch = s[j]
      if (ch !== '\\' && ch !== '`' && ch !== '{' && ch !== '<' &&
          ch !== '!' && ch !== '[' && ch !== ']') continue
      if (ch === '\\') {
        lastEscaped = ++j
        continue
      }
      // A `[` or `]` inside a verbatim span is literal text. An unclosed run
      // swallows every later `]` for a label opened before it.
      if (ch === '`') {
        let openLen = 1
        while (s[j + openLen] === '`') openLen++
        const spanEnd = closedRunEnd(j, openLen)
        if (spanEnd !== undefined) {
          spans.push([j + openLen, spanEnd])
          j = spanEnd - 1
        } else {
          structural?.add(-1)
          for (const open of stack) unclosed.push(open)
          stack.length = 0
          if (imageAlt) imageAlt.length = 0
          j += openLen - 1
        }
        continue
      }
      // A delimited or editorial comment is opaque: its content is discarded or
      // literal, so a `]` inside cannot close a label (carve#403). An unclosed
      // opener is not a comment and is left alone.
      const inImageAlt = imageAlt ? (imageAlt[imageAlt.length - 1] ?? false) : false
      const commentEnd = ch === '{' ? opaqueEnd(j, inImageAlt) : undefined
      if (commentEnd === undefined && ch === '{' && (s[j + 1] === '#' || (s[j + 1] === '%' && !inImageAlt))) structural?.add(-1)
      if (commentEnd !== undefined) {
        j = commentEnd - 1
        continue
      }
      const linkEnd = ch === '<' ? autolinkEnd(j) : undefined
      if (linkEnd !== undefined) {
        j = linkEnd - 1
        continue
      }
      if (imageAlt && ch === '!') lastBang = j
      // A `[^` run is a footnote reference before bracket scanning (PART 8), and
      // its label ends at the first `]`, so a `[` inside the label opens no run.
      // Inside an open run the grammar's `nested` reads it as brackets instead,
      // and after a bare `^` or `!` the `[` opens an inline note or an image.
      const owner = ch === '[' && hasFootnote && (s[j - 1] === '^' || s[j - 1] === '!') && lastEscaped !== j - 1
      const owned = owner && !literal?.has(j) && !demoted?.has(j)
      const labelEnd = ch === '[' && hasFootnote && stack.length === 0 && !owned ? footnoteLabelEnd(j) : -1
      if (owner && !literal && footnoteLabelEnd(j) !== -1) owners.push(j)
      if (labelEnd !== -1) {
        if (owner) footnotes.add(j)
        structural?.add(j)
        structural?.add(labelEnd)
        map.set(j, labelEnd)
        j = labelEnd
        continue
      }
      if (ch === '[') {
        if (literal?.has(j)) continue
        structural?.add(j)
        stack.push(j)
        imageAlt?.push(inImageAlt || (j > 0 && lastBang === j - 1))
      } else if (ch === ']') {
        structural?.add(j)
        const open = stack.pop()
        imageAlt?.pop()
        if (open !== undefined) {
          map.set(open, j)
          const slotEnd = stack.length > 0 ? nestedSlotEnd(j) : undefined
          if (slotEnd !== undefined) j = slotEnd - 1
        }
      }
    }
    for (const open of stack) unclosed.push(open)
    return unclosed
  }
  const first = hasFootnote && structural ? new Set<number>() : structural
  const unclosed = walk(first)
  let lowest = s.length
  for (const open of unclosed) if (open < lowest) lowest = open
  const demoted = new Set<number>()
  for (const open of owners) {
    const close = map.get(open)
    if (close !== undefined && !ownerForms(open, close)) demoted.add(open)
  }
  if (hasFootnote && (demoted.size > 0 || s.indexOf('[^', lowest) !== -1)) {
    map = new Map()
    spans = []
    walk(structural, new Set(unclosed), demoted)
  } else if (first !== structural) for (const at of first!) structural!.add(at)
  let budget = BRACKET_RESCAN_BUDGET * s.length + 64
  const scanFrom = (open: number, asLink = false): number | undefined => {
    let bangEscapes = 0
    if (s[open - 1] === '!') {
      for (let k = open - 2; k >= 0 && s[k] === '\\'; k--) {
        if (--budget < 0) return undefined
        bangEscapes++
      }
    }
    const imageDepth = [!asLink && s[open - 1] === '!' && bangEscapes % 2 === 0]
    let rescanBang = -1
    for (let j = open + 1; j < s.length; j++) {
      if (--budget < 0) return undefined
      const ch = s[j]
      if (ch === '\\') {
        j++
        continue
      }
      if (ch === '`') {
        let openLen = 1
        while (s[j + openLen] === '`') openLen++
        const spanEnd = closedRunEnd(j, openLen)
        if (spanEnd === undefined) return undefined
        budget -= spanEnd - j
        j = spanEnd - 1
        continue
      }
      const inImageAlt = imageDepth[imageDepth.length - 1] ?? false
      const commentEnd = opaqueEnd(j, inImageAlt)
      if (commentEnd !== undefined) {
        budget -= commentEnd - j
        j = commentEnd - 1
        continue
      }
      const linkEnd = autolinkEnd(j)
      if (linkEnd !== undefined) {
        budget -= linkEnd - j
        j = linkEnd - 1
        continue
      }
      if (ch === '!') rescanBang = j
      if (ch === '[') imageDepth.push(inImageAlt || rescanBang === j - 1)
      else if (ch === ']') {
        imageDepth.pop()
        if (imageDepth.length === 0) return j
        const slotEnd = nestedSlotEnd(j)
        if (slotEnd !== undefined) {
          budget -= slotEnd - j
          j = slotEnd - 1
        }
      }
    }
    return undefined
  }
  const insideSpan = (open: number): boolean => {
    let lo = 0
    let hi = spans.length - 1
    while (lo <= hi) {
      const mid = (lo + hi) >> 1
      const [contentStart, spanEnd] = spans[mid]!
      if (open < contentStart) hi = mid - 1
      else if (open >= spanEnd) lo = mid + 1
      else return true
    }
    return false
  }
  const close: BracketClose = (open) => {
    if (s[open] !== '[') return undefined
    const direct = map.get(open)
    if (direct !== undefined) return direct
    return !outsideOnly && insideSpan(open) ? scanFrom(open) : undefined
  }
  close.declinedImageAsLink = (open) => s[open] === '[' ? scanFrom(open, true) : undefined
  if (footnotes.size > 0) close.footnotes = footnotes
  return close
}

export interface CrossrefMemo {
  lastCloser: number
  invalidRange?: [number, number]
}

export function crossrefBodyCanEnd(text: string, from: number, memo: CrossrefMemo): boolean {
  if (memo.lastCloser < from) return false
  const range = memo.invalidRange
  if (range && from >= range[0] && from <= range[1]) return false
  let end = from
  while (text[end] !== '>' && text[end] !== ' ' && text[end] !== '\n' && text[end] !== '\r') end++
  if (text[end] === '>') return true
  memo.invalidRange = [from, end]
  return false
}

export function forEachCrossrefRun(text: string, visit: (start: number, end: number, id: string) => void): void {
  if (!text.includes('</#')) return
  const memo: CrossrefMemo = { lastCloser: text.lastIndexOf('>') }
  for (let at = 0; at < text.length; at++) {
    if (!text.startsWith('</#', at) || text[at + 3] === '>' || !crossrefBodyCanEnd(text, at + 3, memo)) continue
    const closer = text.indexOf('>', at + 3)
    visit(at, closer + 1, text.slice(at + 3, closer))
    at = closer
  }
}

export const RE_AUTOLINK_STICKY = new RegExp(RE_AUTOLINK.source.replace(/^\^/, ''), 'yu')
