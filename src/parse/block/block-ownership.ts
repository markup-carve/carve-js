import { isValidAttrPayload } from '../../extension/attribute-parser.js'
import { trimEndSpaceTab, trimNonNbsp } from '../../trim-non-nbsp.js'
import { occupiedPrivateUse, pickSentinelRun } from '../inline/sentinel-run.js'
import type { RefusedContinuationMarker } from './parse-block-scan-core.js'
import { CAPTION_COMMENT_ONLY, fenceCloseRe, markerLineBottomBlock, opensCodeFence } from './parse-quote-core.js'
import { FOOTNOTE_BODY_COLUMN } from './parse-block-boundaries.js'
import {
  commentOnlyParagraphEnd,
  isColonFenceOpener,
  isLinkDefLine,
  isTableRow,
  parseBlockAttributeRun,
  RE_ABBR_DEF,
  RE_FENCE,
  RE_HR,
  RE_LINE_BLOCK_OPEN,
  RE_RAW_FENCE,
  RE_TABLE_CONT,
} from '../parse-prepass-core.js'

/** Where a rewritten line lost or gained source characters: `at` is the edited column. */
export interface OwnershipCut { at: number; removed: number }

/** An opener S3 read past its owner's content column; `char` indexes the input line. */
export interface OverindentedOpener { index: number; char: number; kind: string; owner: string; contentColumn: number; column: number }

/** An eligible `+` whose follower did not attach, for the `continuation-marker-refused` lint. */
export interface RefusedPlus {
  index: number
  column: number
  host: RefusedContinuationMarker['host']
  reason: RefusedContinuationMarker['reason']
  firstBlock: boolean
}

/** One block record of the decision trace, version 1 (carve docs/decision-trace.md). */
export interface TraceRecord {
  line: number
  step: 'INPUT' | 'S1' | 'S2' | 'S4' | 'S5'
  owner: string
  rule: string | null
  form: string
  cell?: string
  closed?: number
  reached?: string
  plus?: number
  /** Internal: the frames an invisible line's own column reaches (carve#5178); not part of the trace format. */
  reach?: string
}

const BODY_FRAME = new Set(['item', 'dd', 'note'])

interface Frame {
  kind: 'doc' | 'quote' | 'item' | 'note' | 'dd' | 'fence' | 'colon'
  /** A quote a marker-line `+` of an item or description took as its block. */
  firstBlockQuote?: boolean
  col: number
  canon: number
  cut: number
  para: boolean
  last: string | null
  markerCol?: number
  markerCanon?: number
  // Document column of the marker and the line that opened the frame.
  docMarker?: number
  line?: number
  // A quote's marker and content start past the enclosing quote prefix, in document columns.
  viewMarker?: number
  viewEnd?: number
  // The line a fence or colon body opened on, for trace owner paths only.
  opened?: number
  family?: 'code' | 'comment' | 'div'
  /** The code opener's authored indent includes a tab, so its closer uses that same measured base. */
  tabbedCodeOpener?: boolean
  /** Columns a code opener moved when it was read at its per-frame column (carve#5755). */
  tabShift?: number
  /** A verse opener's per-frame column less its line-start one; its payload is read per frame (carve#5755). */
  verseShift?: number
  /** A verse whose payload ownership reads per frame: its opener moved, or it sits in nested body frames. */
  frameVerse?: boolean
  // The owner's last block a `%%%` span in an entry restores at its closer.
  entryLast?: string | undefined
  axes?: string | undefined
  run?: number | undefined
  closes?: ((rest: string, col: number) => boolean) | undefined
  lineBlock?: boolean | undefined
  span?: string | null
  // The line of the last table row read in this frame: a `+` row below it is a row, and lint groups by it.
  tableLine?: number | undefined
  // A description whose marker line held a lone `+`, accepted or refused.
  plusBody?: boolean
  // The marker line a `+` on it was accepted on.
  plus?: number
  // The note whose first-block `+` opened this item's list or quote: a refused `+` ends it there (carve#5601).
  listNote?: Frame
  // An unclosed block attached by `+` ends at its first blank (§17 L3).
  endsAtBlank?: boolean
  // A colon block a `+` attached: a later `+` is its text until the colon ends (carve#5658 ruling A).
  attachedColon?: boolean
  releasedFence?: { minimumFoldColumn: number }
  // A list keeps its first marker's column and shift (PART 0 S3).
  listCol?: number
  listShift?: number
  leftOfList?: boolean
  // A list or term run the walk closed at a line past it keeps its shift for the lines after.
  closedList?: { col: number; shift: number } | undefined
  termShift?: number
  ddShift?: number
  // A term anywhere in this item's body makes a later colon line at its marker a boundary.
  hasDefinition?: boolean
}

interface Form {
  kind: 'blank' | 'quote' | 'colon-close' | 'colon' | 'fence' | 'leaf' | 'note' | 'item' | 'term' | 'dd' | 'text'
  interrupts: boolean
  caption?: boolean
  frame?: number
  run?: number
  closes?: (rest: string, col: number) => boolean
  width?: number
  head?: number
  axes?: string
  lineBlock?: boolean
  family?: 'code' | 'comment' | 'div'
  table?: boolean
  // The continuation lines of a wrapped attribute block.
  attrLines?: number
  // A `{%` run is paragraph text, so a lazy line after it continues that paragraph (PART 9 §21a).
  para?: boolean
}

function colonAtDefinitionItem(rest: string, column: number, frames: Frame[]): boolean {
  if (!/^: [^\n]/.test(rest)) return false
  for (let i = frames.length - 1; i >= 0; i--) {
    const frame = frames[i]!
    if (frame.kind !== 'item' || frame.hasDefinition !== true || frame.markerCol !== column) continue
    let openDescription = false
    for (let k = i + 1; k < frames.length; k++) if (frames[k]!.kind === 'dd') openDescription = true
    if (!openDescription) continue
    // A quote after the term keeps an unmarked line while its paragraph is open.
    for (let k = i + 1; k < frames.length; k++)
      if (frames[k]!.kind === 'quote' && frames[k]!.para) return false
    return true
  }
  return false
}

function payloadColumn(rest: string, column: number, inner: Frame, lazyMissed: boolean, inCommentSpan: boolean, frames: Frame[]): number {
  if (lazyMissed) {
    if (inCommentSpan || !/^: /.test(rest)) return 0
    // The stanza keeps the colon line's position within the surviving item,
    // not the indentation before that item's marker (carve-js#4594).
    for (let k = frames.length - 1; k >= 0; k--) {
      const frame = frames[k]!
      if (frame.kind === 'item' && frame.markerCol !== undefined && frame.markerCol <= column) return column - frame.markerCol
    }
    return column
  }
  return Math.max(column - inner.cut + (inner.tabShift ?? 0), inner.canon)
}

function recordDefinitionTerm(frames: Frame[], owner: Frame, column: number): void {
  owner.termShift = column - owner.canon
  for (const frame of frames) if (frame.kind === 'item') frame.hasDefinition = true
}

const CONT_MARKER = /^\+[ \t]*$/
const LINT_HOST: Partial<Record<Frame['kind'], RefusedPlus['host']>> = { item: 'list item', dd: 'definition description', note: 'footnote', quote: 'block quote' }
const COLON_FENCE = /^(:{3,})(.*)$/
const COLON_CLOSER = /^(:{3,})[ \t]*$/
const PURE_FENCE = /^(`{3,}|~{3,})[ \t]*$/
const COMMENT_FENCE = /^(%{3,})(.*)$/
const COMMENT_LINE = /^[ \t]*%%/
// CARVE-P11-073: a region marker below a list closes every item.
const REGION_MARKER = /^%%[ \t]*#(?:end)?region(?![A-Za-z0-9_])/
const NOTE_HEAD = /^\[\^[^\]]+\]: +/
// The note heads before a line's text; the group ends where the last head starts.
const NOTE_HEADS = /^([ \t]*(?:\[\^[^\]]+\]:[ \t]+)*)\[\^[^\]]+\]:[ \t]+$/
const FOOTNOTE_DEF = /^\[\^([^\]]+)\]: +(?![ \t]*$)([^ ].*)$/
const NOTE_HEADS_LEAD = /^((?:\[\^[^\]]+\]:[ \t]+)*)\[\^[^\]]+\]:[ \t]+/
const DEFLIST_TERM = /^:: (?=[ \t]*[^ \t\n\r])/
const DD = /^:( +)(?=[ \t]*[^ \t])/
const HEADING = /^(#{1,6}) +(?=.*[^ \t\n\r])(.*)$/
const CAPTION = new RegExp(String.raw`^\^ (?=[^\n\r\u2028\u2029]*$)(?!${CAPTION_COMMENT_ONLY})[ \t\f]*[^ \t\f]`, 'u')
const ATTR_BLOCK = `\\{(?:[^}'"\\\\]|\\\\.|'(?:[^'\\\\]|\\\\.)*'|"(?:[^"\\\\]|\\\\.)*")*\\}`
const BULLET = new RegExp(`^([-*])(${ATTR_BLOCK})?( +)(?:\\[([ xX_>/!?-])\\] )?(?=.)`)
const ORDERED = new RegExp(`^([0-9]+|[a-z]+|[A-Z]+|(?=\\.))([.)])(${ATTR_BLOCK})?( +)(?=.)`)
const MAX_FRAMES = 200
const STAND_IN_BASE = 0xf8f0
// What the walk can spell as a letter: a lone `+`, and the marker character of a line it folds.
const STANDS_FOR = '+-*.)['
const TRAILING_PLUS = /^(?:(?:[-*](?:\{[^}]*\})?|[0-9]+[.)]|[A-Za-z]+[.)]|\.|:|\[\^[^\]]+\]:) +(?:\[.\] +)?)+\+[ \t]*$/
// A line that cannot start any opener: no leading punctuation an opener uses and no ordered marker.
const OPENER_LEAD = /^[>:`~%[\-*#_|{^+.0-9]|^[A-Za-z]+[.)] /
const TEXT: Form = { kind: 'text', interrupts: false }

/** Pair inline backtick runs in a paragraph an attached block is carrying. */
function pairAttachedCode(line: string, open: number): number {
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '\\' && open === 0) { i++; continue }
    if (line[i] !== '`') continue
    let end = i + 1
    while (line[end] === '`') end++
    const width = end - i
    if (open === 0) open = width
    else if (open === width) open = 0
    i = end - 1
  }
  return open
}

function offColumnFirstBlockNotePlus(note: Frame | undefined, at: number, lines: string[], form: Form, column: number): note is Frame {
  return note?.line === at - 1 && TRAILING_PLUS.test(lines[note.line]!.trimStart()) && form.kind === 'text' &&
    /^\+[ \t]*$/.test(lines[at]!.trimStart()) && column > note.markerCol! && column < note.col
}

function trailingPlusText(form: Form, rest: string): boolean {
  return form.kind === 'text' && TRAILING_PLUS.test(rest)
}

function captionMissesQuote(missed: boolean, rest: string, column: number, owner: Frame, missedFrames: readonly Frame[]): boolean {
  return missed && CAPTION.test(rest) && column === owner.col && missedFrames[0]?.kind === 'quote' &&
    !missedFrames.some((f) => f.kind === 'note')
}

function foldReleasedFence(
  form: Form, owner: Frame, column: number, at: number, lazyLines: Set<number>, laterCloser: () => boolean,
): Form {
  const released = owner.releasedFence
  // The fold belongs to the paragraph's owner, regardless of how many hosts the blank released.
  // Its source column must first pass the attachment's host reach (carve#5604).
  if (form.family === 'code' && owner.para && released !== undefined && column >= released.minimumFoldColumn &&
      !laterCloser()) {
    lazyLines.add(at)
    return TEXT
  }
  if (form.kind !== 'text' && form.kind !== 'blank') delete owner.releasedFence
  return form
}

