import { MAX_NESTING_DEPTH } from '../../parse.js'
import { extendsGrapheme } from '../../grapheme-extender.js'
import { emphasisNeedsBraces, hasInnerWordDelimiter, renderForcedEmphasis } from '../../render-carve.js'

interface Run {
  start: number
  end: number
  char: string
  scope: number
  open: boolean
  close: boolean
  left: number
  right: number
  active: boolean
  previous: number
  next: number
}
interface Pair { open: number; close: number; width: number; kind: '*' | '/' | '~' }

const protectedDepths = new WeakMap<readonly string[], Map<string, number>>()
export function recordMarkdownProtectedDepth(spans: readonly string[], token: string, depth: number): void {
  let depths = protectedDepths.get(spans)
  if (!depths) protectedDepths.set(spans, depths = new Map())
  depths.set(token, depth)
}

interface Frame { i: number; end: number; kind: string; pair?: Pair; parent: string; slot: number; first: string; last: string; strong: boolean; italic: boolean; strike: boolean; literalTilde: boolean; repeated: boolean; keep: boolean; peak: number; scopeLink: boolean }

/** What a closing span's brace decision reads besides the span itself. */
interface BraceContext {
  source: string
  protectedSpans: readonly string[]
  claimed: ReadonlySet<number>
  braceSlashBoundaries: boolean
  protectOutput: ((value: string) => string) | undefined
  leadingText: (body: string) => string
  neighbor: (index: number, left: boolean) => string
  tokenAt: (at: number) => RegExpExecArray | null
}

const punctuation = (s: string): boolean => /[!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~\p{P}\p{S}]/u.test(s)
const whitespace = (s: string): boolean => s === '' || /\s/u.test(s)

/**
 * The character beside `index` that flanking reads: the edge neighbors past the
 * ends, a protected span's outer character, or a whole surrogate pair.
 */
function delimiterNeighbor(source: string, protectedSpans: readonly string[], edgeNeighbors: { before: string; after: string } | undefined, index: number, left: boolean): string {
  if (index < 0 && edgeNeighbors) return edgeNeighbors.before
  if (index >= source.length && edgeNeighbors) return edgeNeighbors.after
  if (source[index] === '\x00') {
    const other = left ? source.lastIndexOf('\x00', index - 1) : source.indexOf('\x00', index + 1)
    const token = other < 0 ? '' : source.slice(Math.min(index, other), Math.max(index, other) + 1)
    const match = /^\x00P(\d+)\x00$/.exec(token)
    const value = match ? protectedSpans[Number(match[1])] : undefined
    if (value !== undefined) return left ? Array.from(value.slice(-2)).at(-1) ?? '' : Array.from(value.slice(0, 2))[0] ?? ''
  }
  const unit = source.charCodeAt(index)
  if (unit < 0xd800 || unit > 0xdfff) return source[index]!
  return left ? Array.from(source.slice(Math.max(0, index - 1), index + 1)).at(-1) ?? '' : Array.from(source.slice(index, index + 2))[0] ?? ''
}

/** The CommonMark delimiter runs of `source` with their flanking. */
function scanDelimiterRuns(source: string, strikethrough: boolean, extensionDelimiters: boolean, neighbor: (index: number, left: boolean) => string): Run[] {
  const runs: Run[] = []
  for (const m of source.matchAll(strikethrough ? /\*+|_+|~+/g : /\*+|_+/g)) {
    const start = m.index
    const end = start + m[0].length
    if (m[0][0] === '~' && m[0].length > 2) continue
    if (source[start - 1] === '\\') continue
    let beforeIndex = start - 1
    let afterIndex = end
    // cmark-gfm skips registered extension delimiters in emphasis flank scans.
    if (extensionDelimiters && m[0][0] !== '~') {
      while (source[beforeIndex] === '~') beforeIndex--
      while (source[afterIndex] === '~') afterIndex++
    }
    const before = neighbor(beforeIndex, true)
    const after = neighbor(afterIndex, false)
    const left = !whitespace(after) && (!punctuation(after) || whitespace(before) || punctuation(before))
    const right = !whitespace(before) && (!punctuation(before) || whitespace(after) || punctuation(after))
    runs.push({ start, end, scope: -1, char: m[0][0]!, open: left && (m[0][0] !== '_' || !right || punctuation(before)),
      close: right && (m[0][0] !== '_' || !left || punctuation(after)), left: 0, right: 0, active: true, previous: runs.length - 1, next: runs.length + 1 })
  }
  return runs
}

