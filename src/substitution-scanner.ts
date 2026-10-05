import { backtickRunEnds } from './backtick-run-index.js'

/** Find arrows under the substitution scanner's escape and comment rules. */
export class SubstitutionScanner {
  private first: { from: number; to: number; arrow: number } | undefined
  private points: number[] | undefined
  private paths: ForwardPaths[] = []
  private nextEvents: Int32Array | undefined
  private comments: Int32Array | undefined
  private kinds: Int32Array | undefined

  private readonly lastArrow: number

  constructor(private readonly text: string) {
    this.lastArrow = text.lastIndexOf('~>')
  }

  findArrow(from: number, to: number): number {
    if (this.lastArrow < from) return -1
    if (this.first === undefined) {
      const arrow = this.scan(from, to)
      this.first = { from, to, arrow }
      return arrow
    }
    if (from === this.first.from && to === this.first.to) return this.first.arrow
    if (this.points === undefined) this.build()
    const points = this.points!
    let at = this.nextEvents![from]!
    let mask = 0
    while (points[at]! < to) {
      at = this.paths[mask]!.lastBefore(points, at, to)
      const pos = points[at]!
      if (this.text[pos] === '~') return pos
      const kind = this.kinds![at]!
      if ((mask & kind) === 0 && this.comments![at]! >= to) {
        mask |= kind
        at = this.nextEvents![pos + 1]!
      } else return -1
    }
    return -1
  }

  private scan(from: number, to: number): number {
    const text = this.text
    const lastPercent = text.lastIndexOf('%}')
    const lastEditorial = text.lastIndexOf('#}')
    let disabled = 0
    for (let at = from; at < to; at++) {
      if (text[at] === '\\') at++
      else if (text[at] === '`') {
        let width = 1
        while (text[at + width] === '`') width++
        let end = at + width
        let closed = false
        while (end < text.length) {
          if (text[end] !== '`') { end++; continue }
          let run = 1
          while (text[end + run] === '`') run++
          end += run
          if (run === width) { closed = true; break }
        }
        if (!closed) return -1
        at = end - 1
      } else if (text[at] === '{' && (text[at + 1] === '%' || text[at + 1] === '#')) {
        const marker = text[at + 1]!
        const kind = marker === '%' ? 1 : 2
        if ((disabled & kind) !== 0) continue
        const last = marker === '%' ? lastPercent : lastEditorial
        const close = last < at + 2 ? -1 : text.indexOf(`${marker}}`, at + 2)
        if (close !== -1 && close < to) at = close + 1
        else if (close >= to) disabled |= kind
      } else if (text[at] === '~' && text[at + 1] === '>') return at
    }
    return -1
  }

  private build(): void {
    const text = this.text
    const n = text.length
    const points: number[] = []
    const codeEnds = backtickRunEnds(text)
    for (let at = 0; at < n; at++) {
      if ((text[at] === '~' && text[at + 1] === '>') ||
          (text[at] === '{' && (text[at + 1] === '#' || text[at + 1] === '%'))) points.push(at)
    }
    points.push(n)
    const nextEvents = new Int32Array(n + 2).fill(points.length - 1)
    let event = points.length - 2
    for (let at = n - 1; at >= 0; at--) {
      if (points[event] === at) nextEvents[at] = event--
      else if (text[at] === '\\') nextEvents[at] = nextEvents[at + 2]!
      else if (text[at] === '`') nextEvents[at] = codeEnds![at]! === -1 ? points.length - 1 : nextEvents[codeEnds![at]!]!
      else nextEvents[at] = nextEvents[at + 1]!
    }
    const comments = new Int32Array(points.length).fill(-1)
    const kinds = new Int32Array(points.length)
    let percent = -1
    let editorial = -1
    let nextPercent = -1
    let nextEditorial = -1
    event = points.length - 2
    for (let at = n - 1; at >= 0; at--) {
      if (text[at] === '%' && text[at + 1] === '}') { nextPercent = percent; percent = at }
      if (text[at] === '#' && text[at + 1] === '}') { nextEditorial = editorial; editorial = at }
      if (points[event] === at) {
        if (text[at] === '{') {
          const isPercent = text[at + 1] === '%'
          comments[event] = isPercent ? (percent >= at + 2 ? percent : nextPercent) : (editorial >= at + 2 ? editorial : nextEditorial)
          kinds[event] = isPercent ? 1 : 2
        }
        event--
      }
    }
    for (let mask = 0; mask < 4; mask++) {
      const next = new Int32Array(points.length)
      for (let i = 0; i < points.length; i++) {
        const at = points[i]!
        if (text[at] === '~' || at === n) next[i] = i
        else if ((mask & kinds[i]!) === 0 && comments[i]! !== -1) next[i] = nextEvents[comments[i]! + 2]!
        else next[i] = nextEvents[at + 1]!
      }
      this.paths.push(new ForwardPaths(next))
    }
    this.nextEvents = nextEvents
    this.points = points
    this.comments = comments
    this.kinds = kinds
  }
}

/** Heavy paths answer forward range queries with linear storage. */
class ForwardPaths {
  private heads: Int32Array
  private starts: Int32Array
  private lengths: Int32Array
  private order: Int32Array

  constructor(private readonly parents: Int32Array) {
    const n = parents.length
    const sizes = new Int32Array(n).fill(1)
    const heavy = new Int32Array(n).fill(-1)
    for (let at = 0; at < n; at++) {
      const parent = parents[at]!
      if (parent === at) continue
      sizes[parent] = sizes[parent]! + sizes[at]!
      if (heavy[parent] === -1 || sizes[heavy[parent]!]! < sizes[at]!) heavy[parent] = at
    }
    this.heads = new Int32Array(n)
    this.lengths = new Int32Array(n)
    for (let at = n - 1; at >= 0; at--) {
      const parent = parents[at]!
      const head = parent !== at && heavy[parent] === at ? this.heads[parent]! : at
      this.heads[at] = head
      this.lengths[head] = this.lengths[head]! + 1
    }
    this.starts = new Int32Array(n)
    let cursor = 0
    for (let at = 0; at < n; at++) {
      this.starts[at] = cursor
      cursor += this.lengths[at]!
    }
    const cursors = this.starts.slice()
    this.order = new Int32Array(n)
    for (let at = 0; at < n; at++) {
      const head = this.heads[at]!
      this.order[cursors[head]!] = at
      cursors[head] = cursors[head]! + 1
    }
  }

  lastBefore(points: number[], at: number, to: number): number {
    for (;;) {
      const head = this.heads[at]!
      if (points[head]! >= to) {
        let low = this.starts[head]!
        let high = low + this.lengths[head]!
        while (low < high) {
          const mid = (low + high) >>> 1
          if (points[this.order[mid]!]! < to) low = mid + 1
          else high = mid
        }
        return this.order[low - 1]!
      }
      const parent = this.parents[head]!
      if (parent === head || points[parent]! >= to) return head
      at = parent
    }
  }
}
