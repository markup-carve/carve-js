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

/** An opener S3 read past its owner's content column; `char` indexes the input line. */
export interface OverindentedOpener { index: number; char: number; kind: string; owner: string; contentColumn: number; column: number }

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
  // The line holding this frame's lone first-block `+`.
  plus?: number | undefined
  axes?: string | undefined
  run?: number | undefined
  closes?: ((rest: string, col: number) => boolean) | undefined
  termCut?: number
  lineBlock?: boolean | undefined
  span?: string | null
  // Lint grouping: the line of the last table row read in this frame.
  tableLine?: number
}

interface Form {
  kind: 'blank' | 'quote' | 'colon-close' | 'colon' | 'fence' | 'leaf' | 'note' | 'item' | 'term' | 'dd' | 'text'
  interrupts: boolean
  frame?: number
  run?: number
  closes?: (rest: string, col: number) => boolean
  width?: number
  head?: number
  axes?: string
  lineBlock?: boolean
}

interface AheadColumn { lengths: number[]; suffix: number[]; from: number }
interface AheadTree { size: number; columns: AheadColumn[]; max: number[] }
interface AheadIndex { next: number; at: [('`' | '~'), number][][]; '`': AheadTree; '~': AheadTree }

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
const BULLET = new RegExp(`^([-*])(${ATTR_BLOCK})?( +)(?:\\[([ xX_>/!?-])\\] )?(?=.)`)
const ORDERED = new RegExp(`^([0-9]+|[a-z]+|[A-Z]+|(?=\\.))([.)])(${ATTR_BLOCK})?( +)(?=.)`)
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
  const line = rest.replace(/[ \t]+$/, '')
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
 * content column. Indentation is only ever removed.
 */
