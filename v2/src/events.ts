// An event is three ints: [tag, a, b]. The tag holds the type in two bits, the kind in six and the flags above them.
//   ENTER: a = offset of the block, b = aux    SPAN: a = start, b = end    EXIT: a = end offset, b = 0
// The aux of an enter event is the heading level, the first number of an ordered list,
// the task state of an item (a character code, 0 for a plain item) or the run length of a fence.
export const ENTER = 0
export const SPAN = 1
export const EXIT = 2
export const EVENT_WIDTH = 3

const TYPE_BITS = 2
const TYPE_MASK = 3
const KIND_BITS = 6
const KIND_MASK = 63

export function eventTag(type: number, kind: number, flags: number): number {
  return type | (kind << TYPE_BITS) | (flags << (TYPE_BITS + KIND_BITS))
}

export function eventType(tag: number): number {
  return tag & TYPE_MASK
}

export function eventKind(tag: number): number {
  return (tag >> TYPE_BITS) & KIND_MASK
}

export function eventFlags(tag: number): number {
  return tag >> (TYPE_BITS + KIND_BITS)
}

/**
 * A reader of the first `length` ints of an event array, one event at a time. Readers outside this
 * module go through it and never index the array themselves.
 */
export class EventCursor {
  private readonly events: Int32Array
  private readonly length: number
  private at = 0

  constructor(events: Int32Array, length: number) {
    this.events = events
    this.length = length
  }

  /** Whether the cursor stands on an event. */
  more(): boolean {
    return this.at < this.length
  }

  /** Moves to the next event. */
  next(): void {
    this.at += EVENT_WIDTH
  }

  type(): number {
    return eventType(this.events[this.at]!)
  }

  kind(): number {
    return eventKind(this.events[this.at]!)
  }

  flags(): number {
    return eventFlags(this.events[this.at]!)
  }

  /** The offset of an enter event, or the start of a span. */
  start(): number {
    return this.events[this.at + 1]!
  }

  /** The end of a span, or the end offset of an exit event. */
  end(): number {
    const at = this.at
    return this.events[at + (eventType(this.events[at]!) === SPAN ? 2 : 1)]!
  }

  /** The aux of an enter event, or the facts of an exit event. */
  aux(): number {
    return this.events[this.at + 2]!
  }
}