/** Scope each run to the innermost link label whose destination follows it. */
function scopeRunsToLinkLabels(source: string, runs: Run[], protectedSpans: readonly string[]): void {
  const brackets: number[] = []
  const boundaries = new Map<number, { scope: number; open: boolean }>()
  for (let i = 0; i < source.length; i++) {
    if (source[i] === '\\') { i++; continue }
    if (source[i] === '[') brackets.push(i)
    else if (source[i] === ']' && brackets.length) {
      const open = brackets.pop()!
      const target = source[i + 1] === '\x00' ? /^\x00P(\d+)\x00/.exec(source.slice(i + 1)) : null
      if (open + 1 < i && target && protectedSpans[Number(target[1])]?.startsWith('(')) {
        boundaries.set(open + 1, { scope: open, open: true })
        boundaries.set(i, { scope: open, open: false })
      }
    }
  }
  const scopes: number[] = []
  let cursor = 0
  for (const run of runs) {
    while (cursor <= run.start) {
      const boundary = boundaries.get(cursor++)
      if (boundary?.open) scopes.push(boundary.scope)
      else if (boundary) scopes.pop()
    }
    run.scope = scopes.at(-1) ?? -1
  }
}

/**
 * Keep pairs inside one block of a multi-line run. A blank line, a heading, a
 * thematic break and a fence end the paragraph; a quote or list item opened
 * mid-run keeps its lazy lines until the next block opens.
 */
function scopeRunsToBlocks(source: string, runs: Run[]): void {
  const lineStarts = [0]
  for (let at = source.indexOf('\n'); at >= 0; at = source.indexOf('\n', at + 1)) lineStarts.push(at + 1)
  const segments: number[] = []
  let segment = 0, quoted = false, single = false, fence = ''
  for (let line = 0; line < lineStarts.length; line++) {
    const text = source.slice(lineStarts[line], (lineStarts[line + 1] ?? source.length + 1) - 1)
    if (fence) {
      segments.push(segment)
      if (new RegExp(`^ {0,3}${fence[0] === '`' ? '`' : '~'}{${fence.length},}[ \\t]*$`).test(text)) { fence = ''; single = true }
      continue
    }
    const opensFence = /^ {0,3}(`{3,}(?!.*`)|~{3,})/.exec(text)
    const blank = /^[ \t]*$/.test(text)
    const singleLine = blank || /^ {0,3}#{1,6}(?:[ \t]|$)/.test(text) || /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/.test(text)
    const opensQuote = /^ {0,3}>/.test(text)
    const opensItem = /^ {0,3}(?:[-*+]|1[.)])[ \t]+\S/.test(text)
    if (line > 0 && (singleLine || single || opensFence || opensItem || opensQuote && !quoted)) segment++
    single = singleLine
    quoted = opensQuote || quoted && !singleLine && !opensItem
    if (opensFence) fence = opensFence[1]!
    segments.push(segment)
  }
  if (segment === 0) return
  const width = source.length + 2
  let line = 0
  for (const run of runs) {
    while (line + 1 < lineStarts.length && lineStarts[line + 1]! <= run.start) line++
    run.scope = run.scope + 1 + segments[line]! * width
  }
}

