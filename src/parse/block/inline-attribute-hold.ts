import { isValidAttrItem, isValidInlineAttrPayload } from '../../extension/attribute-parser.js'

const SPAN_DELIMITERS = '*/_~='
const BRACED_SPAN_MARKS = '+-/*_^,=~'
const isWordChar = (ch: string | undefined): boolean => ch !== undefined && /[\w-]/.test(ch)

/**
 * Finds accepted inline attributes in one paragraph line (PART 9 §9 R3). Their payload is
 * opaque to code and comment pairing, so a backtick or `{%` inside holds no later brace
 * line (carve#5740). Every lookup is amortized linear over the line.
 */
export function inlineAttributeEnds(line: string): (at: number) => number {
  const firstIndex = new Map<string, number>()
  const first = (needle: string): number => {
    let index = firstIndex.get(needle)
    if (index === undefined) firstIndex.set(needle, index = line.indexOf(needle))
    return index
  }
  let firstBracedOpen: number | undefined
  const firstBracedSpanOpen = (): number => {
    if (firstBracedOpen === undefined) {
      firstBracedOpen = -1
      for (let k = line.indexOf('{'); k !== -1; k = line.indexOf('{', k + 1)) {
        if (BRACED_SPAN_MARKS.includes(line[k + 1] ?? '\n')) { firstBracedOpen = k; break }
      }
    }
    return firstBracedOpen
  }
  const lastBrace = line.lastIndexOf('}')
  // Skipping a payload without these characters pairs exactly as scanning it does, so it needs no validation.
  const pairingMarks = countsOf(line, '`%[]\\')
  const quotes = countsOf(line, '"\'')
  const neverUnquoted = countsOf(line, '|\\\t')
  // Per closing brace, the leftward token walk so far and the rightmost invalid whole token it found.
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
  const rejects = (start: number, end: number): boolean =>
    pairingMarks(start, end) === 0 ||
    (quotes(start, end) === 0 && (neverUnquoted(start, end) > 0 || invalidTail(start, end)))
  // Ends of payload scans, keyed by every `{` a scan passed outside quotes: a scan from there reaches the same `}`.
  const scanEnds = new Map<number, number>()

  const endsInHost = (at: number): boolean => {
    const last = line[at - 1]
    if (last === undefined) return false
    const found = (k: number): boolean => k !== -1 && k < at - 1
    switch (last) {
      case ']': return found(first('['))
      case '`': return true
      case ')': return closesBefore(at - 2, ')', k => line[k] === '(' && line[k - 1] === ']')
      case '>': return closesBefore(at - 2, '>', k => line[k] === '<')
      case ':': {
        let k = at - 2
        while (isWordChar(line[k])) k--
        return k < at - 2 && line[k] === ':'
      }
      case '}': {
        const open = firstBracedSpanOpen()
        const tilde = first('~>')
        return BRACED_SPAN_MARKS.includes(line[at - 2] ?? '\n') && open !== -1 && open <= at - 4 &&
          (tilde === -1 || tilde > at - 2)
      }
      default: return SPAN_DELIMITERS.includes(last) && found(first(last))
    }
  }
  // Whether some k below `from`, before any `stop`, satisfies `hit`.
  const closesBefore = (from: number, stop: string, hit: (k: number) => boolean): boolean => {
    for (let k = from; k >= 0 && line[k] !== stop; k--) if (hit(k)) return true
    return false
  }

  const payloadEnd = (at: number): number => {
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
    if (line[at] !== '{' || lastBrace < at || !endsInHost(at)) return -1
    const end = payloadEnd(at)
    return end !== -1 && !rejects(at + 1, end) && isValidInlineAttrPayload(line.slice(at + 1, end)) ? end : -1
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
