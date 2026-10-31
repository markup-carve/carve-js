import { isValidAttrPayload } from '../../extension/attribute-parser.js'
import { trimEndSpaceTab } from '../../trim-non-nbsp.js'
import { occupiedPrivateUse, pickSentinelRun } from '../inline/sentinel-run.js'
import { olKindMatches, olKindOf } from '../list/parse-item-core.js'
import type { RefusedContinuationMarker } from './parse-block-scan-core.js'
import { CAPTION_COMMENT_ONLY } from './parse-quote-core.js'
import {
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

/** A lone `+` the walk spelled as a letter, for the `continuation-marker-refused` lint. */
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
}

interface Frame {
  kind: 'doc' | 'quote' | 'item' | 'note' | 'dd' | 'fence' | 'colon'
  /** A quote a marker-line `+` of an item or description took as its block. */
  firstBlockQuote?: boolean
  col: number
  canon: number
  cut: number
  para: boolean
  // The open paragraph's own lines absorbed an invalid colon opener (CARVE-P9-016).
  absorbs?: boolean
  last: string | null
  markerCol?: number
  markerCanon?: number
  // Document column of the marker and the line that opened the frame.
  docMarker?: number
  line?: number
  // The line a fence or colon body opened on, for trace owner paths only.
  opened?: number
  family?: 'code' | 'comment' | 'div'
  axes?: string | undefined
  task?: boolean | undefined
  token?: string | undefined
  run?: number | undefined
  closes?: ((rest: string, col: number) => boolean) | undefined
  termCut?: number
  lineBlock?: boolean | undefined
  span?: string | null
  // The line of the last table row read in this frame: a `+` row below it is a row, and lint groups by it.
  tableLine?: number | undefined
  // A description whose marker line held a lone `+`, accepted or refused.
  plusBody?: boolean
  // The marker line a `+` on it was accepted on.
  plus?: number
  // A list keeps its first marker's column and shift (PART 0 S3).
  listCol?: number
  listShift?: number
  leftOfList?: boolean
  // A list or term run the walk closed at a line past it keeps its shift for the lines after.
  closedList?: { col: number; shift: number } | undefined
  termShift?: number
  ddShift?: number
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
  task?: boolean
  token?: string | undefined
  lineBlock?: boolean
  family?: 'code' | 'comment' | 'div'
  table?: boolean
  // The continuation lines of a wrapped attribute block.
  attrLines?: number
}


