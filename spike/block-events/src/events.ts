import type { BlockSink } from './kinds.ts'
import { TreeBuilder, type BlockNode } from './tree.ts'

// An event is three ints: [tag, a, b]. The tag holds the kind above a 2-bit type.
//   ENTER: a = offset, b = aux      EXIT: a = offset, b = 0      SPAN: a = start, b = end
export const ENTER = 0
export const EXIT = 1
export const SPAN = 2
export const EVENT_WIDTH = 3
const TYPE_BITS = 2
const TYPE_MASK = (1 << TYPE_BITS) - 1
const MIN_CAPACITY = 64 * EVENT_WIDTH

/** Flat event stream in one Int32Array that doubles when full. */
export class EventSink implements BlockSink {
  data: Int32Array
  length = 0

  /** The first capacity is one event per 16 source characters, which realistic documents stay under. */
  constructor(sourceLength: number) {
    this.data = new Int32Array(Math.max(MIN_CAPACITY, (sourceLength >> 4) * EVENT_WIDTH))
  }

  /** Empties the stream and keeps the array, for the next parse. */
  reset(): void {
    this.length = 0
  }

  enter(kind: number, pos: number, aux: number): void {
    this.write((kind << TYPE_BITS) | ENTER, pos, aux)
  }

  span(start: number, end: number): void {
    this.write(SPAN, start, end)
  }

  exit(kind: number, pos: number): void {
    this.write((kind << TYPE_BITS) | EXIT, pos, 0)
  }

  private write(tag: number, a: number, b: number): void {
    const at = this.length
    if (at === this.data.length) this.grow()
    const data = this.data
    data[at] = tag
    data[at + 1] = a
    data[at + 2] = b
    this.length = at + EVENT_WIDTH
  }

  private grow(): void {
    const grown = new Int32Array(this.data.length * 2)
    grown.set(this.data)
    this.data = grown
  }
}

export function buildTreeFromEvents(events: EventSink): BlockNode {
  const builder = new TreeBuilder()
  const data = events.data
  const length = events.length
  for (let at = 0; at < length; at += EVENT_WIDTH) {
    const tag = data[at]!
    switch (tag & TYPE_MASK) {
      case ENTER:
        builder.enter(tag >> TYPE_BITS, data[at + 1]!, data[at + 2]!)
        break
      case SPAN:
        builder.span(data[at + 1]!, data[at + 2]!)
        break
      default:
        builder.exit(tag >> TYPE_BITS, data[at + 1]!)
    }
  }
  return builder.root!
}
