import { inlineAttrPayloadStarts, isValidAttrItem, isValidInlineAttrPayload } from '../../extension/attribute-parser.js'

type Mark = [line: number, column: number]
/** Whether inline pairing attaches an attribute written right after `prefix`. */
export type InlineHostProbe = (prefix: string) => boolean

const HOST_CLOSERS = '])`/*_~=}>:'
const NOTED_MARKS = '[<{}/*_~=:'
const NOTED = new Uint8Array(128)
for (const ch of NOTED_MARKS + ']') NOTED[ch.charCodeAt(0)] = 1

/**
 * The accepted inline attributes of one paragraph, line by line (PART 9 §9 R3). An accepted
 * payload is opaque to code and comment pairing, so a backtick or `{%` inside holds no later
 * brace line (carve#5740). Inline pairing itself decides whether a closer hosts the attribute.
 */
export class InlineAttributeHosts {
  private readonly history: string[] = []
  private readonly lastMarks = new Map<string, Mark>()
  // The marks this line replaced, as they stood when it began.
  private readonly replacedMarks = new Map<string, Mark | undefined>()
  private readonly bracketOpeners: Mark[] = []
  private lastBracketMatch: Mark | undefined
  private lastBracketClose: Mark | undefined
  private readonly probes = new Map<string, boolean>()
  // Openers on earlier lines that already hosted an attribute: inline pairing does not pair them again.
  private readonly usedOpeners = new Set<string>()
  private line = ''
  // Built on first use: most lines hold no `{` an attribute could open at.
  private bracketStartsOfLine: Int32Array | undefined
  private acceptedEnd = -1
  private endsOfLine: ((at: number) => number) | undefined

  constructor(private readonly probe: InlineHostProbe) {}

  /** Starts scanning the paragraph's next line. */
  beginLine(line: string): void {
    this.line = line
    this.acceptedEnd = -1
    this.replacedMarks.clear()
    this.bracketStartsOfLine = undefined
    this.endsOfLine = undefined
  }

  private get bracketStarts(): Int32Array {
    if (this.bracketStartsOfLine) return this.bracketStartsOfLine
    const line = this.line
    const starts = this.bracketStartsOfLine = new Int32Array(line.length).fill(-1)
    const open: number[] = []
    for (let k = 0; k < line.length; k++) {
      if (line[k] === '[') open.push(k)
      else if (line[k] === ']' && open.length > 0) starts[k] = open.pop()!
    }
    return starts
  }

  private ends(at: number): number {
    return (this.endsOfLine ??= payloadEnds(this.line))(at)
  }

  private markAt(ch: string, mark: Mark): void {
    if (!this.replacedMarks.has(ch)) this.replacedMarks.set(ch, this.lastMarks.get(ch))
    this.lastMarks.set(ch, mark)
  }

  endLine(): void {
    this.history.push(this.line)
  }

  /** The `}` closing an accepted inline attribute that opens at `at`, or -1. */
  acceptedAttributeEnd(at: number): number {
    if (this.line[at] !== '{') return -1
    if (this.acceptedEnd !== at && !HOST_CLOSERS.includes(this.line[at - 1] ?? '\n')) return -1
    const end = this.ends(at)
    if (end === -1 || (this.acceptedEnd !== at && !this.hosts(at))) return -1
    this.acceptedEnd = end + 1
    return end
  }

  /** Records the code span a backtick run at `at` opens. */
  noteCodeOpen(at: number): void {
    this.markAt('`', [this.history.length, at])
  }

  /** Records a character the scan read as text. */
  noteText(at: number): void {
    const code = this.line.charCodeAt(at)
    if (code >= 128 || NOTED[code] === 0) return
    const ch = this.line[at]!
    if (ch === '[') this.bracketOpeners.push([this.history.length, at])
    else if (ch === ']' && this.bracketOpeners.length > 0) {
      this.lastBracketMatch = this.bracketOpeners.pop()
      this.lastBracketClose = [this.history.length, at]
    }
    if (NOTED_MARKS.includes(ch)) this.markAt(ch, [this.history.length, at])
  }