export function ownLines(lines: string[], start = 0): { lines: string[]; cuts: Map<number, OwnershipCut[]>; refusedPlus: Set<number>; overindented: OverindentedOpener[] } {
  const result = lines.slice(0, start)
  const cuts = new Map<number, OwnershipCut[]>()
  const frames: Frame[] = [{ kind: 'doc', col: 0, canon: 0, cut: 0, para: false, last: null }]
  const top = (): Frame => frames[frames.length - 1]!
  let reach = 0
  let runs: { widest: Record<string, number[]>; lastComment: Map<number, number>; ahead?: AheadIndex } | null = null
  // The line after an accepted `+` keeps its column: the marker reads it.
  let afterPlus = false
  // Quote first-block `+` lines whose follower stands at an ineligible raw column.
  const refusedPlus = new Set<number>()
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
    // A quote's first-block `+` reads a follower by its raw column (CARVE-P9-067).
    const quotePlus = top().kind === 'quote' && top().plus === at - 1 ? top() : null
    const baseAt = quotePlus ? frames.findIndex((f) => f.line === at - 1) : -1
    let stackCol = quotePlus ? null as number | null : undefined
    // Column 0 of the follower's own quote level, past host quote prefixes.
    let zero = 0
    for (let k = 1; k < frames.length; k++) {
      const f = frames[k]!
      if (stackCol === null && f.line === at - 1) stackCol = -1
      // A lone `+` reaches the marker column of an open marker container.
      if (f.markerCol !== undefined && CONT_MARKER.test(m.rest) && m.col === f.markerCol &&
          (f.kind === 'quote' || m.col < f.col)) {
        plus = f
        break
      }
      if (f.kind === 'quote') {
        if (!isQuoteLine(m.rest)) break
        if (stackCol === -1) stackCol = docColumn(lines[at]!, m.rest)
        lead(frames[k - 1]!.canon)
        take(src.length - quoteRest(src).length)
        if (k < baseAt) zero = docColumn(lines[at]!, src)
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
    // A follower at an ineligible raw column refuses the `+` whatever block it starts (CARVE-P9-067, carve#3421).
    const stacked = typeof stackCol === 'number' && stackCol >= 0
    if (quotePlus && (missed || stacked) && m.rest !== '' && !CONT_MARKER.test(m.rest)) {
      const col = stacked ? stackCol! : docColumn(lines[at]!, m.rest)
      if (col !== 0 && col !== zero && col !== frames[baseAt]!.docMarker && col !== quotePlus.docMarker) refusedPlus.add(at - 1)
    }
    reach = reached
    const inner = top()
    if (inner.kind === 'fence' && !missed) {
      // Step 1: an open payload tests its closer first.
      lead(Math.max(m.col - inner.cut, inner.canon))
      if (m.rest !== '' && inner.span) {
        const c = inner.span[0] === '%' ? COMMENT_FENCE.exec(m.rest) : PURE_FENCE.exec(m.rest)
        if (c && c[1]![0] === inner.span[0] &&
            (inner.span[0] === '%' ? c[1]!.length === inner.span.length : c[1]!.length >= inner.span.length)) inner.span = null
      } else if (m.rest !== '' && inner.closes!(m.rest, m.col)) {
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
    const form = classify(m.rest, owner, at, m.col)
    // Past a missed note a marker opens where an item or a description body owns it (§10 I2), or beside a missed list.
    // A missed quote keeps the line as the quote's lazy text.
    const missedNote = missed && frames.slice(reached + 1).some((f) => f.kind === 'note') &&
      !frames.slice(reached + 1).some((f) => f.kind === 'quote')
    if (missed && m.rest !== '' && top().para && !form.interrupts &&
        !(form.kind === 'item' && frames[reached + 1]?.kind === 'item' && frames[reached + 1]!.axes === form.axes) &&
        !(missedNote && form.kind === 'item' &&
          (owner.kind === 'item' || owner.kind === 'dd' || frames.slice(reached + 1).some((f) => f.kind === 'item')))) {
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
      if (!plusFollower) noteOpener(owner, form, owner.col)
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
        lead(m.col)
        frame.absorbs = absorbsColon(m.rest)
        frame.para = true
        if (CONT_MARKER.test(m.rest)) frame.plus = at
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
  }
  return { lines: result, cuts, refusedPlus, overindented }

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

  // The document column where `rest`, a suffix of `line`, starts.
  function docColumn(line: string, rest: string): number {
    let col = 0
    for (const ch of line.slice(0, line.length - rest.length)) col = ch === '\t' ? (Math.floor(col / 4) + 1) * 4 : col + 1
    return col
  }

  function absorbsColon(rest: string): boolean {
    const trimmed = rest.replace(/[ \t]+$/, '')
    return COLON_FENCE.test(trimmed) && !isColonFenceOpener(trimmed)
  }

  function classify(rest: string, owner: Frame, at: number, col: number): Form {
    rest = rest.replace(/[ \t]+$/, '')
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
        return { kind: 'fence', interrupts, lineBlock: true, closes: (r) => COLON_CLOSER.exec(r)?.[1]!.length === run }
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
      // A closer below the owner's column never matches (CARVE-P0-014).
      const reachable = closerAhead(run, at, owner.col, col)
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

  // Whether a closer for `run` lies after line `at`, written from column `lo` to `hi`. The walk asks
  // in line order, so each line leaves the index once: per character, a max segment tree over columns.
  function closerAhead(run: string, at: number, lo: number, hi: number): boolean {
    const all = closerRuns()
    const index = all.ahead ??= aheadIndex()
    const char = index[run[0] as '`' | '~']
    while (index.next <= at) {
      for (const [ch, column] of index.at[index.next] ?? []) {
        const tree = index[ch]
        const entry = tree.columns[column]!
        entry.from++
        let k = tree.size + column
        tree.max[k] = entry.suffix[entry.from] ?? 0
        for (k >>= 1; k > 0; k >>= 1) tree.max[k] = Math.max(tree.max[2 * k]!, tree.max[2 * k + 1]!)
      }
      index.next++
    }
    let widest = 0
    for (let l = char.size + lo, r = char.size + Math.min(hi, char.size - 1) + 1; l < r; l >>= 1, r >>= 1) {
      if (l & 1) widest = Math.max(widest, char.max[l++]!)
      if (r & 1) widest = Math.max(widest, char.max[--r]!)
    }
    return widest >= run.length
  }

  function aheadIndex(): AheadIndex {
    const found: Record<'`' | '~', [number, number][]> = { '`': [], '~': [] }
    const at: [('`' | '~'), number][][] = []
    for (let j = 0; j < lines.length; j++) {
      const m = quotedMeasure(lines[j]!)
      const c = PURE_FENCE.exec(m.rest)
      if (!c) continue
      const ch = c[1]![0] as '`' | '~'
      found[ch].push([m.col, c[1]!.length])
      ;(at[j] ??= []).push([ch, m.col])
    }
    const tree = (ch: '`' | '~'): AheadTree => {
      let size = 1
      for (const [column] of found[ch]) while (size <= column) size *= 2
      const columns: AheadColumn[] = []
      for (const [column, length] of found[ch]) (columns[column] ??= { lengths: [], suffix: [], from: 0 }).lengths.push(length)
      const max = new Array<number>(2 * size).fill(0)
      columns.forEach((entry, column) => {
        entry.suffix = new Array<number>(entry.lengths.length)
        for (let k = entry.lengths.length - 1; k >= 0; k--) entry.suffix[k] = Math.max(entry.lengths[k]!, entry.suffix[k + 1] ?? 0)
        max[size + column] = entry.suffix[0]!
      })
      for (let k = size - 1; k > 0; k--) max[k] = Math.max(max[2 * k]!, max[2 * k + 1]!)
      return { size, columns, max }
    }
    return { next: 0, at, '`': tree('`'), '~': tree('~') }
  }
}