function attachedCodeCloserAhead(
  fence: Frame, at: number, quotes: number, length: number, widest: Record<string, number[]>, hostColumn: number,
  measure: (line: number, quotes: number) => { col: number; rest: string } | null,
  itemContentColumn: number | null = null,
  shiftedMarkerLineCloser = false,
  stackedContentColumn: number | null = null,
): { exists: boolean; paired: number | null } {
  const opener = measure(at, quotes)
  const run = /^(`{3,}|~{3,})/.exec(opener?.rest ?? '')?.[1]
  if (run === undefined || (widest[run[0]!]?.[at + 1] ?? 0) < run.length) return { exists: false, paired: null }
  let pastBlank = false
  // A flush-left fence an item's marker-line `+` took: past a blank, the item reads a closer below its
  // content column, where its own dedent puts it at the fence's column (§17 L3, carve-js#4763).
  let firstAfterBlank = false
  let deeperRunColumn: number | null = null
  let deeperRunLine = -1
  let pairedRunLine: number | null = null
  for (let line = at + 1; line < length; line++) {
    const measured = measure(line, quotes)
    if (measured === null) break
    if (measured.rest === '') { pastBlank = firstAfterBlank = true; continue }
    if (fence.closes!(measured.rest, measured.col)) return { exists: true, paired: null }
    const hostCloser = pastBlank && shiftedMarkerLineCloser && measured.col === opener!.col + 1
      ? PURE_FENCE.exec(measured.rest)?.[1] : undefined
    if (hostCloser !== undefined && hostCloser[0] === run[0] && hostCloser.length >= run.length)
      return { exists: true, paired: line }
    const stackedCloser = pastBlank && shiftedMarkerLineCloser && stackedContentColumn !== null &&
      measured.col > opener!.col && measured.col < stackedContentColumn
      ? PURE_FENCE.exec(measured.rest)?.[1] : undefined
    if (stackedCloser !== undefined && stackedCloser[0] === run[0] && stackedCloser.length >= run.length)
      return { exists: true, paired: line }
    if (pastBlank && itemContentColumn !== null && pairedRunLine === null && measured.col < itemContentColumn) {
      const shifted = PURE_FENCE.exec(measured.rest)?.[1]
      if (shifted !== undefined && shifted[0] === run[0] && shifted.length >= run.length) return { exists: true, paired: line }
      // A marker as the first line there opens an item whose content column then bounds the closer too.
      const marker = firstAfterBlank ? matchMarker(measured.rest) : null
      if (marker !== null) itemContentColumn = Math.min(itemContentColumn, measured.col + marker.width)
    }
    firstAfterBlank = false
    if (pairedRunLine !== null && measured.col <= hostColumn) break
    const pure = PURE_FENCE.exec(measured.rest)?.[1]
    if (!pastBlank || pure === undefined || pure[0] !== run[0] || pure.length < run.length || measured.col <= opener!.col) continue
    if (deeperRunColumn !== null && measured.col <= deeperRunColumn) pairedRunLine ??= deeperRunLine
    deeperRunColumn = measured.col
    deeperRunLine = line
  }
  return { exists: pairedRunLine !== null, paired: pairedRunLine }
}
const RESUMING_HOSTS = new Set<Frame['kind']>(['item', 'note', 'dd'])
// Trace vocabulary of the spec model's walk (scripts/spec/layout.mjs).
const TRACE_FRAME: Partial<Record<Frame['kind'], string>> = { quote: 'quote', item: 'item', note: 'footnote', dd: 'dd', colon: 'div' }
const TRACE_FORM: Partial<Record<Form['kind'], string>> = { 'colon-close': 'closer', colon: 'div', note: 'footnote' }
const TRACE_OPENS = new Set<Form['kind']>(['quote', 'item', 'note', 'dd', 'term', 'colon', 'fence'])
const TRACE_RULE: Partial<Record<Form['kind'], string>> = { blank: 'CARVE-P0-003', leaf: 'CARVE-P0-011' }

function indentCols(line: string): { col: number; rest: string } {
  let col = 0
  let i = 0
  for (; i < line.length; i++) {
    const ch = line[i]
    if (ch === ' ') col += 1
    else if (ch === '\t') col = (Math.floor(col / 4) + 1) * 4
    else break
  }
  return { col, rest: i === 0 ? line : line.slice(i) }
}

// A leading run's column as nested frames strip it (PART 9 §24 C5): tab stops restart at every frame column the run reaches.
function strippedColumn(line: string, origins: readonly number[]): number {
  let col = 0
  let origin = 0
  let o = 0
  for (let i = 0; i < line.length; i++) {
    if (line[i] === ' ') col += 1
    else if (line[i] === '\t') col = origin + (Math.floor((col - origin) / 4) + 1) * 4
    else break
    // A tab beginning exactly at a frame boundary still belongs to the
    // frame it just reached. Reset the stop only after advancing past it.
    while (o < origins.length && origins[o]! <= col) origin = origins[o++]!
  }
  return col
}

function hasLeadingTab(line: string, rest: string): boolean {
  return rest !== '' && line.slice(0, line.length - rest.length).includes('\t')
}

function hasNestedItemFrame(frames: readonly Frame[]): boolean {
  return frames.some((child, index) => index > 1 && child.kind === 'item' &&
      frames[index - 1]?.kind === 'item' && child.markerCol === frames[index - 1]?.col)
}

function tabbedMarkerOutsideCode(rest: string, frame: Frame): boolean {
  return !(frame.kind === 'fence' && frame.family === 'code') && matchMarker(rest) !== null
}

// A tab-led code or verse payload line is measured per frame; a verse closer keeps its authored lead.
// One body frame's reader already strips its columns from the tab, so a verse line is respelled
// only under a shifted opener or nested frames, and its other tabs keep their source positions.
function framePayload(inner: Frame, pairedCloser: boolean, src: string, m: { col: number; rest: string }, closerColumn: number): boolean {
  if (pairedCloser || !hasLeadingTab(src, m.rest)) return false
  if (inner.family === 'code') return true
  if (!inner.lineBlock || m.rest !== '' && !inner.span && inner.closes?.(m.rest, closerColumn)) return false
  return inner.frameVerse === true
}

// An opener past its body frame's column is no frame, so the line walks from that frame's column (carve#5885).
function nestedVerseFrames(frames: readonly Frame[], segment: number, column: number): boolean {
  const bodies = frames.slice(segment).filter((f) => BODY_FRAME.has(f.kind))
  return bodies.length > 1 || bodies.length === 1 && column > bodies[0]!.col
}

// A marker at an unchanged column is still respelled, so the list reader measures no tab.
function respellsFrameTab(deepest: Frame, stripped: number, m: { col: number; rest: string }): boolean {
  if (deepest.kind === 'fence' && deepest.family === 'code') return false
  return stripped !== m.col || tabbedMarkerOutsideCode(m.rest, deepest)
}

function tabColumnInFrames(line: string, frames: readonly Frame[], segment: number): number {
  const origins: number[] = []
  for (let q = segment; q < frames.length && frames[q]!.kind !== 'quote'; q++) origins.push(frames[q]!.col)
  return strippedColumn(line, origins)
}

// A tab-led block opener is written at its per-frame column, so a nested reader cannot
// remeasure the tab from the line start (§24 C5, carve#5755). A verse opener records how far
// that moved it, and whether its payload is read per frame here instead of by the line-block reader.
function openerFrame(form: Form, src: string, m: { col: number; rest: string }, frames: readonly Frame[], segment: number) {
  const perFrame = hasLeadingTab(src, m.rest) && FRAME_OPENER.has(form.kind)
  const from = perFrame ? tabColumnInFrames(src, frames, segment) : m.col
  const frameVerse = !!form.lineBlock && (from !== m.col || nestedVerseFrames(frames, segment, m.col))
  return { perFrame, from, shift: from - m.col, frameVerse, readsVerse: frameVerse && perFrame, spaces: perFrame || SPACED_LEAD.has(form.kind) }
}
const FRAME_OPENER = new Set<Form['kind']>(['quote', 'leaf', 'fence', 'colon', 'item'])
// A term and its body read alike in both spellings.
const SPACED_LEAD = new Set<Form['kind']>(['term', 'dd'])

// A quote opener is read where its frames put it, so it reaches an item's note body by its per-frame column (carve#5877).
function tabbedItemNoteQuote(rest: string, frames: readonly Frame[], k: number): boolean {
  return frames[k]!.kind === 'note' && frames[k - 1]?.kind === 'item' && isQuoteLine(rest)
}

// Character checks: a regex capturing the rest at every quote level is quadratic in nesting depth.
function isQuoteLine(rest: string): boolean {
  if (rest[0] !== '>') return false
  if (rest[1] === ' ') return true
  for (let i = 1; i < rest.length; i++) if (rest[i] !== ' ' && rest[i] !== '\t') return false
  return true
}
const quoteRest = (rest: string): string => rest[1] === ' ' ? rest.slice(2) : ''

const gluedAttrsValid = (attrs: string | undefined): boolean =>
  attrs === undefined || attrs.replace(/[{} ]/g, '') === '' || isValidAttrPayload(attrs.slice(1, -1))

function orderedTokenValid(token: string): boolean {
  if (token === '' || /^[0-9]+$/.test(token)) return true
  const lower = token === token.toLowerCase()
  const upper = token === token.toUpperCase()
  if (!lower && !upper) return false
  return /^[ivxlcdm]+$/.test(token.toLowerCase()) || /^[a-z]$/i.test(token)
}

function matchMarker(rest: string): { width: number; head: number; axes: string } | null {
  // The thematic break is tested before a list marker, wherever the line stands (PART 2).
  if (RE_HR.test(rest)) return null
  const line = trimEndSpaceTab(rest)
  let m = BULLET.exec(line)
  if (m && gluedAttrsValid(m[2])) {
    if (m[4] !== undefined) return { width: 1 + m[3]!.length, head: m[0].length, axes: m[1]! }
    return { width: 1 + m[3]!.length, head: m[0].length, axes: m[1]! }
  }
  m = ORDERED.exec(line)
  if (m && orderedTokenValid(m[1]!) && gluedAttrsValid(m[3]) &&
      !(m[2] === '.' && /^[A-Za-z]+$/.test(m[1]!) && m[4]!.length < 2)) {
    return { width: m[1]!.length + 1 + m[4]!.length, head: m[0].length, axes: m[2]! }
  }
  return null
}

// A line leaving a line block's open `%%%` span is markup-carve/carve#4994; it keeps the opener base.
function holdsCommentSpan(frame: Frame): boolean {
  return frame.kind === 'fence' && frame.lineBlock === true && frame.span?.[0] === '%'
}

// Frames inside a quote a marker-line `+` took leave the body's column to its host (CARVE-P9-067, carve#4385).
const NO_FRAMES: readonly Frame[] = []

// The walk asks this once per line, and on most lines nothing was missed.
function framesPast(frames: Frame[], depth: number): readonly Frame[] {
  return depth < frames.length - 1 ? frames.slice(depth + 1) : NO_FRAMES
}

// Assigning an unchanged length still takes V8's slow length setter.
function truncateFrames(frames: Frame[], length: number): void {
  if (frames.length !== length) frames.length = length
}

function closesAColumn(closed: readonly Frame[]): boolean {
  const quote = closed.findIndex((f) => f.firstBlockQuote === true)
  return (quote < 0 ? closed : closed.slice(0, quote)).some((f) => f.kind !== 'quote')
}

function isAttrLine(text: string): boolean {
  if (text[0] !== '{') return false
  let pos = 0
  let lists = 0
  while (true) {
    while (pos < text.length && (text[pos] === ' ' || text[pos] === '\t')) pos++
    if (pos >= text.length) break
    if (text[pos] !== '{') return false
    let inQuote = false
    let close = -1
    for (let k = pos; k < text.length; k++) {
      const ch = text[k]
      if (ch === '\\' && inQuote) {
        k++
        continue
      }
      if (ch === '"') inQuote = !inQuote
      else if (ch === '}' && !inQuote) {
        close = k
        break
      }
    }
    if (close === -1) return false
    const payload = text.slice(pos + 1, close)
    // `{}` carries no attribute, and a space between blocks ends the run (carve#4078).
    if (payload.trim() === '' || !isValidAttrPayload(payload)) return false
    lists++
    pos = close + 1
    if (text[pos] !== '{' && text.slice(pos).trim() !== '') return false
  }
  return lists > 0
}

function quotedMeasure(line: string): { col: number; rest: string } {
  let m = indentCols(line)
  while (isQuoteLine(m.rest)) m = indentCols(quoteRest(m.rest))
  return m
}

const quotedRest = (line: string): string => quotedMeasure(line).rest

/** Remember the note whose first-block `+` opened this item's list, carried to its later items (carve#5601). */
function markListNote(item: Frame, owner: Frame, sibling: Frame | undefined, plusFollower: boolean, at: number): void {
  if (item === owner) return
  const note = plusFollower && sibling?.kind === 'note' && sibling.plus === at - 1 ? sibling
    : sibling?.kind === 'item' && sibling.markerCol === item.markerCol ? sibling.listNote : undefined
  if (note) item.listNote = note
}

/** The list a note's `+` attached sits in that note, so a `+` at their shared marker column reaches the note. */
function listNoteAt(frames: Frame[], k: number): Frame {
  const f = frames[k]!
  const note = f.listNote
  if (note && note.markerCol === f.markerCol) frames[k] = note
  return frames[k]!
}

/** Route only a block actually taken by a marker-line plus through its host's trace path. */
function firstBlockTraceRoute(
  parent: string, sibling: Frame | undefined, plusFollower: boolean, at: number, form: Form,
  walkPath: string, opened: boolean, closed: number, reached: string | undefined,
): { path: string; alias?: { from: string; to: string }; closed: number; reached?: string | undefined } {
  if (!plusFollower || sibling === undefined || !RESUMING_HOSTS.has(sibling.kind) || sibling.plus !== at - 1 ||
      ['item', 'text', 'blank'].includes(form.kind) || form.family === 'comment' ||
      !(walkPath === parent || walkPath.startsWith(`${parent}/`))) {
    return { path: walkPath, closed, reached }
  }
  const itemPath = `${parent}/${TRACE_FRAME[sibling.kind]}:${(sibling.line ?? sibling.opened!) + 1}`
  const readPath = itemPath + walkPath.slice(parent.length)
  return opened
    ? { path: walkPath, alias: { from: walkPath, to: readPath }, closed: 0 }
    : { path: readPath, closed: 0 }
}

function invisibleFollowerLine(
  at: number, movedSpanEnd: number, lines: string[], abbreviations: Map<number, [string, string]>,
  separatingAbbreviations: Set<number>, separatingLinks: Set<number>, comments: Map<number, string>, notes: Set<number>,
): string | null {
  // A moved `%%%` span's body stays its payload.
  if (at <= movedSpanEnd) return null
  if (abbreviations.has(at)) return separatingAbbreviations.has(at) ? '' : `${/^[ \t]*/.exec(lines[at]!)?.[0] ?? ''}%%`
  if (separatingLinks.has(at)) return lines[at]!
  if (comments.has(at)) return comments.get(at)!
  if (notes.has(at)) return lines[at]!
  return null
}

// A caption past a note in a quote folds, so the quote reader must not end the quote at it (CARVE-P2-008).
function recordLazyCaption(lazyCaptions: Set<number>, missedNote: boolean, rest: string, at: number): void {
  if (missedNote && CAPTION.test(rest)) lazyCaptions.add(at)
}

interface PendingNoteFollower { at: number; prefix: string; item: boolean }
interface PendingTabQuoteFollower { at: number; depth: number }

function normalizeMarkerFollower(
  source: string, at: number, note: PendingNoteFollower | null, tab: PendingTabQuoteFollower | null,
  isText: (body: string, at: number) => boolean,
): { line: string; notePrefix: string | null } {
  let line = source
  if (tab && at === tab.at + 1 && line.trim() !== '' &&
      !isQuoteLine(indentCols(line).rest) && isText(indentCols(line).rest, at)) {
    line = '> '.repeat(tab.depth) + line.trimStart()
  }
  let notePrefix: string | null = null
  const quoteDepth = (text: string): number =>
    (text.match(/^(?:[ \t]*> ?)+/)?.[0].match(/>/g) ?? []).length
  if (note && at === note.at + 1 && line.trim() !== '' &&
      !(isQuoteLine(indentCols(line).rest) && quoteDepth(line) > quoteDepth(note.prefix))) {
    const body = note.item ? line.trimStart() : line.replace(/^[ \t]*(?:> )?/, '')
    if (!CONT_MARKER.test(body.trimStart()) && (!note.item || indentCols(line).col < 2) &&
        isText(indentCols(body).rest, at) && (line !== body || note.prefix.includes('> ') || note.prefix.length > 2)) {
      line = note.prefix + body
      notePrefix = note.prefix
    }
  }
  return { line, notePrefix }
}

function skippedNoteMarker(
  line: string, noteLine: boolean, markerColumn: number | undefined, markerCanon: number | undefined,
  columnOfPlus: (text: string) => number, standInPlus: () => string,
): { line: string; column: number | null } {
  const note = noteLine ? FOOTNOTE_DEF.exec(line.trimStart().replace(/^(?:>[ \t]*)*/, '')) : null
  if (note && CONT_MARKER.test(note[2]!)) {
    const plusAt = line.lastIndexOf('+')
    const quotes = (line.slice(0, line.indexOf('[^')).match(/>/g) ?? []).length
    const prefix = '> '.repeat(quotes) + ' '.repeat(markerCanon ?? 0)
    return { line: prefix + line.slice(line.indexOf('[^'), plusAt) + '%%', column: columnOfPlus(line.slice(plusAt)) + 1 }
  }
  // A skipped definition with text stands at the marker column, as a `+` one does.
  if (note && markerCanon !== undefined && line.indexOf('[^') > 0 && !/^[ \t]*>/.test(line) &&
      columnOfPlus(line.slice(line.indexOf('[^'))) === markerColumn) {
    return { line: ' '.repeat(markerCanon) + line.slice(line.indexOf('[^')), column: null }
  }
  if (!noteLine || !CONT_MARKER.test(line.trimStart().replace(/^(?:>[ \t]*)*/, ''))) return { line, column: null }
  const plusAt = line.lastIndexOf('+')
  const column = columnOfPlus(line.slice(plusAt))
  return column === markerColumn
    ? { line: line.slice(0, plusAt) + '%%', column: column + 1 }
    : { line: line.slice(0, plusAt) + standInPlus() + line.slice(plusAt + 1), column: null }
}

function partialQuotePlusIsLazy(frames: Frame[], at: number, quotes: number): boolean {
  const frame = frames[at]!
  if (frame.kind !== 'quote' || !frame.para || quotes === 0) return false
  let depth = 0
  let attachedAncestor = false
  for (let k = 1; k <= at; k++) {
    if (frames[k]!.kind !== 'quote') continue
    depth++
    if (k < at && frames[k]!.plus !== undefined) attachedAncestor = true
  }
  return attachedAncestor && quotes < depth
}

/**
 * Rule A (carve#3885): every line is first matched against the open containers,
 * and an opener past its owner's content column opens there, measured from its
 * own line. The walk moves such an opener, and every line its block owns, onto
 * the owner's content column, so the block readers only meet openers at a
 * content column. Indentation is only ever removed. `trace` collects one
 * record per line at the step that decided it (S1, S2, S4, S5).
 */
export function ownLines(
  lines: string[],
  start = 0,
  trace: TraceRecord[] | null = null,
): { lines: string[]; cuts: Map<number, OwnershipCut[]>; letters: string[] | null; refusedPlus: RefusedPlus[]; payloadLines: Set<number>; frameVerseOpeners: Set<number>; lazyCaptions: Set<number>; overindented: OverindentedOpener[]; skippedAbbreviations: Map<number, [string, string]>; separatingAbbreviations: Set<number>; skippedComments: boolean; skippedFences: Map<number, { closer: number; content: string }>; consumedMarkers: Set<number>; quoteSiblingSeparators: Set<number>; noteListBreaks: Map<number, number>; lazyLines: Set<number>; rewritten: boolean } {
  const result = lines.slice(0, start)
  // The walk may place a marker-line first block in its parent while the readers
  // keep it in the item. Trace records use the reader's owner for that block.
  let traceAlias: { from: string; to: string } | null = null
  if (trace) for (let k = 0; k < start; k++) emit(k, 'INPUT', 'doc', null, 'frontmatter')
  const cuts = new Map<number, OwnershipCut[]>()
  const frames: Frame[] = [{ kind: 'doc', col: 0, canon: 0, cut: 0, para: false, last: null }]
  const top = (): Frame => frames[frames.length - 1]!
  let reach = 0
  let runs: { widest: Record<string, number[]> } | null = null
  const verseRunsByQuoteDepth = new Map<number, Record<'`' | '~', number[]>>()
  // The line after an accepted `+` keeps its column: the marker reads it.
  let afterPlus = false
  let nextVisible = -1
  let movedSpanEnd = -1
  // Stand-ins for a refused `+` and a folded marker: readers meet a plain letter, the AST gets the character back.
  let letters: string[] | null = null
  // The frames of the host a `+` last attached through. The attached block stands outside
  // the host's columns and closes it here, and a further `+` still reaches it (§17 L3).
  let attachedHost: Frame[] | null = null
  let attachedInlineCode = 0
  let braceRunStart = -1
  let shiftedAttachedFence: { column: number; run: string } | null = null
  // The host a marker-line `+` gave its block to, and the frame that block opened (null for a leaf).
  // The host resumes at its content column once that block has ended (CARVE-P0-024, carve#5407).
  const resumable: { host: Frame[]; block: Frame | null; table: boolean; last: number }[] = []
  // The block a quote's `+` attached outside the quote, by the depth it stands at.
  // The blank that ends the quote ends that block too (§17 L3, carve#5383).
  let quoteBlock: { depth: number; opener: 'item' | 'term' | 'table' | 'attr' | 'other'; axes?: string | undefined } | null = null
  // A marker-line note can own a short text follower. Give the note reader the
  // same body column after ownership has decided that the + attaches nothing.
  const noteTextFollower: { value: PendingNoteFollower | null } = { value: null }
  // The continuation lines of a wrapped attribute block the walk opened.
  let attrRest = null as { left: number; cut: number; floor?: number } | null
  const refusedPlus: RefusedPlus[] = []
  // Lines whose consumed `+` now reads as a `%%` stand-in: container markup, not a comment.
  const consumedMarkers = new Set<number>()
  const quoteSiblingSeparators = new Set<number>()
  // Refused markers a note keeps, by the note's marker column: each ends the note's list there (carve#5890).
  const noteListBreaks = new Map<number, number>()
  const lazyLines = new Set<number>()
  const pairedCodeClosers = new Set<number>()
  // A later marker cannot take the block offered by an earlier marker.
  const claimedMarkers = new Set<number>()
  const skippedAbbreviations = new Map<number, [string, string]>()
  const separatingAbbreviations = new Set<number>()
  const separatingLinks = new Set<number>()
  const releasedFollowers = new Set<number>()
  const skippedComments = new Map<number, string>()
  const skippedFences = new Map<number, { closer: number; content: string }>()
  // A skipped `%%%` span's lines, which stand where the block after them does.
  const skippedSpanLines = new Set<number>()
  const skippedNotes = new Set<number>()
  const refusedInvisibleFollowers = new Set<number>()
  const tabQuoteFollower: { value: PendingTabQuoteFollower | null } = { value: null }
  const payloadLines = new Set<number>()
  // Verse openers written at their per-frame column; the line-block reader takes them as written.
  const frameVerseOpeners = new Set<number>()
  const lazyCaptions = new Set<number>()
  const overindented: OverindentedOpener[] = []
  // A line the walk rewrote without removing anything, so it records no cut.
  let rewritten = false
  // A blank or text line under the document alone, with no `+`, follower or moved
  // span pending, takes the S5 path unchanged. Skipping it in the loop header keeps
  // the body's per-line closures off that path.
  const passesThrough = (at: number): boolean => {
    if (trace || frames.length !== 1 || attachedHost || shiftedAttachedFence || resumable.length > 0 || quoteBlock || attrRest || afterPlus || at <= movedSpanEnd ||
        releasedFollowers.has(at) || noteTextFollower.value?.at === at - 1 || tabQuoteFollower.value?.at === at - 1) return false
    const doc = frames[0]!
    if (doc.cut !== 0 || doc.endsAtBlank || doc.closedList || doc.termShift !== undefined) return false
    const line = lines[at]!
    const { rest } = indentCols(line)
    if (CONT_MARKER.test(rest) || TRAILING_PLUS.test(rest)) return false
    reach = 0
    if (rest !== '' && classify(rest, doc, at, 0).kind !== 'text') return false
    if (invisibleFollowerLine(at, movedSpanEnd, lines, skippedAbbreviations, separatingAbbreviations, separatingLinks, skippedComments, skippedNotes) !== null) return false
    doc.para = rest !== ''
    if (rest !== '') doc.last = 'para'
    result.push(line)
    return true
  }
  const nextWalkedLine = (from: number): number => {
    while (from < lines.length && passesThrough(from)) from++
    return from
  }

  function prepareAttachedSource(at: number, line: string): { src: string; shiftedCut: number } {
    let src = line
    let shiftedCut = 0
    if (shiftedAttachedFence !== null && src !== '') {
      const measured = indentCols(src)
      shiftedCut = Math.min(shiftedAttachedFence.column, src.length - measured.rest.length)
      src = src.slice(shiftedCut)
      const closer = PURE_FENCE.exec(measured.rest)?.[1]
      if (closer && closer[0] === shiftedAttachedFence.run[0] && closer.length >= shiftedAttachedFence.run.length)
        shiftedAttachedFence = null
      if (shiftedCut) rewritten = true
    }
    let ownHost = (attachedHost as Frame[] | null)?.at(-1)
    if (ownHost && ownHost.plus !== ownHost.line && top().kind === 'fence' && top().family === 'code' &&
        at > 0 && lines[at - 1]!.trim() === '' && src.trim() !== '') {
      const depth = attachedHost!.filter((frame) => frame.kind === 'quote').length
      const measured = quotedMeasure(at, depth)
      const opener = quotedMeasure(top().opened!, depth)
      const run = /^(`{3,}|~{3,})/.exec(opener?.rest ?? '')?.[1]
      if (measured && run && measured.col < ownHost.col &&
          !(measured.col === ownHost.markerCol && CONT_MARKER.test(measured.rest)) &&
          !fenceCloseRe(run).test(measured.rest)) {
        // An own-line fence ends when the next nonblank line misses its host,
        // even with a later closer in the source (PART 0 S1 step 2, F06).
        frames.length = attachedHost!.length - 1
        attachedHost = null
        attachedInlineCode = 0
        ownHost = undefined
      }
    }
    const parent = frames.at(-1)
    const descriptionAttached = braceRunStart > 0 && DD.test(lines[braceRunStart - 1]!.trimStart()) &&
      TRAILING_PLUS.test(lines[braceRunStart - 1]!.trimStart())
    if (descriptionAttached && parent?.kind === 'item' && braceRunStart >= 0 && at - braceRunStart >= 2 &&
        PURE_FENCE.test(indentCols(src).rest) && indentCols(src).col > parent.col &&
        indentCols(lines[braceRunStart]!).col === parent.col) {
      const pieces = lines.slice(braceRunStart, at).map(part => part.trimStart())
      if (parseBlockAttributeRun(pieces.join('\n')) !== null) {
        // A wrapped attribute run released from a description leads the
        // parent's shifted fence. Flatten the run for the parent reader;
        // its continuation lines become invisible placeholders.
        result[braceRunStart] = ' '.repeat(parent.col) + pieces.join(' ')
        for (let index = braceRunStart + 1; index < at; index++) result[index] = ' '.repeat(parent.col) + '%%'
        rewritten = true
      }
    }
    if (ownHost?.kind === 'quote' && attachedInlineCode !== 0 && braceRunStart >= 0 &&
        at - braceRunStart >= 2 && indentCols(src).col < ownHost.markerCol!) {
      const quoteWrappedAttribute = indentCols(lines[braceRunStart + 1] ?? '').col >
        indentCols(lines[braceRunStart]!).col &&
        parseBlockAttributeRun(lines.slice(braceRunStart, at).map(part => part.trimStart()).join('\n')) !== null
      if (quoteWrappedAttribute) {
        frames.length = 1
        attachedHost = null
        attachedInlineCode = 0
      }
    }
    if (ownHost && attachedInlineCode !== 0 && (ownHost.kind === 'note' || ownHost.kind === 'dd') &&
        indentCols(src).col < ownHost.markerCol! && !isQuoteLine(indentCols(src).rest)) {
      // A lazy line in an attached inline span remains in a stacked host.
      // Give its reader the host margin selected by the ownership walk.
      src = ' '.repeat(ownHost.markerCol!) + indentCols(src).rest
      rewritten = true
    }
    const shiftedRun = PURE_FENCE.exec(indentCols(src).rest)?.[1]
    if (ownHost && ownHost.plus !== ownHost.line && top().kind === 'fence' && top().family === 'code' &&
        at > 0 && lines[at - 1]!.trim() === '' && shiftedRun &&
        indentCols(src).col > ownHost.markerCol! && indentCols(src).col < ownHost.col) {
      // The line misses an own-line attachment after its retained blank. It
      // starts a new fence in the host's parent at its written column (F06).
      frames.length = attachedHost!.length - 1
      attachedHost = null
      attachedInlineCode = 0
      const column = indentCols(src).col
      shiftedAttachedFence = { column, run: shiftedRun }
      shiftedCut += src.length - indentCols(src).rest.length
      src = indentCols(src).rest
      rewritten = true
    }
    const rawLine = lines[at]!
    let unquoted = rawLine
    for (let quoted = indentCols(unquoted).rest; isQuoteLine(quoted); quoted = indentCols(unquoted).rest) {
      unquoted = quoteRest(quoted)
    }
    if (rawLine.trim() === '' || FOOTNOTE_DEF.test(unquoted.trimStart())) braceRunStart = -1
    if (rawLine.trim() !== '' && rawLine.includes('{')) {
      const stripped = markerLineBottomBlock(rawLine.trimStart())
      const heads = NOTE_HEADS_LEAD.exec(stripped)
      const noteBody = heads ? stripped.slice(heads[0].length) : stripped
      const walked = heads ? markerLineBottomBlock(noteBody) : noteBody
      // Item markers only: a quote in the note reads its own lines.
      const bottom = noteBody.slice(0, noteBody.length - walked.length).includes('>') ? noteBody : walked
      const opener = bottom.startsWith(': ') ? bottom.slice(2).trimStart() : bottom
      if (opener.startsWith('{')) braceRunStart = at
    }
    return { src, shiftedCut }
  }

  const laterCloserCache = new Map<string, { through: number; paired: boolean }>()
  for (let at = nextWalkedLine(start); at < lines.length; at = nextWalkedLine(at + 1)) {
    const invisible = invisibleFollowerLine(at, movedSpanEnd, lines, skippedAbbreviations, separatingAbbreviations, separatingLinks, skippedComments, skippedNotes)
    if (invisible !== null) {
      recordInvisible(invisible)
      continue
    }
    function recordInvisible(line: string): void {
      const skipped = skippedNoteMarker(line, skippedNotes.has(at), top().docMarker, top().markerCanon,
        (text) => docColumn(lines[at]!, text), () => standIn('+'))
      if ((refusedInvisibleFollowers.has(at) || skippedSpanLines.has(at)) && skippedComments.has(at)) skipped.line = standRefusedInvisible(skipped.line)
      result.push(skipped.line)
      if (skipped.column !== null) consumedMarkers.add(at)
      if (skipped.column !== null) refusedPlus.push({ index: at, column: skipped.column,
        host: LINT_HOST[top().kind] ?? 'document', reason: 'claimed', firstBlock: false })
      if (skipped.line !== line) rewritten = true
      if (trace) emit(at, 'S5', ownerPath(), 'CARVE-P0-024', 'leaf', { plus: at })
    }
    // A refused `+` changes no owner, so a line it skipped stands where the next
    // visible line puts it, as any invisible line does (CARVE-P9-013, carve#5170).
    function standRefusedInvisible(line: string): string {
      let prefix = 0
      let n = indentCols(line)
      let from = 0
      for (let k = 1; k < frames.length; k++) {
        const f = frames[k]!
        if (f.kind === 'quote') {
          if (!isQuoteLine(n.rest)) break
          const body = quoteRest(n.rest)
          prefix = line.length - body.length
          n = indentCols(body)
        } else if (n.col < f.col) break
        from = k
      }
      const deeper = nextVisibleReach(at, from)
      if (deeper === from) return line
      const col = frames[deeper]!.col
      const removed = line.length - prefix - n.rest.length - col
      const lineCuts = cuts.get(at) ?? []
      const last = lineCuts.at(-1)
      if (last?.at === prefix) last.removed += removed
      else lineCuts.push({ at: prefix, removed })
      cuts.set(at, lineCuts)
      return line.slice(0, prefix) + ' '.repeat(col) + n.rest
    }
    if (releasedFollowers.has(at)) frames.length = 1
    const startingLine = releasedFollowers.has(at) ? lines[at]!.trimStart() : lines[at]!
    const normalized = normalizeMarkerFollower(startingLine, at, noteTextFollower.value, tabQuoteFollower.value,
      (body, line) => classify(body, frames[0]!, line, 0).kind === 'text')
    const { src: preparedSource, shiftedCut } = prepareAttachedSource(at, normalized.line)
    let src = preparedSource
    const noteOverridePrefix = normalized.notePrefix
    if (src !== lines[at]) rewritten = true
    let out = ''
    // Where the innermost quote prefix taken so far ends, in document columns.
    let viewDoc = 0
    let m = indentCols(src)
    const lineCuts: OwnershipCut[] = []
    if (shiftedCut) lineCuts.push({ at: 0, removed: shiftedCut })
    // `spaces` writes a leading tab as the columns it reaches, so a term and its body read alike in both spellings.
    // `from` is a tab lead's per-frame column (§24 C5), where its spaces stand.
    const lead = (target: number, spaces = false, anywhere = false, from = m.col): void => {
      const col = Math.min(target, from)
      const run = src.length - m.rest.length
      const tabbed = spaces && (anywhere || out === '') && src.slice(0, run).includes('\t')
      if (col === m.col && !tabbed) out += src.slice(0, run)
      else {
        const last = lineCuts.at(-1)
        if (last?.at === out.length) last.removed += run - col
        else lineCuts.push({ at: out.length, removed: run - col })
        out += ' '.repeat(col)
      }
      src = m.rest
    }
    // A quote opened on another marker line keeps that line's authored marker column.
    const standsAtMarker = (f: Frame): boolean => !payloadPlus && (f.kind === 'quote'
      ? docColumn(lines[at]!, m.rest) - viewDoc === f.viewMarker
      : m.col === f.markerCol && m.col < f.col)
    const take = (count: number): void => {
      out += src.slice(0, count)
      src = src.slice(count)
    }
    const finish = (): void => {
      const written = out + src
      const pushed = noteOverridePrefix === null ? written
        : noteOverridePrefix + written.replace(/^[ \t]*(?:> )*/, '')
      result.push(pushed)
      // A rewritten lead keeps the authored text as its suffix: map that suffix back to the
      // source, and leave the columns of the prefix the walk wrote as they were.
      const shift = lines[at]!.length - normalized.line.length + written.length - pushed.length
      if (shift !== 0) {
        const source = lines[at]!
        let common = 0
        while (common < pushed.length && common < source.length &&
            pushed[pushed.length - 1 - common] === source[source.length - 1 - common]) common++
        const from = pushed.length - common
        // A prefix that spells markup of its own has no source columns to map to.
        const mappable = /^[ \t>]*$/.test(pushed.slice(0, from))
        if (mappable && from === 0 && lineCuts[0]?.at === 0) lineCuts[0].removed += shift
        else if (mappable) {
          lineCuts.push({ at: from, removed: shift })
          lineCuts.sort((x, y) => x.at - y.at)
        }
      }
      if (lineCuts.length) cuts.set(at, lineCuts)
    }

    // A comment or one-line definition closes no indentation frame: the next
    // visible line picks the owner (CARVE-P9-013).
    const standInvisibleLine = (from: number, atPlus: boolean): number => {
      const standAt = (col: number): void => {
        lineCuts.push({ at: out.length, removed: src.length - m.rest.length - col })
        src = ' '.repeat(col) + m.rest
        m = indentCols(src)
      }
      if (at <= movedSpanEnd) {
        // The rest of a matched `%%%` span moves with its opener.
        standAt(top().col)
        return frames.length - 1
      }
      if (atPlus || refusedInvisibleFollowers.has(at) || from === frames.length - 1 || top().kind === 'fence' || !transparentLine(m.rest, at)) return from
      // A line that misses an open fence's owner ends that fence first (S1), so it is read where it stands.
      const deeper = nextVisibleReach(at, from)
      if (deeper === from) return from
      standAt(frames[deeper]!.col)
      movedSpanEnd = commentSpanEnd(trimEndSpaceTab(m.rest), at)
      return deeper
    }

    // A `+` at an open code fence's content column stays payload (PART 0 S1, §17 L3, carve#5494).
    const payloadPlus = plusInCodePayload()
    restoreAttachedQuote()
    endAttachedColonAtSibling()
    let reached = 0
    let plus: Frame | null = null
    let plusReason: RefusedPlus['reason'] | null = null
    let quotes = 0
    let refused = false
    let stripped: number | null = null
    let segment = 1
    let frameReach = false
    let frameShift = 0
    let verseShift = 0
    let frameVerse = false
    for (let k = 1; k < frames.length; k++) {
      const f = frames[k]!
      // A lone `+` reaches the marker column of an open marker container.
      if (f.markerCol !== undefined && CONT_MARKER.test(m.rest) && standsAtMarker(f) && !partialQuotePlusIsLazy(frames, k, quotes)) {
        plus = listNoteAt(frames, k)
        plusReason = claimedMarkers.has(at) ? 'claimed' : refusal(at, docColumn(lines[at]!, m.rest), quotes, plus.kind, out, contentColumn(plus))
        break
      }
      if (f.kind === 'quote') {
        // An own-line `+` at a descendant quote's authored marker column reaches that
        // quote without repeating the intervening quote markers (carve#4702).
        if (CONT_MARKER.test(m.rest) && reachesDescendantQuote(k, docColumn(lines[at]!, m.rest))) {
          const written = ' '.repeat(frames[k - 1]!.canon) + '> '
          out += written
          // Written over the line's own indentation, so its columns still map to the source.
          if (src.startsWith(' '.repeat(written.length))) {
            src = src.slice(written.length)
            m = indentCols(src)
            rewritten = true
          }
          viewDoc = f.viewEnd!
          quotes++
          continue
        }
        if (!isQuoteLine(m.rest)) break
        quotes++
        lead(frames[k - 1]!.canon)
        take(src.length - quoteRest(src).length)
        viewDoc = docColumn(lines[at]!, src)
        m = indentCols(src)
        stripped = null
        frameReach = false
        segment = k + 1
        reached = k
        continue
      }
      const tabLead = hasLeadingTab(src, m.rest)
      const markerWithTab = tabLead && (tabbedMarkerOutsideCode(m.rest, top()) || tabbedItemNoteQuote(m.rest, frames, k))
      if (tabLead) {
        stripped ??= tabColumnInFrames(src, frames, segment)
        // Normalize before deciding reach. An identical later marker must not gain
        // a new column merely because the first one opened a child frame.
        if (markerWithTab && stripped !== m.col) {
          lineCuts.push({ at: out.length, removed: src.length - m.rest.length - stripped })
          src = ' '.repeat(stripped) + m.rest
          m = indentCols(src)
        }
      }
      // A tab-led line reaches a frame by its per-frame column, also when its line-start column does (carve#5755).
      if (m.rest !== '' && (m.col < f.col || tabLead)) {
        if (stripped === null || stripped < f.col) break
        frameReach ||= m.col < f.col || markerWithTab
      }
      reached = k
    }
    // The frame columns decided the reach, so the readers see that run as spaces. A code
    // payload line keeps its authored lead: the payload reader measures it (carve#5755).
    if (frameReach && stripped !== null && respellsFrameTab(top(), stripped, m)) {
      frameShift = stripped - m.col
      lineCuts.push({ at: out.length, removed: src.length - m.rest.length - stripped })
      src = ' '.repeat(stripped) + m.rest
      m = indentCols(src)
    }
    reached = standInvisibleLine(reached, plus !== null)
    reached = endQuoteBlockAtBlank(reached)
    reopenPlus()
    function endQuoteBlockAtBlank(depth: number): number {
      if (!quoteBlock || m.rest !== '' || top().kind === 'fence') return depth
      const ended = Math.min(depth, quoteBlock.depth)
      quoteBlock = null
      return ended
    }
    function reopenPlus(): void {
      if (plus || payloadPlus || !attachedHost || !CONT_MARKER.test(m.rest)) return
      plus = reopenAttachedHost(attachedHost)
      if (plus) plusReason = claimedMarkers.has(at) ? 'claimed' : refusal(at, docColumn(lines[at]!, m.rest), quotes, plus.kind, out, contentColumn(plus))
    }
    const consumeMarker = (): boolean => {
      const host = plus
      if (host === null) return false
      // S2: a lone `+` at a marker column (CARVE-P9-067).
      const crossedDescendant = frames.indexOf(host) < frames.length - 1
      frames.length = frames.indexOf(host) + 1
      lead(host.markerCanon!)
      if (plusReason !== null) {
        refuse(plusReason, host.kind)
        host.para = false
        consumedMarkers.add(at)
        if (plusReason === 'sibling' && attachedHost?.some((frame) => frame.kind === 'quote')) quoteSiblingSeparators.add(at)
        src = ' '.repeat(plusReason === 'claimed' || crossedDescendant ? 0 : Math.max(0, host.canon - host.markerCanon!)) + '%%'
        rewritten = true
        finish()
        if (trace) emit(at, 'S2', ownerPath(), 'CARVE-P9-067', 'plus', { cell: 'B-plus-start' })
        // A marker an earlier accepted `+` claimed stays in that chain, so its follower still meets the host.
        if (plusReason === 'claimed' && host.plus !== undefined) afterPlus = true
        // A refused second marker ends a marker-line `+` note; its item reads the next block (carve#5515).
        // A note whose `+` attached a block keeps the next line (carve#5890).
        if (host.kind === 'note' && host.plusBody && frames.at(-2)?.kind === 'item' &&
            !lines.slice((host.line ?? at) + 1, at).some((line) => line.trim() !== '')) {
          frames.pop()
          if (attachedHost?.includes(host)) attachedHost = null
        } else if (host.kind === 'note') noteListBreaks.set(at, host.docMarker ?? 0)
        return true
      }
      attachedHost = frames.slice()
      attachedInlineCode = 0
      host.para = false
      finish()
      afterPlus = true
      if (trace) emit(at, 'S2', ownerPath(), 'CARVE-P9-067', 'plus', { cell: 'B-plus-start' })
      return true
    }
    if (consumeMarker()) continue
    if (CONT_MARKER.test(m.rest) && !(top().kind === 'fence' && reached === frames.length - 1)) spellStrayPlus(reached)
    if (attrRest && !frames.slice(reached + 1).some((f) => f.kind === 'quote')) {
      // A continuation stays in the block's owner at any column.
      lead(Math.max(m.col - attrRest.cut, attrRest.floor ?? top().canon))
      finish()
      if (--attrRest.left === 0) attrRest = null
      continue
    }
    attrRest = null
    const plusFollower = afterPlus
    afterPlus = false
    // The block a `+` attaches at its marker's column moves with the marker, and so does
    // every line after it (PART 0 S3, carve#4245).
    if (plusFollower && m.rest !== '' && reached < frames.length - 1 && m.col >= top().markerCol!) {
      frames[reached]!.cut = Math.max(frames[reached]!.cut, top().markerCol! - top().markerCanon!)
    }
    if (handsBackAttachedHost()) reached = frames.length - 1
    const missed = reached < frames.length - 1
    reach = reached
    const inner = top()
    const colonEndsItem = colonAtDefinitionItem(m.rest, m.col, frames)
    const inCommentSpan = holdsCommentSpan(inner)
    // A comment closer below its host's column still closes the span (PART 9 §28).
    const closesBelowColumn = (): boolean => {
      if (inner.kind !== 'fence' || inner.family !== 'comment' || !missed || inner.span || m.rest === '' || !inner.closes!(m.rest, m.col)) return false
      frames.pop()
      top().last = 'block'
      // The closer remains in the span's host; S1 only selects its next owner.
      // Restore the quote markers skipped while reaching below that host.
      for (let k = reached + 1; k < frames.length; k++) {
        if (frames[k]!.kind === 'quote') out += ' '.repeat(frames[k - 1]!.canon) + '> '
      }
      out += ' '.repeat(top().kind === 'quote' ? 0 : top().canon)
      src = m.rest
      finish()
      if (trace) emit(at, 'S1', ownerPath(), 'CARVE-P0-005', 'closer', { cell: 'B-comment-end' })
      return true
    }
    if (closesBelowColumn()) continue
    if (inner.kind === 'fence' && !missed) {
      readPayload(inner)
      continue
    }
    // A comment line below the column stays in an open `%%%` span, its own or a
    // line block's, and an exact-width run there closes it (PART 0 S1, PART 9 §28, carve#4987).
    const keepsBelowColumnComment = (): boolean => {
      const spanRun = inner.kind !== 'fence' ? null
        : inner.family === 'comment' && !inner.span ? true
          : inner.lineBlock && inner.span?.[0] === '%' ? inner.span : null
      if (!spanRun || !missed || !m.rest.startsWith('%%') || frames.slice(reached + 1).some((f) => f.kind === 'quote')) return false
      if (spanRun !== true && COMMENT_FENCE.exec(m.rest)?.[1]!.length === spanRun.length) inner.span = null
      payloadLines.add(at)
      lead(m.col)
      finish()
      if (trace) emit(at, 'S1', ownerPath(), 'CARVE-P0-005', 'payload', { cell: `B-${inner.family}-keep` })
      return true
    }
    const readsMissedLine = (): boolean => {
      if (!keepsMissedLineBlock(inner, missed, reached)) return keepsBelowColumnComment()
      // S1 ends a verse comment span at the first non-comment line that
      // misses its owner. The open stanza may still take that line under S4.
      if (holdsCommentSpan(inner) && !m.rest.startsWith('%%')) inner.span = null
      // The stanza takes it as a lazy line (PART 0 S4), so a reader's boundary keeps it (carve-js#4614).
      lazyLines.add(at)
      readPayload(inner, true, reached)
      return true
    }
    if (readsMissedLine()) continue
    const leftLineBlockSpan = holdsCommentSpan(inner)
    if (inner.kind === 'fence') frames.pop()
    let owner = frames[reached]!
    if (m.rest !== '') for (const f of frames) if (f.closedList && m.col < f.closedList.col) f.closedList = undefined
    const classified = classify(m.rest, owner, at, m.col)
    const laterCloser = (): boolean => {
      const key = `${quotes}:${owner.col}:${m.col}:${/^(`{3,}|~{3,})/.exec(m.rest)?.[1] ?? ''}`
      const cached = laterCloserCache.get(key)
      if (cached && at < cached.through) return cached.paired
      const remember = (through: number, paired: boolean): boolean => (laterCloserCache.set(key, { through, paired }), paired)
      for (let next = at + 1; next < lines.length; next++) {
        const measured = quotedMeasure(next, quotes)
        if (measured === null || measured.rest !== '' && measured.col < owner.col) return remember(next, false)
        if (measured.rest !== '' && classified.closes!(measured.rest, measured.col)) return remember(next, true)
      }
      return remember(lines.length, false)
    }
    function advanceAttachedForm(form: Form): Form {
      // Block-shaped lines inside a paragraph's open code span remain text in
      // the attachment. A later marker can then reach the same live host.
      const hostForSpan = (attachedHost as Frame[] | null)?.at(-1)
      const shiftedOpener = hostForSpan && m.col > hostForSpan.markerCol! && m.col < hostForSpan.col &&
        PURE_FENCE.test(m.rest)
      const definition = isLinkDefLine(m.rest) || FOOTNOTE_DEF.test(m.rest) || RE_ABBR_DEF.test(m.rest)
      if (attachedHost && attachedInlineCode !== 0 && m.rest !== '' && !plusFollower &&
          form.kind !== 'quote' && !shiftedOpener && !definition) form = TEXT
      attachedInlineCode = attachedHost && form.kind === 'text' && m.rest !== ''
        ? pairAttachedCode(m.rest, attachedInlineCode) : 0
      if (trailingPlusText(form, m.rest)) spellTrailingPlusAsLetter()
      trackQuoteBlock(form, owner, plusFollower)
      if (!plusFollower && attachedBlockEnded(form, owner, reached)) {
        attachedHost = null
        attachedInlineCode = 0
      }
      return form
    }
    let form = advanceAttachedForm(foldReleasedFence(classified, owner, m.col, at, lazyLines, laterCloser))
    // Past a missed note a marker opens where an item or a description body owns it (§10 I2), or beside a missed list.
    // A missed quote keeps the line as the quote's lazy text.
    const missedFrames = framesPast(frames, reached)
    const missedNote = missed && missedFrames.some((f) => f.kind === 'note')
    const openNote = missedFrames.find((f) => f.kind === 'note')
    // A plus below a note's marker column is a letter. When it is the first
    // line after the note's first-block plus, give it the same body column as
    // any other text follower before the reader sees the sentinel letter.
    if (offColumnFirstBlockNotePlus(openNote, at, lines, form, m.col)) {
      lineCuts.push({ at: out.length, removed: m.col - openNote.col })
      out += ' '.repeat(openNote.col)
      src = m.rest
      finish()
      openNote.para = true
      openNote.last = 'para'
      if (trace) emit(at, 'S5', ownerPath(), 'CARVE-P0-024', 'text')
      continue
    }
    // A `: ` line is a description sibling at any column where its list's owner reads it (CARVE-P0-024 S3).
    // A caption at its owner's block column attaches to the quote it follows and is never its lazy line (CARVE-P2-008, carve#4312).
    const captionsQuote = captionMissesQuote(missed, m.rest, m.col, frames[reached]!, missedFrames)
    if (missed && !captionsQuote && foldsLazily(form, owner)) {
      // S4: a lazy line stays text where it stands, short of the frame it missed.
      // Past a note a marker folds too, so the readers must not meet it as one (carve#4160).
      if ((missedNote || foldsPastDescription(owner)) && form.kind === 'item' && !plusFollower) spellMarkerAsLetter()
      recordLazyCaption(lazyCaptions, missedNote, m.rest, at)
      if (TRAILING_PLUS.test(m.rest) && !lazyMarkerLineAttaches(form)) spellTrailingPlusAsLetter()
      leadLazy(owner)
      finish()
      lazyLines.add(at)
      if (trace) emit(at, 'S4', ownerPath(), 'CARVE-P0-006', 'lazy', { reached: ownerPath(reached) })
      continue
    }
    // A paragraph a `+` attaches at an item's marker column stays in the item (§17 L3),
    // so a sibling marker interrupts it (carve#4080).
    const lonePlus = plusFollower ? frames[reached + 1] : undefined
    if (lonePlus && attachesParagraph(lonePlus, form)) {
      lead(lonePlus.markerCanon!)
      finish()
      lonePlus.para = true
      lonePlus.last = 'para'
      if (trace) emit(at, 'S5', ownerPath(), 'CARVE-P0-024', 'text', { plus: at })
      continue
    }
    // An attribute run after it leads the `+`'s one block, so the item stays open for the line
    // after the run (CARVE-P0-008, corpus 325). A description-hosted list's readers refuse that `+`.
    if (lonePlus && attrRunLeads(lonePlus, form)) {
      leadAttrRun(lonePlus, form)
      continue
    }
    // Any other block it attaches there meets the `+` where the walk moved it (§17 L3, carve#4367).
    const plusLanding = lonePlus && landsAtMarker(lonePlus, form) ? lonePlus.markerCanon! : null
    resumeAttachedHost()
    const formColumn = m.col
    // S5: apply the line where it reached, closing every frame it missed (T, CARVE-P0-003).
    const closed = frames.length - 1 - reached
    const reachedPath = trace && closed > 0 ? ownerPath(reached) : undefined
    const closedFrames = framesPast(frames, reached)
    const closedColumn = closesAColumn(closedFrames)
    const closedDescription = closedFrames.some((f) => f.plusBody)
    const sibling = frames[reached + 1]
    const traceParent = trace ? ownerPath(reached) : ''
    truncateFrames(frames, reached + 1)
    owner = top()
    if (m.rest !== '') keepClosedShift(owner, sibling)
    let appliedPath: string | null = null
    if (m.rest === '') {
      owner.para = false
      lead(m.col)
    } else if (form.kind === 'colon-close') {
      lead(frames[form.frame!]!.canon)
      if (trace) appliedPath = ownerPath(form.frame)
      frames.length = form.frame!
      top().para = false
      top().last = 'block'
    } else if (form.kind === 'text') {
      noteOpener(owner, form, owner.col, plusFollower)
      applyText(owner, closedColumn, plusFollower)
    } else if (plusLanding !== null) {
      lead(plusLanding)
      apply(owner, m.col, form, plusLanding)
    } else {
      noteOpener(owner, form, owner.col, plusFollower)
      const opener = openerFrame(form, src, m, frames, segment)
      verseShift = opener.shift
      frameVerse = opener.frameVerse
      if (opener.readsVerse) frameVerseOpeners.add(at)
      lead(owner.canon, opener.spaces, opener.perFrame, opener.from)
      apply(owner, m.col, form, owner.canon, !leftLineBlockSpan)
    }
    if (form.kind === 'quote' && plusFollower) markFirstBlockQuote(sibling)
    if (form.kind === 'item') markListNote(top(), owner, sibling, plusFollower, at)
    if (plusFollower) {
      markUnclosedAttachedFence(form)
      holdResumableHost(sibling, form, formColumn)
    }
    if (plusFollower && closedDescription) owner.last = 'dd'
    finish()
    if (trace) {
      const route = firstBlockTraceRoute(traceParent, sibling, plusFollower, at, form,
        appliedPath ?? ownerPath(), frames.length > reached + 1, closed, reachedPath)
      traceApply(at, form, route, plusFollower)
    }

    function holdResumableHost(host: Frame | undefined, form: Form, formColumn: number): void {
      if (!host || !RESUMING_HOSTS.has(host.kind) || host.plus !== at - 1 || formColumn !== host.markerCol ||
          !form.interrupts || form.kind === 'item' || form.kind === 'colon-close') return
      const block = frames[reached + 1] ?? null
      // An unclosed block ends at its first blank, where `handsBackAttachedHost` picks the owner (carve#5404).
      if (block?.endsAtBlank) return
      const hostFrames = frames.slice(0, reached + 1)
      hostFrames.push(host)
      resumable.push({ host: hostFrames, block, table: form.table === true, last: at })
    }

    // The block a marker-line `+` took has ended when its frame is closed or missed, or past a leaf's line.
    function resumeAttachedHost(): void {
      for (let index = resumable.length - 1; index >= 0; index--) {
        const held = resumable[index]!
        if (held.last === at) continue
        const host = held.host.at(-1)!
        if (frames.includes(host)) {
          resumable.splice(index, 1)
          continue
        }
        const parent = held.host.length - 2
        if (reached !== parent || frames[parent] !== held.host[parent]) continue
        if (held.block ? frames.includes(held.block) && frames.indexOf(held.block) <= reached
          : held.table && form.table === true && m.rest !== '' &&
            m.col >= host.markerCol! - 1 && m.col <= host.markerCol! && held.last === at - 1) {
          held.last = at
          continue
        }
        // Resuming an outer host also retires claims made inside its ended block.
        resumable.splice(index)
        if (m.rest !== '' && m.col < host.col) continue
        truncateFrames(frames, parent + 1)
        frames.push(host)
        host.para = false
        host.last = 'block'
        reached = parent + 1
        owner = host
        form = classify(m.rest, owner, at, m.col)
        return
      }
    }

    // S1: an open payload tests its closer first.
    function readPayload(inner: Frame, lazyMissed = false, lazyReached = -1): void {
      payloadLines.add(at)
      const payloadPath = trace ? ownerPath() : ''
      let payloadForm = 'payload'
      const nestedCodeTab = inner.family === 'code' && !inner.tabbedCodeOpener &&
        hasNestedItemFrame(frames) && hasLeadingTab(src, m.rest)
      const closerColumn = nestedCodeTab || inner.tabShift !== undefined && hasLeadingTab(src, m.rest)
        ? tabColumnInFrames(src, frames, segment) : m.col
      const pairedCloser = inner.family === 'code' && pairedCodeClosers.has(at) &&
        (!nestedCodeTab || closerColumn <= inner.canon + inner.cut)
      // A closer under a code opener read per frame is written as spaces, like its opener.
      const tabbedCloser = (inner.tabShift !== undefined && closerColumn !== m.col || inner.verseShift !== undefined && hasLeadingTab(src, m.rest)) &&
        m.rest !== '' && !inner.span && inner.closes!(m.rest, closerColumn)
      // A tab lead is measured per frame, so the payload keeps the columns its space spelling keeps (carve#5755).
      const perFramePayload = !tabbedCloser && framePayload(inner, pairedCloser, src, m, closerColumn)
      const frameColumn = tabbedCloser ? closerColumn
        : perFramePayload ? stripped ?? tabColumnInFrames(src, frames, segment) : m.col
      // A tabbed verse keeps its per-frame column less the opener's (§23, carve#5755).
      const verseColumn = inner.lineBlock && !lazyMissed && !tabbedCloser ? frameColumn - (inner.verseShift ?? 0) : m.col
      lead(pairedCloser || tabbedCloser && inner.lineBlock ? inner.canon : payloadColumn(m.rest, verseColumn, inner, lazyMissed, inCommentSpan, frames),
        tabbedCloser || frameColumn !== m.col, tabbedCloser || frameColumn !== m.col, frameColumn)
      const inComment = inner.span?.[0] === '%'
      if (m.rest !== '' && inner.span) {
        const c = inner.span[0] === '%' ? COMMENT_FENCE.exec(m.rest) : PURE_FENCE.exec(m.rest)
        if (c && c[1]![0] === inner.span[0] &&
            (inner.span[0] === '%' ? c[1]!.length === inner.span.length : c[1]!.length >= inner.span.length)) inner.span = null
      } else if (pairedCloser || m.rest !== '' && inner.closes!(m.rest, closerColumn)) {
        frames.pop()
        top().last = inner.entryLast ?? 'block'
        payloadForm = 'closer'
      } else if (inner.lineBlock) {
        // A span in a line-block payload pairs past the column too (carve-php#3137).
        const f = RE_FENCE.test(m.rest) || RE_RAW_FENCE.test(m.rest) ? /^(`{3,}|~{3,})/.exec(m.rest)![1]! : null
        const comment = COMMENT_FENCE.exec(m.rest)
        if (f && versePayloadRunPairs(f, at)) inner.span = f
        else if (comment) inner.span = comment[1]!
      }
      // A `%%%` span leaves nothing, so the stanza it interrupted stays as it was (carve#4956).
      if (inner.lineBlock && !inComment && inner.span?.[0] !== '%') inner.para = m.rest !== ''
      finish()
      if (!trace) return
      if (lazyReached >= 0) emit(at, 'S4', payloadPath, 'CARVE-P0-006', 'lazy', { reached: ownerPath(lazyReached) })
      else emit(at, 'S1', payloadPath, 'CARVE-P0-005', payloadForm, { cell: `B-${inner.family}-${payloadForm === 'closer' ? 'end' : 'keep'}` })
    }

    function keepsMissedLineBlock(inner: Frame, missed: boolean, reached: number): boolean {
      if (inner.kind !== 'fence' || !inner.lineBlock || !missed || !inner.para || m.rest === '' || colonEndsItem ||
          // Only text folds into the stanza; a marker that opens in the reached body ends it (PART 0 S1, S4).
          classify(m.rest, frames[reached]!, at, m.col).kind !== 'text') return false
      // An open payload span cannot carry the stanza past a quote the line missed (carve#5062).
      if (inner.span && inner.span[0] !== '%' && frames.slice(reached + 1).some(f => f.kind === 'quote')) return false
      const marker = matchMarker(m.rest)
      if (marker !== null && frames.slice(reached + 1).some(f => f.kind === 'quote') &&
          frames[reached]?.kind === 'item' && m.col >= frames[reached]!.col) return false
      return marker === null || !frames.slice(1).some(f => f.kind === 'item' && f.markerCol !== undefined &&
        m.col <= f.markerCol)
    }

    // S4: a lazy line is written short of the frame it missed.
    function leadLazy(owner: Frame): void {
      const next = frames[reached + 1]!
      const limit = next.kind === 'quote' ? Infinity : next.canon - 1
      // A line at or past a missed list's column moves with that list, until one left of it
      // starts what the readers reopen. A description left of its term is measured from its own line.
      const listCol = Math.min(next.listCol!, next.markerCol!)
      if (m.col < listCol) next.leftOfList = true
      const outer = owner.closedList && m.col < listCol && m.col >= owner.closedList.col ? owner.closedList.shift : 0
      const shift = m.col >= listCol && !next.leftOfList ? Math.min(next.listShift!, next.markerCol! - next.markerCanon!) : outer
      const cut = owner.termShift !== undefined && owner.last === 'term' ? owner.termShift
        : owner.termShift !== undefined && owner.last === 'dd' ? Math.min(owner.termShift, owner.ddShift!)
          : Math.max(owner.cut, shift)
      lead(Math.min(Math.max(m.col - cut, owner.canon), limit))
    }

    // A lazy marker that misses a description is text too: past a description holding a list it is
    // that list's lazy text (carve#4479), and where a quote owns it a quote takes no tight sublist (carve#4231).
    function foldsPastDescription(owner: Frame): boolean {
      return frames[reached + 1]?.kind === 'dd' &&
        (owner.kind === 'quote' || top().kind === 'item' && owner.kind !== 'item' && owner.kind !== 'dd')
    }

    function foldsLazily(form: Form, owner: Frame): boolean {
      const held = resumable.at(-1)
      if (form.caption && held?.block?.kind === 'quote' && m.col === held.host.at(-1)!.col) return false
      return m.rest !== '' && top().para && !form.interrupts && form.kind !== 'dd' && !colonEndsItem &&
        // A marker that a marker body owns, or that misses one, opens a list (PART 0 S3, carve#4860).
        !(form.kind === 'item' && (BODY_FRAME.has(owner.kind) || frames.slice(reached + 1).some((f) => BODY_FRAME.has(f.kind) || f.firstBlockQuote)))
    }

    function attachesParagraph(host: Frame, form: Form): boolean {
      return (host.kind === 'item' || (host.kind === 'dd' || host.kind === 'note') && host.plus === at - 1) &&
        reached === frames.length - 2 && form.kind === 'text' && m.rest !== ''
    }

    function attrRunLeads(host: Frame, form: Form): boolean {
      const pulledDescription = (host.kind === 'dd' || host.kind === 'note') && host.plus === at - 1
      if ((host.kind !== 'item' || frames[reached]!.kind === 'dd') && !pulledDescription) return false
      if (reached !== frames.length - 2 || m.col !== host.markerCol ||
        (form.attrLines === undefined && !isAttrLine(trimEndSpaceTab(m.rest)))) return false
      // The block it leads stands at the item's content column, or at the marker column the `+` pulls it to.
      const after = lineAfterRun(at + 1 + (form.attrLines ?? 0), reached)
      return after >= host.col || after === host.markerCol
    }

    function leadAttrRun(host: Frame, form: Form): void {
      if (form.attrLines) attrRest = { left: form.attrLines, cut: m.col - host.markerCanon!, floor: host.markerCanon! }
      // The pulled block is the one after the run.
      host.plus = at + (form.attrLines ?? 0)
      lead(host.markerCanon!)
      finish()
      afterPlus = true
      if (trace) emit(at, 'S5', ownerPath(), 'CARVE-P0-024', 'leaf', { plus: at })
    }

    function landsAtMarker(host: Frame, form: Form): boolean {
      return host.kind === 'item' && reached === frames.length - 2 && m.col === host.markerCol && m.rest !== '' &&
        !(!COMMENT_FENCE.test(m.rest) && COMMENT_LINE.test(m.rest)) && !(isLinkDefLine(m.rest) && !FOOTNOTE_DEF.test(m.rest)) &&
        !['text', 'item', 'dd', 'term', 'colon-close'].includes(form.kind)
    }

    // A line at or past an indented list or term run that ends there keeps its shift for the lines after it.
    function keepClosedShift(owner: Frame, sibling: Frame | undefined): void {
      if (sibling?.listShift! > 0 && m.col >= sibling!.listCol!) owner.closedList = { col: sibling!.listCol!, shift: sibling!.listShift! }
      else if (owner.last === 'term' && owner.termShift! > 0 && m.col >= owner.canon + owner.termShift!) {
        owner.closedList = { col: owner.canon + owner.termShift!, shift: owner.termShift! }
      }
    }

    function applyText(owner: Frame, closedColumn: boolean, plusFollower: boolean): void {
      // A new paragraph starts at the owner's column, never inside a frame it did not reach.
      // The block a `+` attaches to a description moves with its term.
      const attached = plusFollower && owner.termShift !== undefined && owner.last === 'dd'
      const cut = attached ? owner.termShift! : Math.max(owner.cut, owner.closedList?.shift ?? 0)
      lead(owner.para || !closedColumn || plusFollower ? Math.max(m.col - cut, owner.canon) : owner.canon)
      owner.para = true
      owner.last = 'para'
    }

    // `col` is where the opener starts in the source, `canon` where it lands.
    function markFirstBlockQuote(host: Frame | undefined): void {
      if ((host?.kind !== 'item' && host?.kind !== 'dd' && host?.kind !== 'note') || host.plus !== at - 1) return
      const quote = frames.find((f) => f.kind === 'quote' && f.line === at)
      if (quote) quote.firstBlockQuote = true
      // Like a list, a note's first-block quote leaves a `+` at their shared marker column to the note (carve#5890).
      if (quote && host.kind === 'note') quote.listNote = host
    }

    function apply(owner: Frame, col: number, form: Form, canon = owner.canon, inHost = false): void {
      // A caption folds its next lines like a paragraph, list marker shapes too (CARVE-P2-021).
      owner.para = form.caption === true || form.para === true
      const invisibleLeaf = form.kind === 'leaf' &&
        (COMMENT_LINE.test(m.rest) || isLinkDefLine(m.rest) || RE_ABBR_DEF.test(m.rest))
      // A matched `%%%` span in an entry closes neither term nor description (CARVE-P9-013, carve#4901).
      const spanInEntry = form.family === 'comment' && (owner.last === 'term' || owner.last === 'dd')
      if (!invisibleLeaf && !spanInEntry) owner.last = form.kind
      owner.tableLine = form.table ? at : undefined
      if (form.attrLines) attrRest = { left: form.attrLines, cut: col - canon }
      if (form.kind === 'term') recordDefinitionTerm(frames, owner, col)
      if (form.kind === 'dd') owner.ddShift = col - owner.canon
      if (form.kind === 'fence' || form.kind === 'colon') {
        // A comment payload is host-relative; the opener's indentation sets no base (CARVE-P9-060).
        const cut = form.family === 'comment' && inHost ? owner.col - owner.canon : col - canon
        frames.push({ kind: form.kind, family: form.family ?? 'div', opened: at, col: owner.col, canon: owner.canon, cut,
          closes: form.closes, run: form.run, lineBlock: form.lineBlock, span: null, para: false, last: null,
          tabbedCodeOpener: form.family === 'code' && hasLeadingTab(lines[at]!, lines[at]!.trimStart()),
          ...(form.family === 'code' && frameShift !== 0 ? { tabShift: frameShift } : {}),
          ...(form.lineBlock && verseShift !== 0 ? { verseShift } : {}),
          ...(frameVerse ? { frameVerse } : {}),
          entryLast: spanInEntry ? owner.last! : undefined })
        return
      }
      if (form.kind === 'quote') {
        const quote: Frame = { kind: 'quote', col: 0, canon: 0, cut: 0, para: false, last: null, markerCol: col, markerCanon: canon,
          docMarker: docColumn(lines[at]!, src), viewMarker: docColumn(lines[at]!, src) - viewDoc, line: at }
        frames.push(quote)
        take(src.length - quoteRest(src).length)
        viewDoc = quote.viewEnd = docColumn(lines[at]!, src)
        m = indentCols(src)
        content(quote, 0, 0)
        return
      }
      if (form.kind === 'item' || form.kind === 'note' || form.kind === 'dd') {
        const frame: Frame = { kind: form.kind, col: col + form.width!, canon: canon + form.width!,
          cut: col - canon, para: false, last: null, markerCol: col, markerCanon: canon, axes: form.axes,
          docMarker: docColumn(lines[at]!, src), line: at }
        // A sibling keeps its list's column and shift.
        const first = owner === frames[reached] && sibling?.kind === form.kind && sibling.axes === form.axes ? sibling : frame
        frame.listCol = first.listCol ?? col
        frame.listShift = first.listShift ?? col - canon
        frames.push(frame)
        const head = src.slice(0, form.head!)
        take(form.head!)
        m = indentCols(src)
        const tabLead = (head + src.slice(0, src.length - m.rest.length)).includes('\t')
        content(frame, col + form.head!, canon + form.head!)
        // Content behind a lead tab is text to the readers, so it opens no row for a `+` to continue.
        if (tabLead) frame.tableLine = undefined
      }
    }

    // An opener past a non-item owner's content column. List items and markers have their own lint rules.
    function noteOpener(owner: Frame, form: Form, contentColumn: number, plusFollower = false): void {
      if (plusFollower) return
      const kind = openerKind(form, m.rest)
      if (kind === 'table row') {
        if (owner.tableLine === at - 1) return
      }
      if (!kind || owner.kind === 'item' || owner.kind === 'fence' || m.col <= contentColumn) return
      overindented.push({ index: at, char: lines[at]!.length - m.rest.length, kind,
        owner: owner.kind, contentColumn, column: m.col })
    }

    // The rest of a marker line. Only a quote starts new coordinates, so only there can its content move.
    function content(frame: Frame, start: number, canon: number): void {
      if (m.rest === '' || frames.length > MAX_FRAMES) return
      // CARVE-P2-010: behind an item marker's tab the line is text, whatever it spells; a quote has no such rule.
      const leadTab = frame.kind !== 'quote' && src.slice(0, src.length - m.rest.length).includes('\t')
      const form = leadTab ? TEXT : classify(m.rest, frame, at, frame.kind === 'quote' ? m.col : start + m.col)
      if (form.kind === 'text') {
        let refusedMarker = false
        if (leadTab && frames.some((f) => f.kind === 'quote')) {
          tabQuoteFollower.value = { at, depth: frames.filter((f) => f.kind === 'quote').length }
        }
        if (!leadTab && CONT_MARKER.test(m.rest)) {
          frame.plusBody = true
          // Past the one space after a `>` and behind a lead tab, the `+` is text.
          const reason = frame.kind === 'quote' && m.col > 0 || leadTab ? 'right'
            : refusal(at, frame.docMarker!, frames.filter((f) => f.kind === 'quote' && f !== frame).length, frame.kind, undefined, contentColumn(frame))
          if (frame.kind === 'quote' && m.col > 0) {
            spellPlusAsLetter()
          } else if (reason !== null) {
            refuse(reason, frame.kind, true)
            respell('%%')
            consumedMarkers.add(at)
            rewritten = true
            refusedMarker = true
            if (frame.kind === 'note') noteTextFollower.value = { at, prefix: noteReaderPrefix(), item: false }
            if (frame.kind === 'item' && frames.some((f) => f.kind === 'note')) {
              noteTextFollower.value = { at, prefix: noteReaderPrefix() + '    ', item: true }
            }
          } else {
            afterPlus = true
            frame.plus = at
            attachedHost = frames.slice()
            if (frame.kind === 'item' && frames.some((f) => f.kind === 'note')) {
              noteTextFollower.value = { at, prefix: noteReaderPrefix() + '    ', item: true }
            }
          }
        }
        lead(m.col)
        // A refused `+` opens no paragraph in any host (PART 9 §17 L3, carve#5156).
        frame.para = !refusedMarker && frame.plus !== at
        frame.last = refusedMarker ? null : 'para'
        return
      }
      if (frame.kind === 'quote') {
        const col = m.col
        noteOpener(frame, form, 0)
        lead(0)
        apply(frame, col, form, 0, true)
        return
      }
      const col = start + m.col
      lead(m.col)
      apply(frame, col, form, canon + m.col)
    }

    // A colon block a `+` attached to a description ends at that description's sibling (carve#4798).
    function endAttachedColonAtSibling(): void {
      const host = attachedHost?.at(-1)
      if (host?.kind !== 'dd') return
      if (top().kind !== 'colon' || frames.length !== attachedHost!.length) return
      let line = m
      for (const frame of frames) {
        if (frame.kind !== 'quote') continue
        if (!isQuoteLine(line.rest)) return
        line = indentCols(quoteRest(line.rest))
      }
      if (line.col >= host.col || !(DD.test(line.rest) || DEFLIST_TERM.test(line.rest))) return
      frames.length = attachedHost!.length - 1
      top().last = 'dd'
      top().para = false
      attachedHost = null
    }

    // Measured through the quotes that hold the fence, as the frame walk reads them.
    function plusInCodePayload(): boolean {
      const fence = top()
      // So is one in an attached colon body that has not ended.
      if (fence.attachedColon) return true
      if (fence.kind !== 'fence' || fence.family !== 'code') return false
      let n = indentCols(src)
      for (let k = 1; k < frames.length - 1; k++) {
        if (frames[k]!.kind !== 'quote') continue
        if (!isQuoteLine(n.rest)) return false
        n = indentCols(quoteRest(n.rest))
      }
      return CONT_MARKER.test(n.rest) && n.col >= fence.col
    }

    // A `+` at the saved quote's marker column continues that quote after
    // its previously attached block, even if that block left an item open.
    // A prefixed `+` behind the quote's own `>` does the same (carve#5132).
    function restoreAttachedQuote(): void {
      const host = attachedHost?.at(-1)
      if (payloadPlus || host?.kind !== 'quote' || frames.includes(host)) return
      const rest = restInQuotes(at, attachedHost!.filter((f) => f.kind === 'quote').length)
      const follower = lines[at + 1]
      const atMarker = CONT_MARKER.test(m.rest) && docColumn(lines[at]!, m.rest) === host.docMarker &&
        (follower === undefined || follower.trim() === '' ||
          docColumn(follower, follower.trimStart()) === host.docMarker)
      if (!atMarker && (rest === undefined || !CONT_MARKER.test(trimEndSpaceTab(rest).trimStart()))) return
      frames.length = 0
      frames.push(...attachedHost!)
    }

    function markUnclosedAttachedFence(form: Form): void {
      if (top().opened !== at) return
      if (form.kind === 'colon' && top().kind === 'colon') top().attachedColon = true
      const host = attachedHost?.at(-1)
      const markerLine = host?.plus === host?.line
      if (form.family === 'code') {
        const closer = codeCloserAhead(top(), at, quotes)
        if (!closer.exists && markerLine) top().endsAtBlank = true
        if (closer.paired !== null) pairedCodeClosers.add(closer.paired)
      } else if (markerLine && (form.kind === 'colon' || form.lineBlock) && !colonCloserAhead(top(), at, quotes)) top().endsAtBlank = true
    }

    // The host whose `+` attached the fence goes on at its content column after the blank (§17 L4).
    function handsBackAttachedHost(): boolean {
      const host = attachedHost
      if (m.rest !== '' || !top().endsAtBlank) return false
      const topFence = top()
      const colon = top().kind === 'colon'
      // Only the first blank decides, so a run of blanks is scanned once.
      top().endsAtBlank = false
      // Every host that takes a marker-line `+` resumes here, not only an item (§17 L4, carve#5404).
      if (!host || !RESUMING_HOSTS.has(host.at(-1)!.kind)) return false
      if (colon) {
        const owner = nextLineOwner(host, at, quotes)
        frames.length = 0
        frames.push(...host.slice(0, owner + 1))
        top().last = 'block'
        return true
      }
      const nextOwner = nextLineOwner(host, at, quotes)
      if (nextOwner === 0 && topFence.lineBlock) {
        frames.length = 1
        top().last = 'block'
        return true
      }
      if (nextOwner < host.length - 1) {
        frames.length = 0
        frames.push(...host.slice(0, nextOwner + 1))
        top().last = 'block'
      } else {
        frames.length = 0
        frames.push(...host)
        top().last = 'block'
      }
      if (topFence.kind === 'fence' && topFence.family === 'code') {
        const released = quotedMeasure(topFence.opened!, quotes)
        if (released !== null) {
          const host0 = host.at(-1)!
          const stacked = host.some((frame) => frame !== host0 && frame.kind !== 'doc' && frame.line === host0.line)
          top().releasedFence = {
            minimumFoldColumn: host0.kind === 'item' && !stacked ? host0.col : released.col + (stacked ? 1 : 2),
          }
        }
      }
      return true
    }

    function reopenAttachedHost(host: Frame[]): Frame | null {
      const col = docColumn(lines[at]!, m.rest)
      const hostAt = host.findIndex((f, k) => k > 0 && f.docMarker === col &&
        host.slice(1, k).filter((o) => o.kind === 'quote').length === quotes)
      // A blank ends a quote the host stood in; only the host itself resumes past it (§17 L3).
      if (hostAt <= 0 || host[hostAt]!.kind === 'quote' && hostAt < host.length - 1 && at > 0 && lines[at - 1]!.trim() === '') return null
      frames.length = 0
      frames.push(...host.slice(0, hostAt + 1))
      return top()
    }

    function attachedBlockEnded(form: Form, owner: Frame, depth: number): boolean {
      // Only a held attachment can end; the checks below read the line again.
      if (!attachedHost) return false
      if (attachedInlineCode !== 0) return false
      // An attribute line leads the attached block, so the line after it still opens that block.
      if (at > 0 && isAttrLine(trimEndSpaceTab(lines[at - 1]!.replace(/^(?:[ \t]*>[ \t]?)*[ \t]*/, '')))) return false
      // A blank after an attached block still lets a later `+` reach any
      // live host, including notes and descriptions (PART 9 §17 L3).
      if (m.rest === '') return top().kind !== 'fence' && !RESUMING_HOSTS.has(attachedHost.at(-1)!.kind)
      // A later ancestor fence ends the old descendant's attachment.
      // Otherwise a `+` in its payload can reopen the old host.
      if (attachedHost && depth < attachedHost.length - 1 && form.kind === 'fence') return true
      return depth === 0 && !(owner.para && form.kind === 'text') && !isTableRow(m.rest) && form.kind !== 'item' && !isAttrLine(trimEndSpaceTab(m.rest))
    }

    function trackQuoteBlock(form: Form, owner: Frame, plusFollower: boolean): void {
      const host = attachedHost as Frame[] | null
      const opener = (): NonNullable<typeof quoteBlock>['opener'] => isAttrLine(trimEndSpaceTab(m.rest)) ? 'attr'
        : isTableRow(m.rest) ? 'table' : form.kind === 'item' || form.kind === 'term' ? form.kind : 'other'
      if (plusFollower) {
        quoteBlock = host?.at(-1)?.kind === 'quote' && reached < host.length - 1 && m.rest !== ''
          ? { depth: reached, opener: opener(), axes: form.axes } : null
        return
      }
      if (!quoteBlock || m.rest === '' || reached > quoteBlock.depth) return
      // An attribute line leads the attached block, so the line after it opens that block.
      if (quoteBlock.opener === 'attr') {
        quoteBlock.opener = opener()
        quoteBlock.axes = form.axes
        return
      }
      // The attached list, definition list or table goes on through its own siblings, a paragraph through its text.
      const continues = owner.para && form.kind === 'text' ||
        quoteBlock.opener === 'item' && form.kind === 'item' && form.axes === quoteBlock.axes ||
        quoteBlock.opener === 'term' && (form.kind === 'term' || form.kind === 'dd') ||
        quoteBlock.opener === 'table' && isTableRow(m.rest)
      if (!continues) quoteBlock = null
    }

    function lazyMarkerLineAttaches(form: Form): boolean {
      // A marker line lazy past a quote stays that quote's text, so its `+` starts nothing.
      if (frames.slice(reach + 1).some((f) => f.kind === 'quote')) return false
      if (form.kind === 'dd') return refusal(at, docColumn(lines[at]!, m.rest), quotes, 'dd') === null
      return form.kind === 'item' && refusal(at, innermostMarkerColumn(), quotes, 'item') === null
    }

    function innermostMarkerColumn(): number {
      let tail = m.rest
      let column = docColumn(lines[at]!, m.rest)
      for (let marker = matchMarker(tail); marker !== null; marker = matchMarker(tail)) {
        const next = tail.slice(marker.head)
        if (CONT_MARKER.test(next)) break
        column += marker.head
        tail = next
      }
      return column
    }

    function spellStrayPlus(depth: number): void {
      if (!refused) reportStray(depth)
      spellPlusAsLetter()
    }

    function refuse(reason: RefusedPlus['reason'], kind: Frame['kind'], firstBlock = false): void {
      refused = true
      const plusAt = lines[at]!.length - trimEndSpaceTab(lines[at]!).length
      refusedPlus.push({ index: at, column: docColumn(lines[at]!, lines[at]!.slice(lines[at]!.length - plusAt - 1)) + 1,
        host: LINT_HOST[kind] ?? 'document', reason, firstBlock })
    }

    // A `+` no marker column reached: the lint names the shapes that read as a mistaken marker.
    function reportStray(depth: number): void {
      const owner = frames[depth]!
      if (owner.kind === 'quote' && m.col === 0) {
        const reason = refusal(at, docColumn(lines[at]!, m.rest), quotes, 'item')
        if (reason !== null) refuse(reason, 'quote')
      } else if ((owner.kind === 'item' || owner.kind === 'dd' || owner.kind === 'note') && m.col === owner.col) {
        refuse('wrong-column', owner.kind)
      } else if (depth === 0 && m.col === 0 && frames.length === 1 && lines[at + 1] !== undefined &&
          indentCols(lines[at + 1]!).col === 0 && classify(lines[at + 1]!, owner, at + 1, 0).kind !== 'text' &&
          !COMMENT_LINE.test(lines[at + 1]!)) {
        refuse('unclaimed', 'doc')
      }
    }

    function spellPlusAsLetter(): void {
      respell(standIn('+') + m.rest.slice(1))
    }

    // A marker-line `+` read as text under an open paragraph starts no body.
    function spellTrailingPlusAsLetter(): void {
      respell(m.rest.replace(/\+([ \t]*)$/, `${standIn('+')}$1`))
    }

    function spellMarkerAsLetter(): void {
      const at = /[-*.)]/.exec(m.rest)!.index
      respell(m.rest.slice(0, at) + standIn(m.rest[at]!) + m.rest.slice(at + 1))
    }

    function respell(rest: string): void {
      src = src.slice(0, src.length - m.rest.length) + rest
      m = { col: m.col, rest }
    }
    function noteReaderPrefix(): string {
      const before = out.slice(0, out.lastIndexOf('[^'))
      return before.replace(/(?:[-*]|[0-9]+[.)]) /g, (marker) => ' '.repeat(marker.length)) + '  '
    }
  }
  return { lines: result, cuts, letters, refusedPlus, payloadLines, frameVerseOpeners, lazyCaptions, overindented, skippedAbbreviations, separatingAbbreviations, skippedComments: skippedComments.size > 0, skippedFences, consumedMarkers, quoteSiblingSeparators, noteListBreaks, lazyLines, rewritten }

  function standIn(ch: string): string {
    letters ??= pickSentinelRun(occupiedPrivateUse(lines), STAND_IN_BASE, STANDS_FOR.length)
    return letters[STANDS_FOR.indexOf(ch)]!
  }

  function contentColumn(host: Frame): number {
    return host.kind === 'item' || host.kind === 'dd' || host.kind === 'note' ? host.docMarker! + host.col - host.markerCol! : Infinity
  }

  // The one attach rule (carve#4409): the next line stands at `marker` through the
  // host's `quotes` prefixes and is not the host's sibling. The host decides nothing else.
  function reachesDescendantQuote(k: number, column: number): boolean {
    for (let c = k + 1; c < frames.length; c++) {
      const child = frames[c]!
      if (child.kind !== 'quote' || child.docMarker !== column) continue
      return true
    }
    return false
  }

  // `quoteLead` is the `+` line's written quote prefix, which its skipped followers share.
  // `content` is the host's content column: an invisible line the host keeps there is skipped too (carve#5130).
  function refusal(at: number, marker: number, quotes: number, host: Frame['kind'], quoteLead?: string, content = Infinity): RefusedPlus['reason'] | null {
    // An attribute run leads the attached block, so the block after it decides (carve#4278, carve#4447).
    const skippedAbbr: Array<[number, string, string]> = []
    const skippedLinks: number[] = []
    const comments: number[] = []
    const fenced = new Set<number>()
    const fences = new Map<number, number>()
    const missedSpans = new Set<number>()
    const closers = new Set<number>()
    const notes: number[] = []
    const chained: number[] = []
    const runOpeners = new Map<number, number>()
    const shifts = new Map<number, number>()
    let nextVisible = at + 1
    let firstKept = Infinity
    let firstPending = Infinity
    const decide = (reason: RefusedPlus['reason'] | null): RefusedPlus['reason'] | null => {
      // A refused `+` moves no line, so its skip ends at the first line off the marker column,
      // and a later `+` note it looked past decides its own block (carve#5542).
      if (reason !== null) firstKept = Math.min(firstKept, firstPending)
      if (reason !== null && firstKept !== Infinity) dropKept()
      // A later marker in the same forward search has already offered its
      // follower, even when the first marker ultimately refuses that block.
      for (const index of chained) claimedMarkers.add(index)
      if (reason !== null) for (const index of comments) refusedInvisibleFollowers.add(index)
      for (const [index, name, value] of skippedAbbr) {
        skippedAbbreviations.set(index, [name, value])
        if (reason !== null && reason !== 'sibling') separatingAbbreviations.add(index)
      }
      if (reason !== null && reason !== 'sibling') for (const index of skippedLinks) separatingLinks.add(index)
      if (reason !== null && reason !== 'sibling' && skippedLinks.length > 0 && (host === 'note' || host === 'dd')) releasedFollowers.add(nextVisible)
      for (const index of comments) {
        let rest = lines[index]!
        let prefix = ''
        for (let q = 0; q < quotes; q++) {
          const measured = indentCols(rest)
          if (!isQuoteLine(measured.rest)) break
          const body = quoteRest(measured.rest)
          prefix += rest.slice(0, rest.length - body.length)
          rest = body
        }
        if (quoteLead !== undefined && quotes > 0 && quoteLead.length < prefix.length) {
          cuts.set(index, [{ at: 0, removed: prefix.length - quoteLead.length }])
          prefix = quoteLead
        }
        // A line skipped past the marker column stands at it, so its indentation maps to no column.
        const opener = runOpeners.get(index)
        const shift = opener === undefined ? docColumn(lines[index]!, indentCols(rest).rest) - marker : shifts.get(opener) ?? 0
        const past = index >= firstKept ? Math.min(shift, /^ */.exec(rest)![0].length) : 0
        shifts.set(index, past)
        if (past > 0) {
          cuts.set(index, [...cuts.get(index) ?? [], { at: prefix.length, removed: past }])
          rest = rest.slice(past)
        }
        // Invisible lines between a marker and the first visible follower
        // remain invisible even when that marker is refused.
        // A line comment keeps its text; a fence's lines stay bare `%%` lines, since a body line
        // left as written would end the host. The closer's stand-in keeps its width for the span.
        const closer = fences.get(index)
        if (closer !== undefined) {
          const opener = indentCols(rest)
          const body: string[] = []
          const tail = trimNonNbsp(COMMENT_FENCE.exec(trimEndSpaceTab(opener.rest))![2]!)
          if (tail !== '') body.push(tail)
          for (let line = index + 1; line < (missedSpans.has(index) ? closer + 1 : closer); line++) {
            let text = lines[line]!
            for (let q = 0; q < quotes && isQuoteLine(indentCols(text).rest); q++) text = quoteRest(indentCols(text).rest)
            if (Number.isFinite(content)) {
              const start = docColumn(lines[line]!, text)
              let column = start
              let cut = 0
              while (cut < text.length && column < content && (text[cut] === ' ' || text[cut] === '\t')) {
                column = text[cut] === '\t' ? (Math.floor(column / 4) + 1) * 4 : column + 1
                cut++
              }
              text = (column > content ? ' '.repeat(column - content) : '') + text.slice(cut)
            }
            body.push(text)
          }
          skippedFences.set(index, { closer, content: body.join('\n') })
        }
        skippedComments.set(index, prefix + (!fenced.has(index) ? rest : closers.has(index) ? '%% '.padEnd(rest.length, 'x') : '%%'))
        if (fenced.has(index)) skippedSpanLines.add(index)
      }
      for (const index of notes) skippedNotes.add(index)
      return reason
    }
    function dropKept(): void {
      const before = (list: number[]): void => { list.splice(0, list.length, ...list.filter((index) => index < firstKept)) }
      before(comments)
      before(notes)
      before(chained)
      before(skippedLinks)
      skippedAbbr.splice(0, skippedAbbr.length, ...skippedAbbr.filter(([index]) => index < firstKept))
      for (const index of [...fences.keys()]) if (index >= firstKept) fences.delete(index)
      for (const set of [fenced, closers]) for (const index of [...set]) if (index >= firstKept) set.delete(index)
    }
    // A quote prefix left of the container holding that quote carries nothing (carve#4396).
    const floors: number[] = []
    for (let f = 1, floor = 0; f < frames.length && floors.length < quotes; f++) {
      if (frames[f]!.kind !== 'quote') floor = frames[f]!.col
      else {
        floors.push(floor)
        floor = 0
      }
    }
    for (let k = at + 1; ; k++) {
      nextVisible = k
      const next = lines[k]
      if (next === undefined) return decide('document')
      let n = indentCols(next)
      for (let q = 0; q < quotes; q++) {
        if (!isQuoteLine(n.rest) || n.col < (floors[q] ?? 0)) return decide('left')
        n = indentCols(quoteRest(n.rest))
      }
      // A line of nothing but quote markers is blank at its own level (CARVE-P9-085).
      if (/^(?:>[ \t]*)*$/.test(n.rest)) return decide('blank')
      const rest = trimEndSpaceTab(n.rest)
      const col = docColumn(next, n.rest)
      const kept = col !== marker && col >= content
      if (col !== marker && !kept) return decide(col < marker ? 'left' : 'right')
      if (kept) firstKept = Math.min(firstKept, k)
      // Invisible definitions at the marker column defer the attachment
      // decision to the next visible line.
      const abbr = quotes === 0 ? RE_ABBR_DEF.exec(rest) : null
      if (abbr) { skippedAbbr.push([k, abbr[1]!, abbr[2]!]); continue }
      if (isLinkDefLine(rest)) { skippedLinks.push(k); continue }
      if (CONT_MARKER.test(rest)) {
        if (kept) return decide('right')
        chained.push(k)
        continue
      }
      if (isAttrLine(rest)) {
        // Kept past the marker column, it is read at the marker column, as one written there.
        if (kept) comments.push(k)
        continue
      }
      // A paragraph of only braced comments is skipped as a `%%` line is (carve#4799); in an item a marker ends it (carve#4890).
      const paragraphEnd = commentOnlyParagraphEnd((index) => restInQuotes(index, quotes), k, host === 'item', (index) => columnInQuotes(index, quotes))
      if (paragraphEnd !== -1) {
        k = paragraphEnd - 1
        continue
      }
      const comment = COMMENT_FENCE.exec(rest)
      if (comment) {
        const opener = k
        let missed = false
        for (k++; k < lines.length; k++) {
          let closer = indentCols(lines[k]!)
          for (let q = 0; q < quotes; q++) {
            // A line that leaves the quote ends the span and the host (CARVE-P0-005), so nothing attaches.
            if (!isQuoteLine(closer.rest)) return decide('left')
            closer = indentCols(quoteRest(closer.rest))
          }
          if (COMMENT_FENCE.exec(trimEndSpaceTab(closer.rest))?.[1]?.length === comment[1]!.length) break
          // A nonblank line that misses the span's owner ends the span (CARVE-P0-005): below the content
          // column for a kept span, below the marker column the attached block stands at otherwise.
          if (closer.rest.trim() !== '' && docColumn(lines[k]!, closer.rest) < (kept ? content : marker)) { missed = true; break }
        }
        if (missed) {
          for (let line = opener; line < k; line++) { comments.push(line); fenced.add(line) }
          // The missed line is no closer: the span's last line is, so the line after it stays visible.
          fences.set(opener, k - 1)
          missedSpans.add(opener)
          k--
          continue
        }
        // An unclosed span runs to the end of the document (PART 9 §28).
        for (let line = opener; line <= Math.min(k, lines.length - 1); line++) { comments.push(line); fenced.add(line) }
        fences.set(opener, k)
        if (k < lines.length) closers.add(k)
        continue
      }
      if (COMMENT_LINE.test(rest)) { comments.push(k); continue }
      const skippedNote = FOOTNOTE_DEF.exec(rest)
      if (skippedNote !== null) {
        const opener = k
        const noteBodyColumn = col + FOOTNOTE_BODY_COLUMN
        // A later marker-line `+` is refused while this earlier claim is pending.
        // It opens no body, so its next visible line remains this claim's candidate.
        const pendingLabel = /\[\^([^\]]+)\]:/.exec(lines[at]!)?.[1]
        if (CONT_MARKER.test(skippedNote[2]!) && skippedNote[1] !== pendingLabel) {
          firstPending = Math.min(firstPending, opener)
          notes.push(opener)
          continue
        }
        for (k++; k < lines.length; k++) {
          let body = indentCols(lines[k]!)
          for (let q = 0; q < quotes && isQuoteLine(body.rest); q++) body = indentCols(quoteRest(body.rest))
          if (body.rest.startsWith('{') &&
              (isAttrLine(trimEndSpaceTab(body.rest)) || wrappedAttrRun(trimEndSpaceTab(body.rest), quotes, k) !== null) &&
              docColumn(lines[k]!, body.rest) < noteBodyColumn) break
          // An attribute line folds into the note's paragraph like text (CARVE-P9-013).
          if (body.rest === '' || /^::? /.test(body.rest) ||
              classify(body.rest, frames[0]!, k, body.col).kind !== 'text' && !isAttrLine(trimEndSpaceTab(body.rest))) break
        }
        for (let line = opener; line < k; line++) notes.push(line)
        k--
        continue
      }
      const wrapped = rest[0] === '{' ? wrappedAttrRun(rest, quotes, k) : null
      if (wrapped !== null) {
        // Kept, the whole run moves to the marker column by its opener's shift, as a one-line run does;
        // right after a skipped note it stays in place, where a one-line run folds into the note.
        if (kept && notes.at(-1) !== k - 1) for (let line = k; line <= k + wrapped; line++) {
          comments.push(line)
          if (line > k) runOpeners.set(line, k)
        }
        k += wrapped
        continue
      }
      if (kept) return decide('right')
      // A closer ends a body and is no block.
      if (COLON_CLOSER.test(rest) && frames.some((f) => f.kind === 'colon' && f.run === COLON_CLOSER.exec(rest)![1]!.length)) return decide('document')
      if (host === 'item' && matchMarker(rest) !== null) return decide('sibling')
      if (host === 'dd' && (DD.test(rest) || DEFLIST_TERM.test(rest))) return decide('sibling')
      return decide(null)
    }
  }

  function transparentLine(rest: string, k: number): boolean {
    const text = trimEndSpaceTab(rest)
    if (REGION_MARKER.test(text) || FOOTNOTE_DEF.test(text)) return false
    return commentSpanEnd(text, k) !== -1 || COMMENT_LINE.test(text) || isLinkDefLine(text) || RE_ABBR_DEF.test(text)
  }

  function commentSpanEnd(text: string, k: number): number {
    const comment = COMMENT_FENCE.exec(text)
    if (!comment) return -1
    for (let j = k + 1; j < lines.length; j++) {
      const close = COMMENT_FENCE.exec(trimEndSpaceTab(lines[j]!).replace(/^[ \t>]*/, ''))
      if (close && close[1]!.length === comment[1]!.length) return j
    }
    return lines.length - 1
  }

  // How deep the next visible line reaches through the indentation frames below `from`.
  function nextVisibleReach(at: number, from: number): number {
    const unquoted = (line: string): string => indentCols(line.replace(/^[ \t>]*(?=>)>? ?/, '')).rest
    if (nextVisible <= at) {
      // A skipped span that a missed line ended stops at its recorded last line (CARVE-P0-005).
      const own = skippedFences.get(at)?.closer ?? commentSpanEnd(trimEndSpaceTab(unquoted(lines[at]!)), at)
      nextVisible = (own === -1 ? at : own) + 1
      for (; nextVisible < lines.length; nextVisible++) {
        const text = trimEndSpaceTab(unquoted(lines[nextVisible]!))
        if (text === '') continue
        const span = commentSpanEnd(text, nextVisible)
        if (span !== -1) nextVisible = span
        else if (!transparentLine(text, nextVisible)) break
      }
    }
    if (nextVisible >= lines.length) return from
    let depth = 0
    for (let k = 1; k <= from; k++) if (frames[k]!.kind === 'quote') depth++
    let next = indentCols(lines[nextVisible]!)
    for (let q = 0; q < depth; q++) {
      if (!isQuoteLine(next.rest)) return from
      next = indentCols(quoteRest(next.rest))
    }
    let deepest = from
    for (let k = from + 1; k < frames.length; k++) {
      const frame = frames[k]!
      if ((frame.kind !== 'item' && frame.kind !== 'dd' && frame.kind !== 'note') || next.col < frame.col) break
      deepest = k
    }
    return deepest
  }

  // A line's text inside `quotes` quote prefixes, or undefined where one is missing.
  function columnInQuotes(index: number, quotes: number): number {
    let n = indentCols(lines[index]!)
    for (let q = 0; q < quotes && isQuoteLine(n.rest); q++) n = indentCols(quoteRest(n.rest))
    return n.col
  }

  function restInQuotes(index: number, quotes: number): string | undefined {
    if (lines[index] === undefined) return undefined
    let n = indentCols(lines[index])
    for (let q = 0; q < quotes; q++) {
      if (!isQuoteLine(n.rest)) return undefined
      n = indentCols(quoteRest(n.rest))
    }
    return n.rest
  }

  function openerKind(form: Form, rest: string): string | undefined {
    switch (form.kind) {
      case 'quote': return 'block quote'
      case 'colon': return 'colon fence'
      case 'fence': return form.lineBlock ? 'line block' : COMMENT_FENCE.test(rest) ? undefined : 'code fence'
      case 'term': return 'definition term'
      case 'leaf': return HEADING.test(rest) ? 'heading' : RE_HR.test(rest) ? 'thematic break'
        : isTableRow(rest) ? 'table row' : undefined
      default: return undefined
    }
  }

  function emit(index: number, step: TraceRecord['step'], owner: string, rule: string | null, form: string,
    extra: { [K in 'cell' | 'closed' | 'reached' | 'plus' | 'reach']?: TraceRecord[K] | undefined } = {}): void {
    if (traceAlias !== null) {
      if (owner === traceAlias.from || owner.startsWith(`${traceAlias.from}/`)) {
        owner = traceAlias.to + owner.slice(traceAlias.from.length)
        if (extra.reach?.startsWith(`${traceAlias.from}/`) || extra.reach === traceAlias.from) {
          extra = { ...extra, reach: traceAlias.to + extra.reach.slice(traceAlias.from.length) }
        }
      } else traceAlias = null
    }
    const record: TraceRecord = { line: index + 1, step, owner, rule, form }
    for (const [key, value] of Object.entries(extra)) if (value !== undefined) (record as unknown as Record<string, unknown>)[key] = value
    trace!.push(record)
  }

  function traceApply(at: number, form: Form, route: ReturnType<typeof firstBlockTraceRoute>, plusFollower: boolean): void {
    if (route.alias) traceAlias = route.alias
    const kind = TRACE_FORM[form.kind] ?? form.family ?? form.kind
    const cell = form.kind === 'colon-close' ? 'B-div-end' : TRACE_OPENS.has(form.kind) ? `B-${form.family ?? kind}-start` : undefined
    emit(at, 'S5', route.path, TRACE_RULE[form.kind] ?? 'CARVE-P0-024', kind,
      { cell, closed: route.closed > 0 ? route.closed : undefined, reached: route.reached, plus: plusFollower ? at : undefined,
        reach: form.kind === 'leaf' && !plusFollower ? ownerPath(reachedDepth(lines[at]!)) : undefined })
  }

  // The deepest open frame whose content column `line` reaches, as S2 walks a visible line.
  function reachedDepth(line: string): number {
    let n = indentCols(line)
    let from = 0
    for (let k = 1; k < frames.length; k++) {
      const f = frames[k]!
      if (f.kind === 'quote') {
        if (!isQuoteLine(n.rest)) break
        n = indentCols(quoteRest(n.rest))
      } else if (n.col < f.col) break
      from = k
    }
    return from
  }
  // A container path keyed by opening line, `depth` cutting it at a frame: `doc/item:1/quote:2`.
  function ownerPath(depth = frames.length - 1): string {
    let path = 'doc'
    for (let k = 1; k <= depth; k++) {
      const f = frames[k]!
      path += `/${TRACE_FRAME[f.kind] ?? f.family}:${(f.line ?? f.opened!) + 1}`
    }
    return path
  }

  // The document column where `rest`, a suffix of `line`, starts.

  function docColumn(line: string, rest: string): number {
    let col = 0
    for (const ch of line.slice(0, line.length - rest.length)) col = ch === '\t' ? (Math.floor(col / 4) + 1) * 4 : col + 1
    return col
  }

  function classify(rest: string, owner: Frame, at: number, col: number): Form {
    rest = trimEndSpaceTab(rest)
    if (rest === '') return { kind: 'blank', interrupts: true }
    if (!OPENER_LEAD.test(rest)) return TEXT
    if (isQuoteLine(rest)) return { kind: 'quote', interrupts: true }
    const colon = COLON_FENCE.exec(rest)
    if (colon && COLON_CLOSER.test(rest)) {
      // A closer is read in its owner: only a colon body at the reached depth, or holding it directly, can take it.
      // A lookahead classifies before its line sets `reach`, and the line before may have popped frames.
      for (let k = Math.min(reach, frames.length - 1); k > 0 && frames[k]!.kind === 'colon'; k--) {
        if (frames[k]!.run === colon[1]!.length) return { kind: 'colon-close', frame: k, interrupts: true }
      }
    }
    if (colon && isColonFenceOpener(rest)) {
      const run = colon[1]!.length
      if (RE_LINE_BLOCK_OPEN.test(rest)) {
        return { kind: 'fence', family: 'div', run, interrupts: true, lineBlock: true, closes: (r, closerCol) => closerCol <= col && COLON_CLOSER.exec(r)?.[1]!.length === run }
      }
      return { kind: 'colon', run, interrupts: true }
    }
    if (RE_FENCE.test(rest) || RE_RAW_FENCE.test(rest)) {
      const run = /^(`{3,}|~{3,})/.exec(rest)![1]!
      // A run indented past its opener is code content (CARVE-P2-006).
      const closes = (r: string, closerCol: number): boolean => {
        const c = closerCol <= col && PURE_FENCE.exec(r)
        return !!(c && c[1]![0] === run[0] && c[1]!.length >= run.length)
      }
      return { kind: 'fence', family: 'code', interrupts: true, closes }
    }
    const comment = COMMENT_FENCE.exec(rest)
    if (comment) {
      const run = comment[1]!.length
      const closes = (r: string): boolean => COMMENT_FENCE.exec(r)?.[1]!.length === run
      return { kind: 'fence', family: 'comment', interrupts: true, closes }
    }
    if (COMMENT_LINE.test(rest)) return { kind: 'leaf', interrupts: true }
    const note = NOTE_HEAD.exec(rest)
    if (note && FOOTNOTE_DEF.test(rest)) return { kind: 'note', width: 2, head: note[0].length, interrupts: true }
    // T6: a continuation row right under a row of the owner's table moves with the rows (carve#4161).
    if (owner.tableLine === at - 1 && RE_TABLE_CONT.test(rest) && isTableRow('|' + rest.slice(1))) {
      return { kind: 'leaf', interrupts: true, table: true }
    }
    const marker = matchMarker(rest)
    // §10 I2: under an open paragraph a marker opens only in a marker body (carve#4860).
    if (marker && owner.para && !BODY_FRAME.has(owner.kind)) return { kind: 'text', interrupts: false }
    if (marker) return { kind: 'item', width: marker.width, head: marker.head, interrupts: false, axes: marker.axes }
    if (DEFLIST_TERM.test(rest)) return { kind: 'term', interrupts: true }
    const dd = DD.exec(rest)
    if (dd && (owner.last === 'term' || owner.last === 'dd')) {
      return { kind: 'dd', width: 1 + dd[1]!.length, head: 1 + dd[1]!.length, interrupts: false }
    }
    if (isTableRow(rest)) return { kind: 'leaf', interrupts: true, table: true }
    if (HEADING.test(rest) || RE_HR.test(rest) || isLinkDefLine(rest) ||
        FOOTNOTE_DEF.test(rest) || RE_ABBR_DEF.test(rest) || isAttrLine(rest)) {
      return { kind: 'leaf', interrupts: true }
    }
    if (rest[0] === '{') {
      // A `{%` run continues past its `{` to its `%}`, brace lines included (CARVE-P2-035).
      if (rest.startsWith('{%') && !rest.includes('%}')) {
        const commentLines = wrappedCommentLines(rest, owner, at)
        if (commentLines !== null) return { kind: 'leaf', interrupts: true, attrLines: commentLines, para: true }
      }
      const attrLines = wrappedAttrLines(rest, owner, at, col)
      if (attrLines !== null) return { kind: 'leaf', interrupts: true, attrLines }
    }
    if (CAPTION.test(rest)) return { kind: 'leaf', interrupts: false, caption: true }
    return { kind: 'text', interrupts: false }
  }

  // The column of the first line after an attribute run that is not itself part of a run; -1 at the end.
  function lineAfterRun(from: number, depth: number): number {
    const quotes = frames.slice(1, depth + 1).filter((f) => f.kind === 'quote').length
    for (let k = from; k < lines.length; k++) {
      let line = lines[k]!
      let inQuote = true
      for (let q = 0; q < quotes && inQuote; q++) {
        const quoted = indentCols(line).rest
        inQuote = isQuoteLine(quoted)
        line = inQuote ? quoteRest(quoted) : ''
      }
      if (!inQuote) return -1
      const n = indentCols(line)
      if (n.rest === '') return -1
      if (!isAttrLine(trimEndSpaceTab(n.rest))) return n.col
    }
    return -1
  }

  // How many lines below `at` a wrapped attribute block runs; its lines carry the owner's quote prefixes.
  function wrappedAttrLines(rest: string, owner: Frame, at: number, col: number): number | null {
    const depth = frames.slice(1, frames.indexOf(owner) + 1).filter((f) => f.kind === 'quote').length
    const opener = trimEndSpaceTab(lines[at]!)
    // A quoted run behind a tab or padding is measured in source columns, so an
    // unprefixed continuation keeps its written column (CARVE-P2-035, carve#5796).
    if (depth > 0 && owner.kind === 'quote' && opener.endsWith(rest) &&
        (opener.slice(0, opener.length - rest.length).includes('\t') || col > 0)) return sourceAttrRun(rest, depth, at)
    return wrappedAttrRun(rest, depth, at)
  }

  function sourceAttrRun(rest: string, depth: number, at: number): number | null {
    const openerColumn = docColumn(trimEndSpaceTab(lines[at]!), rest)
    let collected = rest
    for (let j = at + 1; j < lines.length; j++) {
      // A line under fewer `>` than the run is lazy to its quote; it is measured past the prefixes it has.
      const source = lines[j]!
      let line = indentCols(source).rest
      for (let q = 0; q < depth && isQuoteLine(line); q++) line = indentCols(quoteRest(line)).rest
      const column = docColumn(source, line)
      if (line.trim() === '' || column <= openerColumn || /^[ \t]*\{/.test(line)) return null
      const closed = line.includes('}')
      if (!closed && !isValidAttrPayload(`\n${line}\n`)) return null
      collected += `\n${line}`
      if (closed) return parseBlockAttributeRun(collected) ? j - at : null
    }
    return null
  }

  function wrappedCommentLines(rest: string, owner: Frame, at: number): number | null {
    const depth = frames.slice(1, frames.indexOf(owner) + 1).filter((f) => f.kind === 'quote').length
    const col = runOpenerColumn(rest, depth, at)
    for (let end = at + 1; end < lines.length; end++) {
      const body = quotedMeasure(end, depth)
      if (body === null || body.rest === '' || body.col <= col) return null
      // A comment-only run below an open paragraph's frame stays an invisible lazy line (CARVE-P9-013).
      if (body.rest.includes('%}')) {
        const commentOnly = trimEndSpaceTab(body.rest.slice(body.rest.indexOf('%}') + 2)) === ''
        return commentOnly && owner !== top() && top().para ? null : end - at
      }
    }
    return null
  }

  // The column a brace run's continuations must pass: its `{`, or the body column of a note head it follows (CARVE-P2-035).
  function runOpenerColumn(rest: string, depth: number, at: number): number {
    let openerLine = lines[at]!
    for (let q = 0; q < depth && isQuoteLine(indentCols(openerLine).rest); q++) openerLine = quoteRest(indentCols(openerLine).rest)
    const trimmed = trimEndSpaceTab(openerLine)
    if (!trimmed.endsWith(rest)) return indentCols(openerLine).col
    const heads = NOTE_HEADS.exec(trimmed.slice(0, trimmed.length - rest.length))
    return heads ? docColumn(trimmed, trimmed.slice(heads[1]!.length)) + FOOTNOTE_BODY_COLUMN : docColumn(trimmed, rest)
  }

  function wrappedAttrRun(rest: string, depth: number, at: number): number | null {
    const openerColumn = runOpenerColumn(rest, depth, at)
    let collected = rest
    for (let j = at + 1; j < lines.length; j++) {
      let line: string | null = lines[j]!
      for (let q = 0; q < depth && line !== null; q++) {
        const quoted: string = indentCols(line).rest
        line = isQuoteLine(quoted) ? quoteRest(quoted) : null
      }
      if (line === null || line.trim() === '' || indentCols(line).col <= openerColumn || /^[ \t]*\{/.test(line)) return null
      const closed = line.includes('}')
      if (!closed && !isValidAttrPayload(`\n${line}\n`)) return null
      collected += `\n${line}`
      if (closed) return parseBlockAttributeRun(collected) ? j - at : null
    }
    return null
  }

  // Span pairing in one pass: the widest pure fence run of each character
  // at or after every line, and the last line of each comment run length.
  function quotedMeasure(k: number, quotes: number): { col: number; rest: string } | null {
    let n = indentCols(lines[k]!)
    for (let q = 0; q < quotes; q++) {
      if (!isQuoteLine(n.rest)) return null
      n = indentCols(quoteRest(n.rest))
    }
    return n
  }

  function versePayloadRunPairs(run: string, at: number): boolean {
    const quoteDepth = frames.filter(frame => frame.kind === 'quote').length
    let ahead = verseRunsByQuoteDepth.get(quoteDepth)
    if (ahead === undefined) {
      ahead = { '`': new Array<number>(lines.length + 1).fill(0), '~': new Array<number>(lines.length + 1).fill(0) }
      for (let k = lines.length - 1; k >= 0; k--) {
        const measured = quotedMeasure(k, quoteDepth)
        if (measured === null) continue
        ahead['`'][k] = ahead['`'][k + 1]!
        ahead['~'][k] = ahead['~'][k + 1]!
        const later = PURE_FENCE.exec(measured.rest)?.[1]
        if (later !== undefined) ahead[later[0] as '`' | '~'][k] = Math.max(ahead[later[0] as '`' | '~'][k]!, later.length)
      }
      verseRunsByQuoteDepth.set(quoteDepth, ahead)
    }
    return ahead[run[0] as '`' | '~'][at + 1]! >= run.length
  }

  function nextLineOwner(host: Frame[], at: number, quotes: number): number {
    for (let k = at + 1; k < lines.length; k++) {
      const n = quotedMeasure(k, quotes)
      if (n === null) return 0
      if (n.rest !== '') {
        // A frame's column counts from the content of the quotes up to and including it.
        let owner = 0
        let depthQuotes = 0
        let view: { col: number; rest: string } | null = quotedMeasure(k, 0)
        for (let depth = 1; depth < host.length; depth++) {
          if (host[depth]!.kind === 'quote') {
            depthQuotes++
            view = depthQuotes === quotes ? n : quotedMeasure(k, depthQuotes)
          }
          if (view === null || view.col < host[depth]!.col) break
          owner = depth
        }
        return owner
      }
    }
    return 0
  }

  function codeCloserAhead(fence: Frame, at: number, quotes: number): { exists: boolean; paired: number | null } {
    const host = attachedHost?.at(-1)
    return attachedCodeCloserAhead(fence, at, quotes, lines.length, closerRuns().widest,
      host?.markerCol ?? 0, quotedMeasure, attachedHost && flushLeftMarkerLineItem(attachedHost, fence) ? host!.col : null,
      host?.line !== undefined && TRAILING_PLUS.test(lines[host.line]!.trimStart()),
      host?.kind === 'item' && host.plus === host.line ? host.col : null)
  }

  // A top-level item whose marker-line `+` took a fence left of its content column.
  function flushLeftMarkerLineItem(host: Frame[], fence: Frame): boolean {
    const item = host.at(-1)!
    return host.length === 2 && item.kind === 'item' && fence.col < item.col &&
      item.line !== undefined && TRAILING_PLUS.test(lines[item.line]!.trimStart())
  }

  function colonCloserAhead(container: Frame, at: number, quotes: number): boolean {
    const host = attachedHost?.at(-1)
    let pastBlank = false
    const nested: { width: number; lineBlock: boolean }[] = []
    let payload: { run: string; column: number } | null = null
    for (let k = at + 1; k < lines.length; k++) {
      const n = quotedMeasure(k, quotes)
      if (n === null) return false
      if (n.rest === '') { pastBlank = true; continue }
      if (payload !== null) {
        if (n.col === payload.column && fenceCloseRe(payload.run).test(n.rest)) payload = null
        continue
      }
      const code = opensCodeFence(n.rest) ? /^(`{3,}|~{3,})/.exec(n.rest)?.[1] : undefined
      if (code !== undefined) {
        payload = { run: code, column: n.col }
        continue
      }
      const closer = COLON_CLOSER.exec(n.rest)
      const maxColumn = host === undefined ? container.col : Infinity
      if (closer && n.col <= maxColumn) {
        const width = closer[1]!.length
        if (nested.at(-1)?.width === width) { nested.pop(); continue }
        if (nested.length === 0 && width === container.run) return true
      }
      // A line block reads colon-shaped openers as verse. Divs nest them.
      if (!container.lineBlock && !nested.at(-1)?.lineBlock && isColonFenceOpener(n.rest) && n.col <= maxColumn) {
        const width = /^(:{3,})/.exec(n.rest)![1]!.length
        nested.push({ width, lineBlock: RE_LINE_BLOCK_OPEN.test(n.rest) })
      }
      if (pastBlank && host && n.col <= host.col &&
          (matchMarker(n.rest) !== null || isColonFenceOpener(n.rest))) return false
    }
    return false
  }

  function closerRuns(): NonNullable<typeof runs> {
    if (runs) return runs
    const widest = { '`': new Array<number>(lines.length + 1).fill(0), '~': new Array<number>(lines.length + 1).fill(0) }
    runs = { widest }
    for (let j = lines.length - 1; j >= 0; j--) {
      const rest = quotedRest(lines[j]!)
      widest['`'][j] = widest['`'][j + 1]!
      widest['~'][j] = widest['~'][j + 1]!
      const c = PURE_FENCE.exec(rest)
      if (c) {
        const ch = c[1]![0] as '`' | '~'
        widest[ch][j] = Math.max(widest[ch][j]!, c[1]!.length)
      }
    }
    return runs
  }
}

/** Put each spelled character back wherever the walk's stand-in landed in the tree. */
export function restoreLetters(root: object, letters: string[]): void {
  const stack: object[] = [root]
  const visited = new WeakSet<object>()
  while (stack.length > 0) {
    const node = stack.pop()! as Record<string, unknown>
    if (visited.has(node)) continue
    visited.add(node)
    for (const key of Object.keys(node)) {
      const value = node[key]
      if (typeof value === 'string') {
        let restored = value
        letters.forEach((letter, k) => {
          if (restored.includes(letter)) restored = restored.replaceAll(letter, STANDS_FOR[k]!)
        })
        if (restored !== value) node[key] = restored
      } else if (value !== null && typeof value === 'object') stack.push(value)
    }
  }
}