  private hosts(at: number): boolean {
    const line = this.line
    const closer = line[at - 1]
    if (closer === undefined || !HOST_CLOSERS.includes(closer)) return false
    const start = this.hostStart(at)
    if (start >= 0 && this.probed(line.slice(start, at))) return true
    // The host may have opened on an earlier soft line: read from its latest opener there.
    const marker = closer === ')' || closer === ']' ? '[' : closer === '>' ? '<' : closer === '}' ? '{' : closer
    const bracketClose = closer === ']' ? at - 1 : closer === ')' ? line.lastIndexOf('](', at - 1) : -1
    const paired = bracketClose >= 0 && this.lastBracketClose?.[0] === this.history.length &&
      this.lastBracketClose[1] === bracketClose ? this.lastBracketMatch : undefined
    const prior = paired ?? (this.replacedMarks.has(marker) ? this.replacedMarks.get(marker) : this.lastMarks.get(marker))
    if (prior === undefined || prior[0] >= this.history.length) return false
    const key = `${prior[0]}:${prior[1]}`
    // A closed bracket pairs no later `]`.
    if (this.usedOpeners.has(key) || (paired === undefined && marker === '[' &&
      !this.bracketOpeners.some(([row, column]) => row === prior[0] && column === prior[1]))) return false
    const prefix = [this.history[prior[0]]!.slice(Math.max(0, prior[1] - 1)),
      ...this.history.slice(prior[0] + 1), line.slice(0, at)].join('\n')
    if (!this.probed(prefix)) return false
    this.usedOpeners.add(key)
    return true
  }

  /** Where the inline host closing right before `at` opens on this line, one character early. */
  private hostStart(at: number): number {
    const line = this.line
    const closer = line[at - 1]!
    let open = -1
    if (closer === ']') open = this.bracketStarts[at - 1]!
    else if (closer === ')') {
      const tail = line.lastIndexOf('](', at - 1)
      if (tail >= 0) open = this.bracketStarts[tail]!
    } else if (closer === '>') open = line.lastIndexOf('<', at - 2)
    else if (closer === '}') open = line.lastIndexOf('{', at - 2)
    else if (closer === '`') {
      open = line.lastIndexOf('`', at - 2)
      while (open > 0 && line[open - 1] === '`') open--
    } else open = line.lastIndexOf(closer, at - 2)
    return open < 0 ? -1 : Math.max(0, open - 1)
  }

  private probed(prefix: string): boolean {
    let paired = this.probes.get(prefix)
    if (paired === undefined) this.probes.set(prefix, paired = this.probe(prefix))
    return paired
  }
}

/**
 * Per line, the `}` closing a valid inline attribute payload that opens at a `{`, or -1.
 * Amortized linear over the line: scans are shared by every `{` they pass, and a quote-free
 * payload that a whole token or a stray character already rejects skips the regex.
 */
function payloadEnds(line: string): (at: number) => number {
  const lastBrace = line.lastIndexOf('}')
  const quotes = countsOf(line, '"\'')
  const neverUnquoted = countsOf(line, '|\\\t')
  const tails = new Map<number, { from: number, tokenEnd: number, invalidAt: number }>()
  // Whether a quote-free payload from `start` holds a whole token after a space that is no attribute item.
  const invalidTail = (start: number, end: number): boolean => {
    let tail = tails.get(end)
    if (tail === undefined) tails.set(end, tail = { from: end, tokenEnd: end, invalidAt: -1 })
    for (; tail.from > start; tail.from--) {
      const ch = line[tail.from - 1]
      if (ch !== ' ' && ch !== '\r') continue
      if (tail.from < tail.tokenEnd && tail.invalidAt === -1 && !isValidAttrItem(line.slice(tail.from, tail.tokenEnd)))
        tail.invalidAt = tail.from
      tail.tokenEnd = tail.from - 1
    }
    return tail.invalidAt > start
  }
  // Ends of payload scans, keyed by every `{` a scan passed outside quotes: a scan from there reaches the same `}`.
  const scanEnds = new Map<number, number>()
  const scan = (at: number): number => {
    const known = scanEnds.get(at)
    if (known !== undefined) return known
    const passed: number[] = []
    let quote: string | null = null
    let end = at + 1
    for (; end < line.length; end++) {
      const ch = line[end]!
      if (quote !== null) {
        if (ch === '\\') end++
        else if (ch === quote) quote = null
      } else if (ch === '"' || ch === "'") quote = ch
      else if (ch === '{') passed.push(end)
      else if (ch === '}') break
    }
    const result = end < line.length ? end : -1
    for (const k of passed) scanEnds.set(k, result)
    return result
  }
  return (at: number): number => {
    if (line[at] !== '{' || lastBrace < at) return -1
    const end = scan(at)
    if (end === -1) return -1
    if (quotes(at + 1, end) === 0 && (neverUnquoted(at + 1, end) > 0 || invalidTail(at + 1, end))) return -1
    if (!inlineAttrPayloadStarts(line, at)) return -1
    return isValidInlineAttrPayload(line.slice(at + 1, end)) ? end : -1
  }
}

/** Counts of `chars` in `line[from, to)`, from prefix sums built on first use. */
function countsOf(line: string, chars: string): (from: number, to: number) => number {
  let sums: Int32Array | undefined
  return (from, to) => {
    if (sums === undefined) {
      sums = new Int32Array(line.length + 1)
      for (let k = 0; k < line.length; k++) sums[k + 1] = sums[k]! + (chars.includes(line[k]!) ? 1 : 0)
    }
    return sums[to]! - sums[from]!
  }
}
