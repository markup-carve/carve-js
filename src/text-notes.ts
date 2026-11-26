// C2-I-089: the notes that would close only because a caret pair inside them opens. Each is text, and inside the span
// it closed over when every caret pair was read, a caret pair is an ordinary bracket; behind that span reading goes on
// as usual.

export class TextNotes {
  private readonly spans = new Map<number, number>()
  private starts: number[] = []
  /** Per entry of `starts`, the furthest end of the spans up to it. */
  private reach: number[] = []

  get size(): number {
    return this.spans.size
  }

  /** Whether the `^[` at `start` opens a note that is text. */
  has(start: number): boolean {
    return this.spans.has(start)
  }

  /** Adds the note at `start` whose `]` stood at `end` in the pass it closed in. */
  add(start: number, end: number): void {
    this.spans.set(start, end)
    this.reach = []
  }

  /** Whether `pos` stands inside the span of a note that is text. */
  covers(pos: number): boolean {
    // The notes are added between passes, so the index is built once per pass that reads it.
    if (this.reach.length !== this.spans.size) {
      this.starts = [...this.spans.keys()].sort((a, b) => a - b)
      let furthest = -1
      this.reach = this.starts.map((at) => (furthest = Math.max(furthest, this.spans.get(at)!)))
    }
    let low = 0
    let high = this.starts.length
    while (low < high) {
      const middle = (low + high) >> 1
      if (this.starts[middle]! < pos) low = middle + 1
      else high = middle
    }
    return low > 0 && this.reach[low - 1]! > pos
  }
}