/** Pair the delimiter runs as CommonMark's process-emphasis procedure does. */
function pairDelimiterRuns(runs: Run[], onStep: (() => void) | undefined): { pairs: Map<number, Pair>; claimed: Set<number> } {
  const pairs = new Map<number, Pair>()
  const claimed = new Set<number>()
  const remaining = (r: Run): number => r.end - r.start - r.left - r.right
  const unlink = (index: number): void => {
    onStep?.()
    const run = runs[index]!
    if (run.previous >= 0) runs[run.previous]!.next = run.next
    if (run.next < runs.length) runs[run.next]!.previous = run.previous
    run.active = false
  }
  const bottoms = new Map<string, number>()
  for (let c = 0; c < runs.length; c++) {
    const closer = runs[c]!
    if (!closer.active || !closer.close) continue
    while (remaining(closer) > 0) {
      // Rules 9 and 10 and the openers-bottom key read the runs' original lengths.
      const key = `${closer.scope}:${closer.char}:${closer.open}:${(closer.end - closer.start) % 3}`
      const bottom = bottoms.get(key) ?? -1
      let o = closer.previous
      for (; o > bottom; o = runs[o]!.previous) {
        onStep?.()
        const opener = runs[o]!
        if (!opener.active || !opener.open || opener.char !== closer.char || remaining(opener) === 0) continue
        if (opener.scope !== closer.scope) continue
        const a = remaining(opener), b = remaining(closer)
        if (opener.char === '~' && a !== b) continue
        const oa = opener.end - opener.start, ob = closer.end - closer.start
        if (opener.char !== '~' && (opener.close || closer.open) && (oa + ob) % 3 === 0 && (oa % 3 !== 0 || ob % 3 !== 0)) continue
        break
      }
      if (o <= bottom) {
        bottoms.set(key, c - 1)
        break
      }
      const opener = runs[o]!
      const width = Math.min(remaining(opener), remaining(closer)) >= 2 ? 2 : 1
      const open = opener.end - opener.right - width
      const close = closer.start + closer.left
      pairs.set(open, { open, close, width, kind: opener.char === '~' ? '~' : width === 2 ? '*' : '/' })
      for (let k = 0; k < width; k++) { claimed.add(open + k); claimed.add(close + k) }
      opener.right += width
      closer.left += width
      let j = opener.next
      while (j !== c) {
        const next = runs[j]!.next
        unlink(j)
        j = next
      }
      if (remaining(opener) === 0) unlink(o)
      if (remaining(closer) === 0) unlink(c)
    }
  }
  return { pairs, claimed }
}

/** The unpaired delimiter characters that must be written escaped. */
function literalRunEscapes(source: string, runs: readonly Run[], claimed: ReadonlySet<number>, extensionDelimiters: boolean): Set<number> {
  const literalEscapes = new Set<number>()
  for (const run of runs) {
    const before = source[run.start - 1] ?? '', after = source[run.end] ?? ''
    const partiallyClaimed = claimed.has(run.start) || claimed.has(run.end - 1)
    if ((extensionDelimiters && run.char !== '~' && (before === '~' || after === '~')) || partiallyClaimed || (run.char === '_' && /[^\x00-\x7f]/u.test(before + after)) || /\u00a0/u.test(before + after)) {
      for (let i = run.start; i < run.end; i++) if (!claimed.has(i)) literalEscapes.add(i)
    }
  }
  return literalEscapes
}

/**
 * The unpaired `*` and `_` runs Carve would pair. Carve reads each character:
 * one opens before a non-space when no word character precedes its run, and
 * closes after a non-space when no word character follows it. A written
 * strong delimiter can partner a loose `*` either way. Partners are looked for
 * on the run's own line, so a thematic break line never pairs with another.
 */
