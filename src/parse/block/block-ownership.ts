import { isValidAttrPayload } from '../../extension/attribute-parser.js'
import { trimEndSpaceTab } from '../../trim-non-nbsp.js'
import { occupiedPrivateUse, pickSentinelRun } from '../inline/sentinel-run.js'
import type { RefusedContinuationMarker } from './parse-block-scan-core.js'
import {
  isColonFenceOpener,
  isLinkDefLine,
  isTableRow,
  RE_ABBR_DEF,
  RE_FENCE,
  RE_HR,
  RE_LINE_BLOCK_OPEN,
  RE_RAW_FENCE,
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
  run?: number | undefined
  closes?: ((rest: string, col: number) => boolean) | undefined
  termCut?: number
  lineBlock?: boolean | undefined
  span?: string | null
  // Lint grouping: the line of the last table row read in this frame.
  tableLine?: number
  // A description whose marker line held a lone `+`, accepted or refused.
  plusBody?: boolean
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
const CAPTION = /^\^ (?=[^\n\r\u2028\u2029]*$)[ \t\f]*[^ \t\f]/
const ATTR_BLOCK = `\\{(?:[^}'"\\\\]|\\\\.|'(?:[^'\\\\]|\\\\.)*'|"(?:[^"\\\\]|\\\\.)*")*\\}`
const BULLET = new RegExp(`^([-*])(${ATTR_BLOCK})?( +)(?:\\[([ xX_>/!?-])\\] )?(?=.)`)
const ORDERED = new RegExp(`^([0-9]+|[a-z]+|[A-Z]+|(?=\\.))([.)])(${ATTR_BLOCK})?( +)(?=.)`)
const MAX_FRAMES = 200
const PLUS_LETTER_BASE = 0xf8f0
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
  const line = trimEndSpaceTab(rest)
  let m = BULLET.exec(line)
  if (m && gluedAttrsValid(m[2])) {
    return { width: 1 + (m[4] !== undefined ? 1 : m[3]!.length), head: m[0].length, axes: m[1]! }
  }
  m = ORDERED.exec(line)
  if (m && orderedTokenValid(m[1]!) && gluedAttrsValid(m[3])) {
    return { width: m[1]!.length + 1 + m[4]!.length, head: m[0].length, axes: m[2]! }
  }
  return null
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
    if (close === -1 || !isValidAttrPayload(text.slice(pos + 1, close))) return false
    lists++
    pos = close + 1
  }
  return lists > 0
}

function quotedMeasure(line: string): { col: number; rest: string } {
  let m = indentCols(line)
  while (isQuoteLine(m.rest)) m = indentCols(quoteRest(m.rest))
  return m
}

