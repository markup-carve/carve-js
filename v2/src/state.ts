// The state of one block pass. Its arrays are kept across parses (the phase 0 spike measured
// that a fresh event array per parse more than doubles the time on small documents),
// so a parse takes its state from a pool and a parse started inside another one gets its own.
import { EVENT_WIDTH } from './events.ts'

/** C2-B-131: the deepest container stack. The document at index 0 is not counted. */
export const MAX_DEPTH = 200
export const NO_LEAF = -1
export const NO_LINE = -1
export const NO_DEPTH = -1

const INITIAL_EVENTS = 1024 * EVENT_WIDTH
const INITIAL_LINES = 256
const POOL_SIZE = 4

export interface BlockState {
  src: string

  events: Int32Array
  eventLength: number
  lineStarts: Int32Array
  lineCount: number

  // Container stack, outermost first. `stackColumn` is the marker column of an item, a description
  // or a footnote body, the column of a description list and the run length of a div.
  // `stackStyle` holds the enter flags that are the kind of a list or of a div.
  stackKind: Uint8Array
  stackColumn: Int32Array
  stackStyle: Uint8Array
  stackLoose: Uint8Array
  depth: number

  // The open leaf: NO_LEAF, a text leaf or an opaque leaf.
  leaf: number
  // The first line of the open text leaf and the number of its lines (C2-B-016, C2-B-109).
  leafStart: number
  leafEnd: number
  leafLines: number
  // Closer character, opener run length and opener column of the open opaque leaf.
  fenceChar: number
  fenceLength: number
  fenceColumn: number
  // First of the blank lines at the end of an open opaque leaf that no later line has claimed yet.
  pendingBlankLine: number

  // Blank lines since the last line that was not blank (C2-B-044, C2-B-052).
  blankCount: number
  // End of the last line that belongs to a block. Closing blocks end here.
  contentEnd: number
  // Stack depth at which the block directly above takes a caption, or NO_DEPTH (C2-B-101).
  captionDepth: number
  // Stack depth at which attribute lines are pending, or NO_DEPTH (C2-B-070).
  attributesDepth: number
  // The next enter event takes the pending attribute lines.
  takeAttributes: boolean

  // Cursor in the current line. `column` counts from the start of the line (C2-B-005);
  // `origin` is the column after the innermost matched quote mark and `prefixEnd` its offset (C2-B-003).
  pos: number
  column: number
  origin: number
  prefixEnd: number
}

function createState(): BlockState {
  return {
    src: '',
    events: new Int32Array(INITIAL_EVENTS),
    eventLength: 0,
    lineStarts: new Int32Array(INITIAL_LINES),
    lineCount: 0,
    stackKind: new Uint8Array(MAX_DEPTH + 1),
    stackColumn: new Int32Array(MAX_DEPTH + 1),
    stackStyle: new Uint8Array(MAX_DEPTH + 1),
    stackLoose: new Uint8Array(MAX_DEPTH + 1),
    depth: 0,
    leaf: NO_LEAF,
    leafStart: 0,
    leafEnd: 0,
    leafLines: 0,
    fenceChar: 0,
    fenceLength: 0,
    fenceColumn: 0,
    pendingBlankLine: NO_LINE,
    blankCount: 0,
    contentEnd: 0,
    captionDepth: NO_DEPTH,
    attributesDepth: NO_DEPTH,
    takeAttributes: false,
    pos: 0,
    column: 0,
    origin: 0,
    prefixEnd: 0,
  }
}

const pool: BlockState[] = []

export function acquireState(): BlockState {
  return pool.pop() ?? createState()
}

/** Gives a state back. Its events and line table must not be read after this. */
export function releaseState(state: BlockState): void {
  state.src = ''
  if (pool.length < POOL_SIZE) pool.push(state)
}

export function writeEvent(state: BlockState, tag: number, a: number, b: number): void {
  const at = state.eventLength
  if (at === state.events.length) {
    const grown = new Int32Array(at * 2)
    grown.set(state.events)
    state.events = grown
  }
  const events = state.events
  events[at] = tag
  events[at + 1] = a
  events[at + 2] = b
  state.eventLength = at + EVENT_WIDTH
}

export function addLine(state: BlockState, start: number): void {
  const at = state.lineCount
  if (at === state.lineStarts.length) {
    const grown = new Int32Array(at * 2)
    grown.set(state.lineStarts)
    state.lineStarts = grown
  }
  state.lineStarts[at] = start
  state.lineCount = at + 1
}
