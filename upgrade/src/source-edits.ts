// The edits that turn the input of an upgrade into its output, for an editor that offers them one by one. They are
// read off the two texts, so every path of the upgrade (rules, mapped rows, rescues) gives them alike.
import { type ReportRecord } from './report.ts'

/** One edit: the UTF-8 byte range of the 0.1 source, its replacement, and the upgrade row that asked for it. */
export interface UpgradeEdit {
  range: { startOffset: number, endOffset: number }
  text: string
  entry: string
}

function splitLines(text: string): string[] {
  const lines = text.split(/(?<=\n)/)
  return lines.at(-1) === '' ? lines.slice(0, -1) : lines
}

/** Myers' shortest edit script over lines: the pairs of indexes that stay, in order. */
function commonLines(a: readonly string[], b: readonly string[]): [number, number][] {
  const max = a.length + b.length
  const offset = max + 1
  const v = new Int32Array(2 * max + 3)
  const trace: Int32Array[] = []
  for (let d = 0; d <= max; d++) {
    trace.push(v.slice())
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && v[offset + k - 1]! < v[offset + k + 1]!) ? v[offset + k + 1]! : v[offset + k - 1]! + 1
      let y = x - k
      while (x < a.length && y < b.length && a[x] === b[y]) { x++; y++ }
      v[offset + k] = x
      if (x >= a.length && y >= b.length) return backtrack(trace, a.length, b.length, offset, a, b)
    }
  }
  return []
}

function backtrack(trace: Int32Array[], n: number, m: number, offset: number, a: readonly string[], b: readonly string[]): [number, number][] {
  const kept: [number, number][] = []
  let x = n
  let y = m
  for (let d = trace.length - 1; d > 0; d--) {
    const v = trace[d]!
    const k = x - y
    const down = k === -d || (k !== d && v[offset + k - 1]! < v[offset + k + 1]!)
    const prevK = down ? k + 1 : k - 1
    const prevX = v[offset + prevK]!
    const prevY = prevX - prevK
    while (x > prevX && y > prevY) kept.push([--x, --y])
    x = prevX
    y = prevY
  }
  while (x > 0 && y > 0 && a[x - 1] === b[y - 1]) kept.push([--x, --y])
  return kept.reverse()
}

const encoder = new TextEncoder()
const bytes = (text: string): number => encoder.encode(text).length

/** The record a change of the input lines `first` to `last` (from 1) belongs to: one on those lines, else the one before. */
function entryFor(records: readonly ReportRecord[], first: number, last: number): string {
  const placed = records.filter((record) => record.line > 0 && !record.entry.startsWith('upgrade-'))
  const inside = placed.find((record) => record.line >= first && record.line <= last)
  if (inside !== undefined) return inside.entry
  const before = placed.filter((record) => record.line < first).at(-1)
  return before?.entry ?? placed[0]?.entry ?? 'upgrade'
}

/** The edits from `input` to `output`, in source order and not overlapping; applied together they give `output`. */
export function upgradeEdits(input: string, output: string, records: readonly ReportRecord[]): UpgradeEdit[] {
  if (input === output) return []
  const a = splitLines(input)
  const b = splitLines(output)
  const kept = [...commonLines(a, b), [a.length, b.length] as [number, number]]
  const edits: UpgradeEdit[] = []
  let x = 0
  let y = 0
  let offset = 0
  for (const [nextX, nextY] of kept) {
    if (nextX > x || nextY > y) {
      let removed = a.slice(x, nextX).join('')
      let added = b.slice(y, nextY).join('')
      // Narrow the change to the characters that differ.
      let head = 0
      while (head < removed.length && head < added.length && removed[head] === added[head]) head++
      let tail = 0
      while (tail < removed.length - head && tail < added.length - head
        && removed[removed.length - 1 - tail] === added[added.length - 1 - tail]) tail++
      const start = offset + bytes(removed.slice(0, head))
      const text = added.slice(head, added.length - tail)
      removed = removed.slice(head, removed.length - tail)
      added = text
      edits.push({ range: { startOffset: start, endOffset: start + bytes(removed) }, text: added,
        entry: entryFor(records, x + 1, Math.max(x + 1, nextX)) })
      for (let at = x; at < nextX; at++) offset += bytes(a[at]!)
    }
    if (nextX < a.length) offset += bytes(a[nextX]!)
    x = nextX + 1
    y = nextY + 1
  }
  return edits
}