function looseRunEscapes(source: string, runs: readonly Run[], claimed: ReadonlySet<number>, pairs: ReadonlyMap<number, Pair>, neighbor: (index: number, left: boolean) => string): Set<number> {
  const word = (s: string): boolean => /[\p{L}\p{N}]/u.test(s)
  const candidates: { run?: Run; char: string; at: number; open: boolean; close: boolean }[] = []
  for (const run of runs) {
    if (run.char === '~' || claimed.has(run.start) || claimed.has(run.end - 1)) continue
    const runBefore = neighbor(run.start - 1, true)
    for (let i = run.start; i < run.end; i++) {
      const before = i > run.start ? run.char : runBefore, after = i + 1 < run.end ? run.char : neighbor(run.end, false)
      const open = !whitespace(after) && !word(runBefore), close = !whitespace(before) && !word(after)
      if (open || close) candidates.push({ run, char: run.char, at: i, open, close })
    }
  }
  for (const pair of pairs.values()) {
    if (pair.kind === '*') candidates.push({ char: '*', at: pair.open, open: true, close: true }, { char: '*', at: pair.close, open: true, close: true })
  }
  // Per line and character: the last closer and first opener, each with the
  // runner-up from another run, so every candidate is checked in constant time.
  type Edge = { at: number; owner: unknown }
  const lineOf = (at: number): number => {
    let low = 0, high = newlines.length
    while (low < high) { const mid = (low + high) >>> 1; if (newlines[mid]! < at) low = mid + 1; else high = mid }
    return low
  }
  const newlines: number[] = []
  for (let at = source.indexOf('\n'); at >= 0; at = source.indexOf('\n', at + 1)) newlines.push(at)
  const closers = new Map<string, [Edge, Edge]>(), openers = new Map<string, [Edge, Edge]>()
  const none = (at: number): Edge => ({ at, owner: null })
  const keep = (map: Map<string, [Edge, Edge]>, key: string, edge: Edge, better: (a: number, b: number) => boolean, worst: number): void => {
    const [best, other] = map.get(key) ?? [none(worst), none(worst)]
    if (better(edge.at, best.at)) map.set(key, edge.owner === best.owner ? [edge, other] : [edge, best])
    else if (edge.owner !== best.owner && better(edge.at, other.at)) map.set(key, [best, edge])
    else map.set(key, [best, other])
  }
  const keyed = candidates.map((c, index) => ({ ...c, key: `${c.char}:${lineOf(c.at)}`, owner: c.run ?? index }))
  for (const c of keyed) {
    if (c.close) keep(closers, c.key, c, (a, b) => a > b, -1)
    if (c.open) keep(openers, c.key, c, (a, b) => a < b, Infinity)
  }
  const pick = (edges: [Edge, Edge] | undefined, owner: unknown): Edge | undefined => edges && (edges[0].owner === owner ? edges[1] : edges[0])
  const escapes = new Set<number>()
  for (const c of keyed) {
    if (!c.run) continue
    const closer = pick(closers.get(c.key), c.owner), opener = pick(openers.get(c.key), c.owner)
    const partner = c.open && closer !== undefined && closer.owner !== null && closer.at > c.at ||
      c.close && opener !== undefined && opener.owner !== null && opener.at < c.at
    if (partner) for (let i = c.run.start; i < c.run.end; i++) escapes.add(i)
  }
  return escapes
}

/** Only a singleton can open bare Carve strike; index possible closers once. */
function singletonTildeEscapes(source: string, claimed: ReadonlySet<number>): Set<number> {
  const tildeEscapes = new Set<number>()
  let closer = false
  for (let i = source.length - 1; i >= 0; i--) {
    const ch = source[i]!
    if (ch === '\n') { closer = false; continue }
    if (ch !== '~' || source[i - 1] === '\\') continue
    const before = source[i - 1] ?? '', after = source[i + 1] ?? ''
    if (!claimed.has(i) && before !== '~' && after !== '~' &&
        !/[A-Za-z0-9_]/.test(before) && after !== '' && !whitespace(after) && closer) tildeEscapes.add(i)
    if (before !== '' && !whitespace(before) && !/[A-Za-z0-9]/.test(after)) closer = true
  }
  return tildeEscapes
}