const CONT_MARKER = /^\+[ \t]*$/
const LINT_HOST: Partial<Record<Frame['kind'], RefusedPlus['host']>> = { item: 'list item', dd: 'definition description', note: 'footnote', quote: 'block quote' }
const COLON_FENCE = /^(:{3,})(.*)$/
const COLON_CLOSER = /^(:{3,})[ \t]*$/
const PURE_FENCE = /^(`{3,}|~{3,})[ \t]*$/
const COMMENT_FENCE = /^(%{3,})(.*)$/
const COMMENT_LINE = /^[ \t]*%%/
const NOTE_HEAD = /^\[\^[^\]]+\]: +/
const FOOTNOTE_DEF = /^\[\^([^\]]+)\]: +(?![ \t]*$)([^ ].*)$/
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
const STANDS_FOR = '+-*.)'
const TRAILING_PLUS = /^(?:(?:[-*](?:\{[^}]*\})?|[0-9]+[.)]|[A-Za-z]+[.)]|\.|:|\[\^[^\]]+\]:) +(?:\[.\] +)?)+\+[ \t]*$/
// A line that cannot start any opener: no leading punctuation an opener uses and no ordered marker.
const OPENER_LEAD = /^[>:`~%[\-*#_|{^+.0-9]|^[A-Za-z]+[.)] /
const TEXT: Form = { kind: 'text', interrupts: false }
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
    while (o < origins.length && origins[o]! <= col) origin = origins[o++]!
  }
  return col
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

// CARVE-P2-010: a tab that begins the content is leading whitespace, so the content column is where the content starts.
function leadTabWidth(line: string, head: number, width: number): number {
  const run = /^\t[ \t]*/.exec(line.slice(head))?.[0]
  if (run === undefined || line.startsWith('%%%', head + 1)) return width
  let end = width
  for (const char of run) end = char === '\t' ? end + 4 - end % 4 : end + 1
  return end
}

interface MarkerAxes {
  axes?: string | undefined
  task?: boolean | undefined
  token?: string | undefined
}

// PART 9 §11 N1: bullet character or ordered delimiter, plain or task, and the ordered type (the N3 tie-break included).
function sameListAxes(list: MarkerAxes, head: MarkerAxes): boolean {
  if (list.axes !== head.axes || list.task !== head.task) return false
  return list.token === undefined || head.token === undefined ||
    olKindMatches(head.token, olKindOf(list.token, head.token))
}

function matchMarker(rest: string): { width: number; head: number; axes: string; task: boolean; token?: string } | null {
  const line = trimEndSpaceTab(rest)
  let m = BULLET.exec(line)
  if (m && gluedAttrsValid(m[2])) {
    if (m[4] !== undefined) return { width: 2, head: m[0].length, axes: m[1]!, task: true }
    return { width: leadTabWidth(line, m[0].length, 1 + m[3]!.length), head: m[0].length, axes: m[1]!, task: false }
  }
  m = ORDERED.exec(line)
  if (m && orderedTokenValid(m[1]!) && gluedAttrsValid(m[3])) {
    return { width: leadTabWidth(line, m[0].length, m[1]!.length + 1 + m[4]!.length), head: m[0].length, axes: m[2]!, task: false, token: m[1]! }
  }
  return null
}

// Frames inside a quote a marker-line `+` took leave the body's column to its host (CARVE-P9-067, carve#4385).
function closesAColumn(closed: Frame[]): boolean {
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

/** Route only a block actually taken by a marker-line plus through its item's trace path. */
function firstBlockTraceRoute(
  parent: string, sibling: Frame | undefined, plusFollower: boolean, at: number, form: Form,
  walkPath: string, opened: boolean, closed: number, reached: string | undefined,
): { path: string; alias?: { from: string; to: string }; closed: number; reached?: string | undefined } {
  if (!plusFollower || sibling?.kind !== 'item' || sibling.plus !== at - 1 ||
      ['item', 'text', 'blank'].includes(form.kind) || form.family === 'comment' ||
      !(walkPath === parent || walkPath.startsWith(`${parent}/`))) {
    return { path: walkPath, closed, reached }
  }
  const itemPath = `${parent}/item:${(sibling.line ?? sibling.opened!) + 1}`
  const readPath = itemPath + walkPath.slice(parent.length)
  return opened
    ? { path: walkPath, alias: { from: walkPath, to: readPath }, closed: 0 }
    : { path: readPath, closed: 0 }
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
): { lines: string[]; cuts: Map<number, OwnershipCut[]>; letters: string[] | null; refusedPlus: RefusedPlus[]; payloadLines: Set<number>; overindented: OverindentedOpener[] } {
  const result = lines.slice(0, start)
  // The walk may place a marker-line first block in its parent while the readers
  // keep it in the item. Trace records use the reader's owner for that block.
  let traceAlias: { from: string; to: string } | null = null
  if (trace) for (let k = 0; k < start; k++) emit(k, 'INPUT', 'doc', null, 'frontmatter')
  const cuts = new Map<number, OwnershipCut[]>()
  const frames: Frame[] = [{ kind: 'doc', col: 0, canon: 0, cut: 0, para: false, last: null }]
  const top = (): Frame => frames[frames.length - 1]!
  let reach = 0
  let runs: { widest: Record<string, number[]>; lastComment: Map<number, number> } | null = null
  // The line after an accepted `+` keeps its column: the marker reads it.
  let afterPlus = false
  // Stand-ins for a refused `+` and a folded marker: readers meet a plain letter, the AST gets the character back.
  let letters: string[] | null = null
  // The frames of the host a `+` last attached through. The attached block stands outside
  // the host's columns and closes it here, and a further `+` still reaches it (§17 L3).
  let attachedHost: Frame[] | null = null
  // The continuation lines of a wrapped attribute block the walk opened.
  let attrRest = null as { left: number; cut: number; floor?: number } | null
  const refusedPlus: RefusedPlus[] = []
  const payloadLines = new Set<number>()
  const overindented: OverindentedOpener[] = []

  for (let at = start; at < lines.length; at++) {
    let src = lines[at]!
    let out = ''
    let m = indentCols(src)
    const lineCuts: OwnershipCut[] = []
    // `spaces` writes a leading tab as the columns it reaches, so a term and its body read alike in both spellings.
    const lead = (target: number, spaces = false): void => {
      const col = Math.min(target, m.col)
      const run = src.length - m.rest.length
      if (col === m.col && !(spaces && out === '' && src.slice(0, run).includes('\t'))) out += src.slice(0, run)
      else {
        const last = lineCuts.at(-1)
        if (last?.at === out.length) last.removed += run - col
        else lineCuts.push({ at: out.length, removed: run - col })
        out += ' '.repeat(col)
      }
      src = m.rest
    }
    const take = (count: number): void => {
      out += src.slice(0, count)
      src = src.slice(count)
    }
    const finish = (): void => {
      result.push(out + src)
      if (lineCuts.length) cuts.set(at, lineCuts)
    }

    let reached = 0
    let plus: Frame | null = null
    let quotes = 0
    let refused = false
    let stripped: number | null = null
    let segment = 1
    let frameReach = false
    for (let k = 1; k < frames.length; k++) {
      const f = frames[k]!
      // A lone `+` reaches the marker column of an open marker container.
      if (f.markerCol !== undefined && CONT_MARKER.test(m.rest) && m.col === f.markerCol &&
          (f.kind === 'quote' || m.col < f.col)) {
        const reason = refusal(at, docColumn(lines[at]!, m.rest), quotes, f.kind)
        if (reason === null) {
          plus = f
          break
        }
        refuse(reason, f.kind)
      }
      if (f.kind === 'quote') {
        if (!isQuoteLine(m.rest)) break
        quotes++
        lead(frames[k - 1]!.canon)
        take(src.length - quoteRest(src).length)
        m = indentCols(src)
        stripped = null
        frameReach = false
        segment = k + 1
        reached = k
        continue
      }
      if (m.rest !== '' && m.col < f.col) {
        if (stripped === null && src.slice(0, src.length - m.rest.length).includes('\t')) {
          const origins: number[] = []
          for (let q = segment; q < frames.length && frames[q]!.kind !== 'quote'; q++) origins.push(frames[q]!.col)
          stripped = strippedColumn(src, origins)
        }
        if (stripped === null || stripped < f.col) break
        frameReach = true
      }
      reached = k
    }
    // The frame columns decided the reach, so the readers see that run as spaces.
    if (frameReach && stripped !== null && stripped !== m.col) {
      lineCuts.push({ at: out.length, removed: src.length - m.rest.length - stripped })
      src = ' '.repeat(stripped) + m.rest
      m = indentCols(src)
    }
    if (!plus && attachedHost && CONT_MARKER.test(m.rest)) plus = reopenAttachedHost(attachedHost)
    if (plus) {
      // S2: a lone `+` at a marker column (CARVE-P9-067).
      frames.length = frames.indexOf(plus) + 1
      attachedHost = frames.slice()
      plus.para = false
      lead(plus.markerCanon!)
      finish()
      afterPlus = true
      if (trace) emit(at, 'S2', ownerPath(), 'CARVE-P9-067', 'plus', { cell: 'B-plus-start' })
      continue
    }
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
    const missed = reached < frames.length - 1
    reach = reached
    const inner = top()
    if (inner.kind === 'fence' && !missed) {
      readPayload(inner)
      continue
    }
    if (inner.kind === 'fence') frames.pop()
    let owner = frames[reached]!
    if (m.rest !== '') for (const f of frames) if (f.closedList && m.col < f.closedList.col) f.closedList = undefined
    const form = classify(m.rest, owner, at, m.col)
    if (form.kind === 'text' && TRAILING_PLUS.test(m.rest)) spellTrailingPlusAsLetter()
    if (!plusFollower && attachedBlockEnded(form, owner, reached)) attachedHost = null
    // Past a missed note a marker opens where an item or a description body owns it (§10 I2), or beside a missed list.
    // A missed quote keeps the line as the quote's lazy text.
    const missedNote = missed && frames.slice(reached + 1).some((f) => f.kind === 'note')
    // A `: ` line is a description sibling at any column where its list's owner reads it (CARVE-P0-024 S3).
    // A caption at its owner's block column attaches to the quote it follows and is never its lazy line (CARVE-P2-008, carve#4312).
    const missedFrames = frames.slice(reached + 1)
    const captionsQuote = missed && CAPTION.test(m.rest) && m.col === frames[reached]!.col && missedFrames[0]?.kind === 'quote' &&
      !missedFrames.some((f) => f.kind === 'note')
    if (missed && !captionsQuote && foldsLazily(form, missedNote)) {
      // S4: a lazy line stays text where it stands, short of the frame it missed.
      // Past a note a marker folds too, so the readers must not meet it as one (carve#4160).
      if ((missedNote || foldsPastDescription(owner)) && form.kind === 'item' && !plusFollower) spellMarkerAsLetter()
      if (TRAILING_PLUS.test(m.rest) && !lazyMarkerLineAttaches(form)) spellTrailingPlusAsLetter()
      leadLazy(owner)
      finish()
      if (trace) emit(at, 'S4', ownerPath(), 'CARVE-P0-006', 'lazy', { reached: ownerPath(reached) })
      continue
    }
    // A paragraph a `+` attaches at an item's marker column stays in the item (§17 L3),
    // so a sibling marker interrupts it (carve#4080).
    const lonePlus = plusFollower ? frames[reached + 1] : undefined
    if (lonePlus && attachesParagraph(lonePlus, form)) {
      lead(lonePlus.markerCanon!)
      finish()
      lonePlus.absorbs = absorbsColon(m.rest)
      lonePlus.para = true
      lonePlus.last = 'para'
      if (trace) emit(at, 'S5', ownerPath(), 'CARVE-P0-024', 'text', { plus: at })
      continue
    }
    // An attribute run after it leads the `+`'s one block, so the item stays open for the line
    // after the run (CARVE-P0-008, corpus 325). A description-hosted list's readers refuse that `+`.
    if (lonePlus && attrRunLeads(lonePlus, form)) {
      if (form.attrLines) attrRest = { left: form.attrLines, cut: m.col - lonePlus.markerCanon!, floor: lonePlus.markerCanon! }
      lead(lonePlus.markerCanon!)
      finish()
      afterPlus = true
      continue
    }
    // Any other block it attaches there meets the `+` where the walk moved it (§17 L3, carve#4367).
    const plusLanding = lonePlus && landsAtMarker(lonePlus, form) ? lonePlus.markerCanon! : null
    // S5: apply the line where it reached, closing every frame it missed (T, CARVE-P0-003).
    const closed = frames.length - 1 - reached
    const reachedPath = trace && closed > 0 ? ownerPath(reached) : undefined
    const closedColumn = closesAColumn(frames.slice(reached + 1))
    const closedDescription = frames.slice(reached + 1).some((f) => f.plusBody)
    const sibling = frames[reached + 1]
    const traceParent = trace ? ownerPath(reached) : ''
    frames.length = reached + 1
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
      applyText(owner, closedColumn, plusFollower)
    } else if (plusLanding !== null) {
      lead(plusLanding)
      apply(owner, m.col, form, plusLanding)
    } else {
      if (!plusFollower) noteOpener(owner, form, owner.col)
      lead(owner.canon, form.kind === 'term' || form.kind === 'dd')
      apply(owner, m.col, form)
    }
    if (form.kind === 'quote' && plusFollower) markFirstBlockQuote(sibling)
    if (plusFollower && closedDescription) owner.last = 'dd'
    finish()
    if (trace) {
      const route = firstBlockTraceRoute(traceParent, sibling, plusFollower, at, form,
        appliedPath ?? ownerPath(), frames.length > reached + 1, closed, reachedPath)
      traceApply(at, form, route, plusFollower)
    }

    // S1: an open payload tests its closer first.
    function readPayload(inner: Frame): void {
      payloadLines.add(at)
      const payloadPath = trace ? ownerPath() : ''
      let payloadForm = 'payload'
      lead(Math.max(m.col - inner.cut, inner.canon))
      if (m.rest !== '' && inner.span) {
        const c = inner.span[0] === '%' ? COMMENT_FENCE.exec(m.rest) : PURE_FENCE.exec(m.rest)
        if (c && c[1]![0] === inner.span[0] &&
            (inner.span[0] === '%' ? c[1]!.length === inner.span.length : c[1]!.length >= inner.span.length)) inner.span = null
      } else if (m.rest !== '' && inner.closes!(m.rest, m.col)) {
        frames.pop()
        top().last = 'block'
        payloadForm = 'closer'
      } else if (inner.lineBlock) {
        // A span in a line-block payload pairs past the column too (carve-php#3137).
        const f = RE_FENCE.test(m.rest) || RE_RAW_FENCE.test(m.rest) ? /^(`{3,}|~{3,})/.exec(m.rest)![1]! : null
        const comment = COMMENT_FENCE.exec(m.rest)
        if (f && (closerRuns().widest[f[0] as '`' | '~']![at + 1] ?? 0) >= f.length) inner.span = f
        else if (comment && (closerRuns().lastComment.get(comment[1]!.length) ?? -1) > at) inner.span = comment[1]!
      }
      finish()
      if (trace) emit(at, 'S1', payloadPath, 'CARVE-P0-005', payloadForm, { cell: `B-${inner.family}-${payloadForm === 'closer' ? 'end' : 'keep'}` })
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

    function foldsLazily(form: Form, missedNote: boolean): boolean {
      const next = frames[reached + 1]
      return m.rest !== '' && top().para && !form.interrupts && form.kind !== 'dd' &&
        !(form.kind === 'item' && next?.kind === 'item' && sameListAxes(next, form)) &&
        !(missedNote && form.kind === 'item' && opensBesideMissedItem(form))
    }

    // Past a missed item a marker opens, unless it stands between a missed item's marker and content
    // columns and differs on any axis: that one is text of the open paragraph (carve#4545).
    function opensBesideMissedItem(form: Form): boolean {
      const items = frames.slice(reached + 1).filter((f) => f.kind === 'item')
      return items.length > 0 && !items.some((f) => m.col > f.markerCol! && m.col < f.col && !sameListAxes(f, form))
    }

    function attachesParagraph(host: Frame, form: Form): boolean {
      return (host.kind === 'item' || (host.kind === 'dd' || host.kind === 'note') && host.plus === at - 1) &&
        reached === frames.length - 2 && form.kind === 'text' && m.rest !== ''
    }

    function attrRunLeads(host: Frame, form: Form): boolean {
      return host.kind === 'item' && reached === frames.length - 2 && m.col === host.markerCol &&
        frames[reached]!.kind !== 'dd' && (form.attrLines !== undefined || isAttrLine(trimEndSpaceTab(m.rest))) &&
        lineAfterRun(at + 1 + (form.attrLines ?? 0), reached) >= host.col
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
      // A term's continuation moves with the term, so a later `:` body still follows it.
      const term = owner.para && owner.last === 'term'
      // So does the block a `+` attaches to a description.
      const attached = plusFollower && owner.termShift !== undefined && owner.last === 'dd'
      const cut = term ? owner.termCut! : attached ? owner.termShift! : Math.max(owner.cut, owner.closedList?.shift ?? 0)
      lead(owner.para || !closedColumn || plusFollower ? Math.max(m.col - cut, owner.canon) : owner.canon, term)
      owner.absorbs = (owner.para && owner.absorbs) || absorbsColon(m.rest)
      owner.para = true
      if (!term) owner.last = 'para'
    }

    // `col` is where the opener starts in the source, `canon` where it lands.
    function markFirstBlockQuote(host: Frame | undefined): void {
      if ((host?.kind !== 'item' && host?.kind !== 'dd') || host.plus !== at - 1) return
      const quote = frames.find((f) => f.kind === 'quote' && f.line === at)
      if (quote) quote.firstBlockQuote = true
    }

    function apply(owner: Frame, col: number, form: Form, canon = owner.canon): void {
      // A caption folds its next lines like a paragraph, list marker shapes too (CARVE-P2-021).
      owner.para = form.caption === true
      owner.last = form.kind
      owner.tableLine = form.table ? at : undefined
      if (form.attrLines) attrRest = { left: form.attrLines, cut: col - canon }
      if (form.kind === 'term') {
        owner.para = true
        owner.termCut = col - canon
        owner.termShift = col - owner.canon
      }
      if (form.kind === 'dd') owner.ddShift = col - owner.canon
      if (form.kind === 'fence' || form.kind === 'colon') {
        frames.push({ kind: form.kind, family: form.family ?? 'div', opened: at, col: owner.col, canon: owner.canon, cut: col - canon,
          closes: form.closes, run: form.run, lineBlock: form.lineBlock, span: null, para: false, last: null })
        return
      }
      if (form.kind === 'quote') {
        const quote: Frame = { kind: 'quote', col: 0, canon: 0, cut: 0, para: false, last: null, markerCol: col, markerCanon: canon,
          docMarker: docColumn(lines[at]!, src), line: at }
        frames.push(quote)
        take(src.length - quoteRest(src).length)
        m = indentCols(src)
        content(quote, 0, 0)
        return
      }
      if (form.kind === 'item' || form.kind === 'note' || form.kind === 'dd') {
        const frame: Frame = { kind: form.kind, col: col + form.width!, canon: canon + form.width!,
          cut: col - canon, para: false, last: null, markerCol: col, markerCanon: canon, axes: form.axes, task: form.task, token: form.token,
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
    function noteOpener(owner: Frame, form: Form, contentColumn: number): void {
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
      const form = classify(m.rest, frame, at, frame.kind === 'quote' ? m.col : start + m.col)
      if (form.kind === 'text') {
        if (CONT_MARKER.test(m.rest)) {
          frame.plusBody = true
          // Past the one space after a `>` and behind a lead tab, the `+` is text.
          const leadTab = src.slice(0, src.length - m.rest.length).includes('\t')
          const reason = frame.kind === 'quote' && m.col > 0 || leadTab ? 'right'
            : refusal(at, frame.docMarker!, frames.filter((f) => f.kind === 'quote' && f !== frame).length, frame.kind)
          if (reason !== null) {
            refuse(reason, frame.kind, true)
            spellPlusAsLetter()
          } else {
            afterPlus = true
            frame.plus = at
            attachedHost = frames.slice()
          }
        }
        lead(m.col)
        frame.absorbs = absorbsColon(m.rest)
        frame.para = frame.plus !== at
        frame.last = 'para'
        return
      }
      if (frame.kind === 'quote') {
        const col = m.col
        noteOpener(frame, form, 0)
        lead(0)
        apply(frame, col, form, 0)
        return
      }
      const col = start + m.col
      lead(m.col)
      apply(frame, col, form, canon + m.col)
    }

    function reopenAttachedHost(host: Frame[]): Frame | null {
      const col = docColumn(lines[at]!, m.rest)
      const hostAt = host.findIndex((f, k) => k > 0 && f.docMarker === col &&
        host.slice(1, k).filter((o) => o.kind === 'quote').length === quotes)
      if (hostAt <= 0 || refusal(at, col, quotes, host[hostAt]!.kind) !== null) return null
      frames.length = 0
      frames.push(...host.slice(0, hostAt + 1))
      return top()
    }

    function attachedBlockEnded(form: Form, owner: Frame, depth: number): boolean {
      if (m.rest === '') return top().kind !== 'fence'
      return depth === 0 && !(owner.para && form.kind === 'text') && !isTableRow(m.rest) && form.kind !== 'item'
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
  }
  return { lines: result, cuts, letters, refusedPlus, payloadLines, overindented }

  function standIn(ch: string): string {
    letters ??= pickSentinelRun(occupiedPrivateUse(lines), STAND_IN_BASE, STANDS_FOR.length)
    return letters[STANDS_FOR.indexOf(ch)]!
  }

  // The one attach rule (carve#4409): the next line stands at `marker` through the
  // host's `quotes` prefixes and is not the host's sibling. The host decides nothing else.
  function refusal(at: number, marker: number, quotes: number, host: Frame['kind']): RefusedPlus['reason'] | null {
    // An attribute run leads the attached block, so the block after it decides (carve#4278, carve#4447).
    for (let k = at + 1; ; k++) {
      const next = lines[k]
      if (next === undefined) return 'document'
      let n = indentCols(next)
      for (let q = 0; q < quotes; q++) {
        if (!isQuoteLine(n.rest)) return 'left'
        n = indentCols(quoteRest(n.rest))
      }
      if (n.rest === '') return 'blank'
      const col = docColumn(next, n.rest)
      if (col !== marker) return col < marker ? 'left' : 'right'
      const rest = trimEndSpaceTab(n.rest)
      if (isAttrLine(rest)) continue
      const wrapped = rest[0] === '{' ? wrappedAttrRun(rest, quotes, k) : null
      if (wrapped !== null) {
        k += wrapped
        continue
      }
      // A closer ends a body and is no block.
      if (COLON_CLOSER.test(rest) && frames.some((f) => f.kind === 'colon' && f.run === COLON_CLOSER.exec(rest)![1]!.length)) return 'document'
      if (host === 'item' && matchMarker(rest) !== null) return 'sibling'
      if (host === 'dd' && (DD.test(rest) || DEFLIST_TERM.test(rest))) return 'sibling'
      return null
    }
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
    extra: { [K in 'cell' | 'closed' | 'reached' | 'plus']?: TraceRecord[K] | undefined } = {}): void {
    if (traceAlias !== null) {
      if (owner === traceAlias.from || owner.startsWith(`${traceAlias.from}/`)) {
        owner = traceAlias.to + owner.slice(traceAlias.from.length)
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
      { cell, closed: route.closed > 0 ? route.closed : undefined, reached: route.reached, plus: plusFollower ? at : undefined })
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

  function absorbsColon(rest: string): boolean {
    const trimmed = trimEndSpaceTab(rest)
    return COLON_FENCE.test(trimmed) && !isColonFenceOpener(trimmed)
  }

  function classify(rest: string, owner: Frame, at: number, col: number): Form {
    rest = trimEndSpaceTab(rest)
    if (rest === '') return { kind: 'blank', interrupts: true }
    if (!OPENER_LEAD.test(rest)) return TEXT
    if (isQuoteLine(rest)) return { kind: 'quote', interrupts: true }
    const colon = COLON_FENCE.exec(rest)
    if (colon && COLON_CLOSER.test(rest)) {
      // A closer is read in its owner: only a colon body at the reached depth, or holding it directly, can take it.
      for (let k = reach; k > 0 && frames[k]!.kind === 'colon'; k--) {
        if (frames[k]!.run === colon[1]!.length) return { kind: 'colon-close', frame: k, interrupts: true }
      }
    }
    if (colon && isColonFenceOpener(rest)) {
      const run = colon[1]!.length
      // A bare `:::` interrupts unless the paragraph's own lines absorbed an invalid opener (§10 I4).
      const interrupts = !COLON_CLOSER.test(rest) || !(owner === top() && owner.para && owner.absorbs)
      if (owner.para && !interrupts) return { kind: 'text', interrupts: false }
      if (RE_LINE_BLOCK_OPEN.test(rest)) {
        return { kind: 'fence', family: 'div', interrupts, lineBlock: true, closes: (r) => COLON_CLOSER.exec(r)?.[1]!.length === run }
      }
      return { kind: 'colon', run, interrupts }
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
      if ((closerRuns().lastComment.get(run) ?? -1) > at) return { kind: 'fence', family: 'comment', interrupts: true, closes }
    }
    if (COMMENT_LINE.test(rest)) return { kind: 'leaf', interrupts: true }
    const note = NOTE_HEAD.exec(rest)
    if (note && FOOTNOTE_DEF.test(rest)) return { kind: 'note', width: 2, head: note[0].length, interrupts: true }
    // T6: a continuation row right under a row of the owner's table moves with the rows (carve#4161).
    if (owner.tableLine === at - 1 && RE_TABLE_CONT.test(rest) && isTableRow('|' + rest.slice(1))) {
      return { kind: 'leaf', interrupts: true, table: true }
    }
    const marker = matchMarker(rest)
    // §10 I2: under an open paragraph a marker opens only in a list item. A term is not such a paragraph.
    if (marker && owner.para && owner.kind !== 'item' && owner.last !== 'term') return { kind: 'text', interrupts: false }
    if (marker) return { kind: 'item', width: marker.width, head: marker.head, interrupts: false, axes: marker.axes, task: marker.task, token: marker.token }
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
      const attrLines = wrappedAttrLines(rest, owner, at)
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
  function wrappedAttrLines(rest: string, owner: Frame, at: number): number | null {
    return wrappedAttrRun(rest, frames.slice(1, frames.indexOf(owner) + 1).filter((f) => f.kind === 'quote').length, at)
  }

  function wrappedAttrRun(rest: string, depth: number, at: number): number | null {
    let collected = rest
    for (let j = at + 1; j < lines.length; j++) {
      let line: string | null = lines[j]!
      for (let q = 0; q < depth && line !== null; q++) {
        const quoted: string = indentCols(line).rest
        line = isQuoteLine(quoted) ? quoteRest(quoted) : null
      }
      if (line === null || line.trim() === '' || /^[ \t]*\{/.test(line)) return null
      const closed = line.includes('}')
      if (!closed && !isValidAttrPayload(`\n${line}\n`)) return null
      collected += `\n${line}`
      if (closed) return parseBlockAttributeRun(collected) ? j - at : null
    }
    return null
  }

  // Span pairing in one pass: the widest pure fence run of each character
  // at or after every line, and the last line of each comment run length.
  function closerRuns(): NonNullable<typeof runs> {
    if (runs) return runs
    const widest = { '`': new Array<number>(lines.length + 1).fill(0), '~': new Array<number>(lines.length + 1).fill(0) }
    runs = { widest, lastComment: new Map() }
    for (let j = lines.length - 1; j >= 0; j--) {
      const rest = quotedRest(lines[j]!)
      widest['`'][j] = widest['`'][j + 1]!
      widest['~'][j] = widest['~'][j + 1]!
      const c = PURE_FENCE.exec(rest)
      if (c) {
        const ch = c[1]![0] as '`' | '~'
        widest[ch][j] = Math.max(widest[ch][j]!, c[1]!.length)
      }
      const comment = COMMENT_FENCE.exec(rest)
      if (comment && !runs.lastComment.has(comment[1]!.length)) runs.lastComment.set(comment[1]!.length, j)
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