const quotedRest = (line: string): string => quotedMeasure(line).rest

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
): { lines: string[]; cuts: Map<number, OwnershipCut[]>; plusLetter: string | null; refusedPlus: RefusedPlus[]; payloadLines: Set<number>; overindented: OverindentedOpener[] } {
  const result = lines.slice(0, start)
  if (trace) for (let k = 0; k < start; k++) emit(k, 'INPUT', 'doc', null, 'frontmatter')
  const cuts = new Map<number, OwnershipCut[]>()
  const frames: Frame[] = [{ kind: 'doc', col: 0, canon: 0, cut: 0, para: false, last: null }]
  const top = (): Frame => frames[frames.length - 1]!
  let reach = 0
  let runs: { widest: Record<string, number[]>; lastComment: Map<number, number> } | null = null
  // The line after an accepted `+` keeps its column: the marker reads it.
  let afterPlus = false
  // The stand-in for a refused `+`: readers meet a plain letter, the AST gets the `+` back.
  let plusLetter: string | null = null
  // The frames of the host a `+` last attached through. The attached block stands outside
  // the host's columns and closes it here, and a further `+` still reaches it (§17 L3).
  let attachedHost: Frame[] | null = null
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
        lineCuts.push({ at: out.length, removed: run - col })
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
        reached = k
        continue
      }
      if (m.rest !== '' && m.col < f.col) break
      reached = k
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
    const plusFollower = afterPlus
    afterPlus = false
    // An attribute run leads the attached block: the host stays open for the block itself.
    if (plusFollower && isAttrLine(trimEndSpaceTab(m.rest))) {
      lead(m.col)
      finish()
      afterPlus = true
      continue
    }
    if (CONT_MARKER.test(m.rest) && !(top().kind === 'fence' && reached === frames.length - 1)) spellStrayPlus(reached)
    const missed = reached < frames.length - 1
    reach = reached
    const inner = top()
    if (inner.kind === 'fence' && !missed) {
      // S1: an open payload tests its closer first.
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
      continue
    }
    if (inner.kind === 'fence') frames.pop()
    let owner = frames[reached]!
    const form = classify(m.rest, owner, at, m.col)
    if (form.kind === 'text' && TRAILING_PLUS.test(m.rest)) spellTrailingPlusAsLetter()
    if (!plusFollower && attachedBlockEnded(form, owner, reached)) attachedHost = null
    // Past a missed note a marker opens where an item or a description body owns it (§10 I2), or beside a missed list.
    // A missed quote keeps the line as the quote's lazy text.
    const missedNote = missed && frames.slice(reached + 1).some((f) => f.kind === 'note') &&
      !frames.slice(reached + 1).some((f) => f.kind === 'quote')
    // A `: ` line below the body column of a description a `+` touched is its sibling at any column (carve#4408).
    if (missed && m.rest !== '' && top().para && !form.interrupts && !(form.kind === 'dd' && frames[reached + 1]?.plusBody) &&
        !(form.kind === 'item' && frames[reached + 1]?.kind === 'item' && frames[reached + 1]!.axes === form.axes) &&
        !(missedNote && form.kind === 'item' &&
          (owner.kind === 'item' || owner.kind === 'dd' || frames.slice(reached + 1).some((f) => f.kind === 'item')))) {
      // S4: a lazy line stays text where it stands, short of the frame it missed.
      if (TRAILING_PLUS.test(m.rest) && !lazyMarkerLineAttaches(form)) spellTrailingPlusAsLetter()
      const next = frames[reached + 1]!
      const limit = next.kind === 'quote' ? Infinity : next.canon - 1
      lead(Math.min(Math.max(m.col - owner.cut, owner.canon), limit))
      finish()
      if (trace) emit(at, 'S4', ownerPath(), 'CARVE-P0-006', 'lazy', { reached: ownerPath(reached) })
      continue
    }
    // S5: apply the line where it reached, closing every frame it missed (T, CARVE-P0-003).
    const closed = frames.length - 1 - reached
    const reachedPath = trace && closed > 0 ? ownerPath(reached) : undefined
    const closedColumn = frames.slice(reached + 1).some((f) => f.kind !== 'quote')
    const closedDescription = frames.slice(reached + 1).some((f) => f.plusBody)
    frames.length = reached + 1
    owner = top()
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
      // A new paragraph starts at the owner's column, never inside a frame it did not reach.
      // A term's continuation moves with the term, so a later `:` body still follows it.
      const term = owner.para && owner.last === 'term'
      const cut = term ? owner.termCut! : owner.cut
      lead(owner.para || !closedColumn || plusFollower ? Math.max(m.col - cut, owner.canon) : owner.canon, term)
      owner.absorbs = (owner.para && owner.absorbs) || absorbsColon(m.rest)
      owner.para = true
      if (!term) owner.last = 'para'
    } else {
      if (!plusFollower) noteOpener(owner, form, owner.col)
      lead(owner.canon, form.kind === 'term' || form.kind === 'dd')
      apply(owner, m.col, form)
    }
    if (plusFollower && closedDescription) owner.last = 'dd'
    finish()
    if (trace) traceApply(at, form, appliedPath ?? ownerPath(), closed, reachedPath, plusFollower)

    // `col` is where the opener starts in the source, `canon` where it lands.
    function apply(owner: Frame, col: number, form: Form, canon = owner.canon): void {
      // A caption folds its next lines like a paragraph, list marker shapes too (CARVE-P2-021).
      owner.para = form.caption === true
      owner.last = form.kind
      if (form.kind === 'term') {
        owner.para = true
        owner.termCut = col - canon
      }
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
          cut: col - canon, para: false, last: null, markerCol: col, markerCanon: canon, axes: form.axes,
          docMarker: docColumn(lines[at]!, src), line: at }
        frames.push(frame)
        take(form.head!)
        m = indentCols(src)
        content(frame, col + form.head!, canon + form.head!)
      }
    }

    // An opener past a non-item owner's content column. List items and markers have their own lint rules.
    function noteOpener(owner: Frame, form: Form, contentColumn: number): void {
      const kind = openerKind(form, m.rest)
      if (kind === 'table row') {
        const continuing = owner.tableLine === at - 1
        owner.tableLine = at
        if (continuing) return
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
            attachedHost = frames.slice()
          }
        }
        lead(m.col)
        frame.absorbs = absorbsColon(m.rest)
        frame.para = true
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
      plusLetter ??= pickSentinelRun(occupiedPrivateUse(lines), PLUS_LETTER_BASE, 1)[0]!
      const letter = plusLetter + m.rest.slice(1)
      src = src.slice(0, src.length - m.rest.length) + letter
      m = { col: m.col, rest: letter }
    }

    // A marker-line `+` read as text under an open paragraph starts no body.
    function spellTrailingPlusAsLetter(): void {
      plusLetter ??= pickSentinelRun(occupiedPrivateUse(lines), PLUS_LETTER_BASE, 1)[0]!
      const letter = m.rest.replace(/\+([ \t]*)$/, `${plusLetter}$1`)
      src = src.slice(0, src.length - m.rest.length) + letter
      m = { col: m.col, rest: letter }
    }
  }
  return { lines: result, cuts, plusLetter, refusedPlus, payloadLines, overindented }

  // The one attach rule (carve#4409): the next line stands at `marker` through the
  // host's `quotes` prefixes and is not the host's sibling. The host decides nothing else.
  function refusal(at: number, marker: number, quotes: number, host: Frame['kind']): RefusedPlus['reason'] | null {
    const next = lines[at + 1]
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
    // A closer ends a body and is no block.
    if (COLON_CLOSER.test(rest) && frames.some((f) => f.kind === 'colon' && f.run === COLON_CLOSER.exec(rest)![1]!.length)) return 'document'
    if (host === 'item' && matchMarker(rest) !== null) return 'sibling'
    if (host === 'dd' && (DD.test(rest) || DEFLIST_TERM.test(rest))) return 'sibling'
    return null
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
    const record: TraceRecord = { line: index + 1, step, owner, rule, form }
    for (const [key, value] of Object.entries(extra)) if (value !== undefined) (record as unknown as Record<string, unknown>)[key] = value
    trace!.push(record)
  }

  function traceApply(at: number, form: Form, owner: string, closed: number, reached: string | undefined, plusFollower: boolean): void {
    const kind = TRACE_FORM[form.kind] ?? form.family ?? form.kind
    const cell = form.kind === 'colon-close' ? 'B-div-end' : TRACE_OPENS.has(form.kind) ? `B-${form.family ?? kind}-start` : undefined
    emit(at, 'S5', owner, TRACE_RULE[form.kind] ?? 'CARVE-P0-024', kind,
      { cell, closed: closed > 0 ? closed : undefined, reached, plus: plusFollower ? at : undefined })
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
    const marker = matchMarker(rest)
    // §10 I2: under an open paragraph a marker opens only in a list item. A term is not such a paragraph.
    if (marker && owner.para && owner.kind !== 'item' && owner.last !== 'term') return { kind: 'text', interrupts: false }
    if (marker) return { kind: 'item', width: marker.width, head: marker.head, interrupts: false, axes: marker.axes }
    if (DEFLIST_TERM.test(rest)) return { kind: 'term', interrupts: true }
    const dd = DD.exec(rest)
    if (dd && (owner.last === 'term' || owner.last === 'dd')) {
      return { kind: 'dd', width: 1 + dd[1]!.length, head: 1 + dd[1]!.length, interrupts: false }
    }
    if (HEADING.test(rest) || RE_HR.test(rest) || isTableRow(rest) || isLinkDefLine(rest) ||
        FOOTNOTE_DEF.test(rest) || RE_ABBR_DEF.test(rest) || isAttrLine(rest)) {
      return { kind: 'leaf', interrupts: true }
    }
    if (CAPTION.test(rest)) return { kind: 'leaf', interrupts: false, caption: true }
    return { kind: 'text', interrupts: false }
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

/** Put the `+` back wherever the walk's stand-in landed in the tree. */
export function restorePlusLetter(root: object, letter: string): void {
  const stack: object[] = [root]
  const visited = new WeakSet<object>()
  while (stack.length > 0) {
    const node = stack.pop()! as Record<string, unknown>
    if (visited.has(node)) continue
    visited.add(node)
    for (const key of Object.keys(node)) {
      const value = node[key]
      if (typeof value === 'string') {
        if (value.includes(letter)) node[key] = value.replaceAll(letter, '+')
      } else if (value !== null && typeof value === 'object') stack.push(value)
    }
  }
}
