import { isValidAttrPayload } from '../../extension/attribute-parser.js'
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
  axes?: string | undefined
  run?: number | undefined
  closes?: ((rest: string) => boolean) | undefined
  termCut?: number
  lineBlock?: boolean | undefined
  span?: string | null
}

interface Form {
  kind: 'blank' | 'quote' | 'colon-close' | 'colon' | 'fence' | 'leaf' | 'note' | 'item' | 'term' | 'dd' | 'text'
  interrupts: boolean
  frame?: number
  run?: number
  closes?: (rest: string) => boolean
  width?: number
  head?: number
  axes?: string
  lineBlock?: boolean
}

const QUOTE_LINE = /^>(?: ([^\r\n]*)|[ \t]*$)/
const CONT_MARKER = /^\+[ \t]*$/
const COLON_FENCE = /^(:{3,})(.*)$/
const COLON_CLOSER = /^(:{3,})[ \t]*$/
const PURE_FENCE = /^(`{3,}|~{3,})[ \t]*$/
const COMMENT_FENCE = /^(%{3,})(.*)$/
const COMMENT_LINE = /^[ \t]*%%/
const NOTE_HEAD = /^\[\^[^\]]+\]: +/
const FOOTNOTE_DEF = /^\[\^([^\]]+)\]: +(?![ \t]*$)([^ ].*)$/
const DEFLIST_TERM = /^:: (?=[ \t]*[^ \t\n\r])/
const DD = /^:( +)(?=[ \t]*[^ \t])/
const HEADING = /^(#{1,6}) +(?=.*[^ \t\n\r\f])(.*)$/
const CAPTION = /^\^ +(?=.*[^ \t\n\r\f])(.*?)[ \t]*$/
const ATTR_BLOCK = `\\{(?:[^}'"\\\\]|\\\\.|'(?:[^'\\\\]|\\\\.)*'|"(?:[^"\\\\]|\\\\.)*")*\\}`
const BULLET = new RegExp(`^([-*])(${ATTR_BLOCK})?( +)(?:\\[([ xX_>/!?-])\\] )?(.+)$`)
const ORDERED = new RegExp(`^([0-9]+|[a-z]+|[A-Z]+|(?=\\.))([.)])(${ATTR_BLOCK})?( +)(.+)$`)
const MAX_FRAMES = 200
// A line that cannot start any opener: no leading punctuation an opener uses and no ordered marker.
const OPENER_LEAD = /^[>:`~%[\-*#_|{^+.0-9]|^[A-Za-z]+[.)] /
const TEXT: Form = { kind: 'text', interrupts: false }

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

const quoteRest = (rest: string): string => QUOTE_LINE.exec(rest)?.[1] ?? ''

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
  const line = rest.replace(/[ \t]+$/, '')
  let m = BULLET.exec(line)
  if (m && gluedAttrsValid(m[2])) {
    return { width: 1 + (m[4] !== undefined ? 1 : m[3]!.length), head: line.length - m[5]!.length, axes: m[1]! }
  }
  m = ORDERED.exec(line)
  if (m && orderedTokenValid(m[1]!) && gluedAttrsValid(m[3])) {
    return { width: m[1]!.length + 1 + m[4]!.length, head: line.length - m[5]!.length, axes: m[2]! }
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
  while (QUOTE_LINE.test(m.rest)) m = indentCols(quoteRest(m.rest))
  return m
}

const quotedRest = (line: string): string => quotedMeasure(line).rest

/**
 * Rule A (carve#3885): every line is first matched against the open containers,
 * and an opener past its owner's content column opens there, measured from its
 * own line. The walk moves such an opener, and every line its block owns, onto
 * the owner's content column, so the block readers only meet openers at a
 * content column. Indentation is only ever removed.
 */
export function ownLines(lines: string[], start = 0): { lines: string[]; cuts: Map<number, OwnershipCut[]> } {
  const result = lines.slice(0, start)
  const cuts = new Map<number, OwnershipCut[]>()
  const frames: Frame[] = [{ kind: 'doc', col: 0, canon: 0, cut: 0, para: false, last: null }]
  const top = (): Frame => frames[frames.length - 1]!
  let reach = 0
  let runs: { widest: Record<string, number[]>; lastComment: Map<number, number>; byColumn: Map<string, number[]> } | null = null
  // The line after an accepted `+` keeps its column: the marker reads it.
  let afterPlus = false

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
    for (let k = 1; k < frames.length; k++) {
      const f = frames[k]!
      // A lone `+` reaches the marker column of an open marker container.
      if (f.markerCol !== undefined && CONT_MARKER.test(m.rest) && m.col === f.markerCol &&
          (f.kind === 'quote' || m.col < f.col)) {
        plus = f
        break
      }
      if (f.kind === 'quote') {
        if (!QUOTE_LINE.test(m.rest)) break
        lead(frames[k - 1]!.canon)
        take(src.length - quoteRest(src).length)
        m = indentCols(src)
        reached = k
        continue
      }
      if (m.rest !== '' && m.col < f.col) break
      reached = k
    }
    if (plus) {
      frames.length = frames.indexOf(plus) + 1
      plus.para = false
      lead(plus.markerCanon!)
      finish()
      afterPlus = true
      continue
    }
    const plusFollower = afterPlus
    afterPlus = false
    const missed = reached < frames.length - 1
    reach = reached
    const inner = top()
    if (inner.kind === 'fence' && !missed) {
      // Step 1: an open payload tests its closer first.
      lead(Math.max(m.col - inner.cut, inner.canon))
      if (m.rest !== '' && inner.span) {
        const c = inner.span[0] === '%' ? COMMENT_FENCE.exec(m.rest) : PURE_FENCE.exec(m.rest)
        if (c && c[1]![0] === inner.span[0] &&
            (inner.span[0] === '%' ? c[1]!.length === inner.span.length : c[1]!.length >= inner.span.length)) inner.span = null
      } else if (m.rest !== '' && inner.closes!(m.rest)) {
        frames.pop()
        top().last = 'block'
      } else if (inner.lineBlock) {
        // A span in a line-block payload pairs past the column too (carve-php#3137).
        const f = RE_FENCE.test(m.rest) || RE_RAW_FENCE.test(m.rest) ? /^(`{3,}|~{3,})/.exec(m.rest)![1]! : null
        const comment = COMMENT_FENCE.exec(m.rest)
        if (f && (closerRuns().widest[f[0] as '`' | '~']![at + 1] ?? 0) >= f.length) inner.span = f
        else if (comment && (closerRuns().lastComment.get(comment[1]!.length) ?? -1) > at) inner.span = comment[1]!
      }
      finish()
      continue
    }
    if (inner.kind === 'fence') frames.pop()
    let owner = frames[reached]!
    const form = classify(m.rest, owner, at)
    if (missed && m.rest !== '' && top().para && !form.interrupts &&
        !(form.kind === 'item' && frames[reached + 1]?.kind === 'item' && frames[reached + 1]!.axes === form.axes)) {
      // Step 4: a lazy line stays text where it stands, short of the frame it missed.
      const next = frames[reached + 1]!
      const limit = next.kind === 'quote' ? Infinity : next.canon - 1
      lead(Math.min(Math.max(m.col - owner.cut, owner.canon), limit))
      finish()
      continue
    }
    const closedColumn = frames.slice(reached + 1).some((f) => f.kind !== 'quote')
    frames.length = reached + 1
    owner = top()
    if (m.rest === '') {
      owner.para = false
      lead(m.col)
    } else if (form.kind === 'colon-close') {
      lead(frames[form.frame!]!.canon)
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
      lead(owner.canon, form.kind === 'term' || form.kind === 'dd')
      apply(owner, m.col, form)
    }
    finish()

    // `col` is where the opener starts in the source, `canon` where it lands.
    function apply(owner: Frame, col: number, form: Form, canon = owner.canon): void {
      owner.para = false
      owner.last = form.kind
      if (form.kind === 'term') {
        owner.para = true
        owner.termCut = col - canon
      }
      if (form.kind === 'fence' || form.kind === 'colon') {
        frames.push({ kind: form.kind, col: owner.col, canon: owner.canon, cut: col - canon,
          closes: form.closes, run: form.run, lineBlock: form.lineBlock, span: null, para: false, last: null })
        return
      }
      if (form.kind === 'quote') {
        const quote: Frame = { kind: 'quote', col: 0, canon: 0, cut: 0, para: false, last: null, markerCol: col, markerCanon: canon }
        frames.push(quote)
        take(src.length - quoteRest(src).length)
        m = indentCols(src)
        content(quote, 0, 0)
        return
      }
      if (form.kind === 'item' || form.kind === 'note' || form.kind === 'dd') {
        const frame: Frame = { kind: form.kind, col: col + form.width!, canon: canon + form.width!,
          cut: col - canon, para: false, last: null, markerCol: col, markerCanon: canon, axes: form.axes }
        frames.push(frame)
        take(form.head!)
        m = indentCols(src)
        content(frame, col + form.head!, canon + form.head!)
      }
    }

    // The rest of a marker line. Only a quote starts new coordinates, so only there can its content move.
    function content(frame: Frame, start: number, canon: number): void {
      if (m.rest === '' || frames.length > MAX_FRAMES) return
      const form = classify(m.rest, frame, at)
      if (form.kind === 'text') {
        lead(m.col)
        frame.absorbs = absorbsColon(m.rest)
        frame.para = true
        frame.last = 'para'
        return
      }
      if (frame.kind === 'quote') {
        const col = m.col
        lead(0)
        apply(frame, col, form, 0)
        return
      }
      const col = start + m.col
      lead(m.col)
      apply(frame, col, form, canon + m.col)
    }
  }
  return { lines: result, cuts }

  function absorbsColon(rest: string): boolean {
    const trimmed = rest.replace(/[ \t]+$/, '')
    return COLON_FENCE.test(trimmed) && !isColonFenceOpener(trimmed)
  }

  function classify(rest: string, owner: Frame, at: number): Form {
    rest = rest.replace(/[ \t]+$/, '')
    if (rest === '') return { kind: 'blank', interrupts: true }
    if (!OPENER_LEAD.test(rest)) return TEXT
    if (QUOTE_LINE.test(rest)) return { kind: 'quote', interrupts: true }
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
        return { kind: 'fence', interrupts, lineBlock: true, closes: (r) => COLON_CLOSER.exec(r)?.[1]!.length === run }
      }
      return { kind: 'colon', run, interrupts }
    }
    if (RE_FENCE.test(rest) || RE_RAW_FENCE.test(rest)) {
      const run = /^(`{3,}|~{3,})/.exec(rest)![1]!
      const closes = (r: string): boolean => {
        const c = PURE_FENCE.exec(r)
        return !!(c && c[1]![0] === run[0] && c[1]!.length >= run.length)
      }
      // A closer below the owner's column never matches (CARVE-P0-014).
      const reachable = (widestFrom(run[0] as '`' | '~', owner.col)[at + 1] ?? 0) >= run.length
      if (owner.para && !reachable) return { kind: 'text', interrupts: false }
      return { kind: 'fence', interrupts: reachable, closes }
    }
    const comment = COMMENT_FENCE.exec(rest)
    if (comment) {
      const run = comment[1]!.length
      const closes = (r: string): boolean => COMMENT_FENCE.exec(r)?.[1]!.length === run
      if ((closerRuns().lastComment.get(run) ?? -1) > at) return { kind: 'fence', interrupts: true, closes }
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
    if (CAPTION.test(rest)) return { kind: 'leaf', interrupts: false }
    return { kind: 'text', interrupts: false }
  }

  // Closer lookahead in one pass: the widest pure fence run of each character
  // at or after every line, and the last line of each comment run length.
  function closerRuns(): NonNullable<typeof runs> {
    if (runs) return runs
    const widest = { '`': new Array<number>(lines.length + 1).fill(0), '~': new Array<number>(lines.length + 1).fill(0) }
    runs = { widest, lastComment: new Map(), byColumn: new Map() }
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

  // The widest closer run of `char` at or after every line, counting only closers at `col` or deeper.
  function widestFrom(char: '`' | '~', col: number): number[] {
    const key = `${char}${col}`
    const all = closerRuns()
    const cached = all.byColumn.get(key)
    if (cached) return cached
    const widest = new Array<number>(lines.length + 1).fill(0)
    for (let j = lines.length - 1; j >= 0; j--) {
      widest[j] = widest[j + 1]!
      const m = quotedMeasure(lines[j]!)
      if (m.col < col) continue
      const c = PURE_FENCE.exec(m.rest)
      if (c && c[1]![0] === char) widest[j] = Math.max(widest[j]!, c[1]!.length)
    }
    all.byColumn.set(key, widest)
    return widest
  }
}