/** The matched brackets of `source`, from each end to the other. */
function matchedBrackets(source: string): { bracketEnds: Map<number, number>; bracketStarts: Map<number, number> } {
  const bracketEnds = new Map<number, number>()
  const bracketStarts = new Map<number, number>()
  const brackets: number[] = []
  for (let i = 0; i < source.length; i++) {
    if (source[i] === '\\') { i++; continue }
    if (source[i] === '[') brackets.push(i)
    else if (source[i] === ']' && brackets.length) {
      const start = brackets.pop()!
      bracketEnds.set(start, i)
      bracketStarts.set(i, start)
    }
  }
  return { bracketEnds, bracketStarts }
}

/** Whether a kept span, closing with `first`/`last` as its body's edges, is written braced. */
function closingSpanNeedsBraces(ctx: BraceContext, frame: Frame, pair: Pair, first: string, last: string): boolean {
  const { source, protectedSpans, claimed, braceSlashBoundaries, protectOutput, leadingText, neighbor, tokenAt } = ctx
  const { strong, italic, strike } = frame
  const intraword = /[\p{L}\p{N}]/u.test(neighbor(pair.open - 1, true)) || /[\p{L}\p{N}]/u.test(neighbor(pair.close + pair.width, false))
  const besideLiteral = (/[*_]/.test(source[pair.open - 1] ?? '') || pair.kind === '~' && source[pair.open - 1] === '~') && !claimed.has(pair.open - 1) && source[pair.open - 2] !== '\\'
  const besideSlash = braceSlashBoundaries && pair.kind === '/' && (neighbor(pair.open - 1, true) === '/' || source[pair.close + pair.width] === '/' || source.slice(pair.close + pair.width, pair.close + pair.width + 2) === '\\/')
  const beforeExtender = extendsGrapheme(leadingText(source.slice(pair.close + pair.width, pair.close + pair.width + 40)), 0)
  const bodyStart = pair.open + pair.width
  const afterSource = pair.close + pair.width
  const nextToken = tokenAt(afterSource)
  const nextValue = nextToken ? protectedSpans[Number(nextToken[1])] ?? '' : ''
  const nextSpelled = nextValue.startsWith('\\') ? nextValue[1] ?? '' : source[afterSource] === '\\' ? source[afterSource + 1] ?? '' : neighbor(afterSource, false)
  const beforeWindow = source.slice(Math.max(0, pair.open - 20), pair.open)
  const tokenClose = beforeWindow.lastIndexOf('\x00')
  const tokenOpen = beforeWindow.lastIndexOf('\x00', tokenClose - 1)
  const beforeAt = pair.open - beforeWindow.length + tokenOpen
  const beforeCandidate = tokenAt(beforeAt)
  const beforeToken = beforeCandidate && beforeAt + beforeCandidate[0].length === pair.open ? beforeCandidate : null
  const beforeValue = beforeToken ? protectedSpans[Number(beforeToken[1])] ?? '' : ''
  const beforeSpelled = frame.parent && claimed.has(pair.open - 1) ? frame.parent
    : beforeValue.startsWith('\\') ? beforeValue[1] ?? ''
      : source[pair.open - 2] === '\\' ? source[pair.open - 1] ?? '' : neighbor(pair.open - 1, true)
  const afterSpelled = frame.parent && claimed.has(afterSource) ? frame.parent : nextSpelled
  const bodyToken = tokenAt(bodyStart)
  const bodyValue = bodyToken && bodyStart + bodyToken[0].length === pair.close ? protectedSpans[Number(bodyToken[1])] ?? '' : ''
  // renderEmphasis braces a span when its rendered link label owns a delimiter.
  const scopedBoundary = frame.scopeLink || protectOutput !== undefined || beforeExtender
  // renderEmphasis braces adjacent or nested delimiters that could join.
  const delimiterCollision = besideSlash || frame.repeated ||
    frame.kind === '*' && strong || frame.kind === '/' && italic || frame.kind === '~' && strike ||
    frame.kind === '~' && frame.literalTilde
  // renderEmphasis braces delimiters beside word characters or literal openers.
  const wordBoundary = intraword || besideLiteral && (pair.kind === '*' || source[pair.open] === '_')
  // renderEmphasis braces content that starts with its delimiter or an italic strong opener.
  // A reference that decodes to a space or tab at the body's edge (later in the pass).
  const body = source.slice(bodyStart, pair.close)
  const trailingReference = /&(?:#[0-9]{1,7}|#[xX][0-9A-Fa-f]{1,6}|[A-Za-z][A-Za-z0-9]{1,31});$/.exec(body)
  const referenceSpace = body.startsWith('&') && /^[ \t\r\n]/.test(leadingText(body)) ||
    trailingReference !== null && /^[ \t\r\n]/.test(leadingText(trailingReference[0]))
  const bodyBoundary = referenceSpace || pair.kind === '/' && first === '*' || pair.kind === '*' &&
    (source[pair.close - 2] === '\\' && source[pair.close - 1] === '*' || bodyValue.endsWith('\\*'))
  return emphasisNeedsBraces(pair.kind, first + last, beforeSpelled, afterSpelled,
    scopedBoundary || delimiterCollision || wordBoundary || bodyBoundary ||
    hasInnerWordDelimiter(pair.kind, source.slice(bodyStart, pair.close)))
}

/** Pair CommonMark delimiter runs before writing native emphasis. */
export function markdownEmphasis(source: string, onFlatten: (reason?: 'extender') => void = () => {}, onStep?: () => void, protectedSpans: readonly string[] = [], plainText = false, strikethrough = false, hostDepth = 0, onDepth?: (depth: number) => void, braceSlashBoundaries = false, protectOutput?: (value: string) => string, edgeNeighbors?: { before: string; after: string }, extensionDelimiters = strikethrough, leadingText: (body: string) => string = body => body): string {
  const neighbor = (index: number, left: boolean): string => delimiterNeighbor(source, protectedSpans, edgeNeighbors, index, left)
  const runs = scanDelimiterRuns(source, strikethrough, extensionDelimiters, neighbor)
  if (strikethrough && source.includes('[')) scopeRunsToLinkLabels(source, runs, protectedSpans)
  if (source.includes('\n')) scopeRunsToBlocks(source, runs)
  const { pairs, claimed } = pairDelimiterRuns(runs, onStep)
  if (plainText) {
    let text = ''
    for (let i = 0; i < source.length; i++) if (!claimed.has(i)) text += source[i]
    return text
  }

  const literalEscapes = literalRunEscapes(source, runs, claimed, extensionDelimiters)
  const looseEscapes = looseRunEscapes(source, runs, claimed, pairs, neighbor)
  const tildeEscapes = strikethrough ? singletonTildeEscapes(source, claimed) : new Set<number>()
  const { bracketEnds, bracketStarts } = matchedBrackets(source)
  const output: string[] = []
  const stack: Frame[] = []
  const active = new Map<string, number>()
  let flattened = false
  const hostPeaks = protectedDepths.get(protectedSpans)
  const protectedToken = /\x00P(\d+)\x00/y
  const scopedLinkLabel = /\[(\x00P\d+\x00)\/([^\[\]\n]*)\/\](\x00P\d+\x00)/y
  const tokenAt = (at: number): RegExpExecArray | null => {
    if (source[at] !== '\x00') return null
    protectedToken.lastIndex = at
    return protectedToken.exec(source)
  }
  const braceContext: BraceContext = { source, protectedSpans, claimed, braceSlashBoundaries, protectOutput, leadingText, neighbor, tokenAt }
  let frame: Frame = { i: 0, end: source.length, kind: '', parent: '', slot: -1, first: '', last: '', strong: false, italic: false, strike: false, literalTilde: false, repeated: false, keep: true, peak: 0, scopeLink: false }
  const record = (first: string, last: string): void => {
    if (frame.first === '') frame.first = first
    if (last !== '') frame.last = last
  }
  while (true) {
    if (frame.i < frame.end) {
      const pair = pairs.get(frame.i)
      if (pair && pair.close < frame.end) {
        frame.i = pair.close + pair.width
        stack.push(frame)
        frame = { i: pair.open + pair.width, end: pair.close, kind: pair.kind, pair, parent: frame.kind,
          slot: output.length, first: '', last: '', strong: false, italic: false, strike: false, literalTilde: false, repeated: false, keep: true, peak: 0, scopeLink: false }
        frame.repeated = (active.get(pair.kind) ?? 0) > 0
        // `hostDepth` is the inline nesting this text already sits under - a
        // link label is converted on its own, so its own levels are not here.
        frame.keep = hostDepth + stack.length < MAX_NESTING_DEPTH
        active.set(pair.kind, (active.get(pair.kind) ?? 0) + 1)
        output.push('')
      } else {
        const ch = source[frame.i++]!
        const at = frame.i - 1
        if (ch === '[' && frame.kind === '/' && source[frame.i] === '\x00') {
          scopedLinkLabel.lastIndex = at
          const label = scopedLinkLabel.exec(source)
          if (label) {
            const written = `[${label[1]}${renderForcedEmphasis('/', label[2]!)}]${label[3]}`
            output.push(written)
            frame.scopeLink = true
            record('[', label[3]!.at(-1) ?? ']')
            frame.i = scopedLinkLabel.lastIndex
            continue
          }
        }
        if (ch === '\0' && hostPeaks) {
          protectedToken.lastIndex = at
          const token = protectedToken.exec(source)
          if (token) frame.peak = Math.max(frame.peak, hostPeaks.get(token[0]) ?? 0)
        }
        const crossesBracket = frame.pair !== undefined && (
          ch === '[' && (bracketEnds.get(at) ?? -1) >= frame.end
          || ch === ']' && (bracketStarts.get(at) ?? at) < frame.pair.open
        )
        if (ch === '~') frame.literalTilde = true
        const literalTilde = tildeEscapes.has(at)
        const literal = literalEscapes.has(at) || crossesBracket || literalTilde || looseEscapes.has(at) || ((active.get('~') ?? 0) > 0 && /[*_]/.test(ch) && !claimed.has(at)) ? `\\${ch}` : ch
        output.push(protectOutput !== undefined && /[*_~]/.test(ch) ? protectOutput(`\\${ch}`) : literal)
        record(ch, ch)
      }
      continue
    }
    if (!frame.pair) break
    const { pair } = frame
    let first = frame.first, last = frame.last
    let strong = frame.strong, italic = frame.italic, strike = frame.strike
    frame.keep &&= hostDepth + stack.length + frame.peak < MAX_NESTING_DEPTH
    // The opener would be part of a larger character (CARVE-P3-025).
    const extenderLeading = frame.keep && extendsGrapheme(leadingText(output.slice(frame.slot + 1).join('')), 0)
    if (extenderLeading) onFlatten('extender')
    else if (frame.keep) {
      const braced = closingSpanNeedsBraces(braceContext, frame, pair, first, last)
      strong ||= pair.kind === '*'
      italic ||= pair.kind === '/'
      strike ||= pair.kind === '~'
      // A literal `{` at the body's end would glue to the closer and read as a
      // braced opener of this kind, which nests since markup-carve/carve#2877.
      const tail = output.length - 1
      if (tail > frame.slot && output[tail] === '{') output[tail] = '\\{'
      const opener = braced ? `{${pair.kind}` : pair.kind
      const closer = braced ? `${pair.kind}}` : pair.kind
      output[frame.slot] = protectOutput?.(opener) ?? opener
      output.push(protectOutput?.(closer) ?? closer)
      first = braced ? '{' : pair.kind
      last = braced ? '}' : pair.kind
    } else flattened = true
    active.set(pair.kind, active.get(pair.kind)! - 1)
    const peak = frame.peak + (frame.keep ? 1 : 0)
    const literalTilde = frame.literalTilde
    frame = stack.pop()!
    frame.literalTilde ||= literalTilde
    frame.peak = Math.max(frame.peak, peak)
    frame.strong ||= strong
    frame.italic ||= italic
    frame.strike ||= strike
    record(first, last)
  }
  if (flattened) onFlatten()
  onDepth?.(frame.peak)
  return output.join('')
}
