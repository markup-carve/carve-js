// C2-I-089 with C2-I-118: the swallowed notes of the outermost demoting note, each read as it would read on its own,
// opening where the demoting note opened. The cap leaves that reading more room than the swallowed one, so a closer
// that pops a swallowed `[` may not pop it there. Each note keeps the count of brackets above its `[`; counts that meet
// the cap merge, so the groups stay sorted (lowest at the front) and share one shift: amortized O(1) per bracket.
import { DEPTH_CAP } from './inline-tables.ts'

export class OwnReads {
  on = false
  /** Open entries below the demoting note. */
  base = 0
  private shift = 0
  // The groups as a deque: the front is the last index, the back is `bottom`. Each holds `count - shift` and its
  // first and last member; members are linked in `next`.
  private level: number[] = []
  private first: number[] = []
  private last: number[] = []
  private bottom = 0
  private starts: number[] = []
  private next: number[] = []

  start(base: number): void {
    this.on = true
    this.base = base
    this.drop()
  }

  stop(): void {
    this.on = false
    this.drop()
  }

  drop(): void {
    if (this.starts.length === 0 && this.shift === 0) return
    this.level.length = 0
    this.first.length = 0
    this.last.length = 0
    this.bottom = 0
    this.shift = 0
    this.starts.length = 0
    this.next.length = 0
  }

  get empty(): boolean {
    return this.level.length === this.bottom
  }

  /** The most brackets above a note's `[` before an opener is text. */
  ceiling(): number {
    return Math.max(0, DEPTH_CAP - this.base - 1)
  }

  /** A swallowed note whose `[` opens at `start`, with nothing above it. */
  add(start: number): void {
    const id = this.starts.length
    this.starts.push(start)
    this.next.push(-1)
    const front = this.level.length - 1
    if (!this.empty && this.level[front]! + this.shift === 0) {
      this.next[this.last[front]!] = id
      this.last[front] = id
      return
    }
    this.level.push(-this.shift)
    this.first.push(id)
    this.last.push(id)
  }

  open(): void {
    this.shift++
    if (this.empty) return
    const top = this.ceiling() - this.shift
    const back = this.bottom
    if (this.level[back]! <= top) return
    this.level[back] = top
    if (back + 1 < this.level.length && this.level[back + 1] === top) {
      this.next[this.last[back + 1]!] = this.first[back]!
      this.last[back + 1] = this.last[back]!
      this.bottom++
    }
  }

  close(): void {
    const front = this.level.length - 1
    if (!this.empty && this.level[front]! + this.shift === 0) {
      this.level.pop()
      this.first.pop()
      this.last.pop()
      if (this.empty) {
        this.level.length = 0
        this.first.length = 0
        this.last.length = 0
        this.bottom = 0
      }
    }
    this.shift--
  }

  /** Adds the `[` of every note no closer popped. */
  unclosed(out: Set<number>): void {
    for (let group = this.bottom; group < this.level.length; group++) {
      for (let id = this.first[group]!; id !== -1; id = this.next[id]!) out.add(this.starts[id]!)
    }
  }
}
