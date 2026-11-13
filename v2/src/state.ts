// The state of one block pass. Its arrays are kept across parses (the phase 0 spike measured
// that a fresh event array per parse more than doubles the time on small documents),
// so a parse takes its state from a pool and a parse started inside another one gets its own.
import { EVENT_WIDTH } from './events.ts'

/** C2-B-131: the deepest container stack. The document at index 0 is not counted. */
export const MAX_DEPTH = 200
export const NO_LEAF = -1
export const NO_LINE = -1

const INITIAL_EVENTS = 1024 * EVENT_WIDTH
const INITIAL_LINES = 256
const POOL_SIZE = 4

export interface BlockState {
  src: string

  events: Int32Array
  eventLength: number
  lineStarts: Int32Array
  lineCount: number

  // Container stack, outermost first. `stackColumn` is the marker column of an item
  // and `stackStyle` the enter flags of a list.
  stackKind: Uint8Array
  stackColumn: Int32Array
  stackStyle: Uint8Array
  stackLoose: Uint8Array
  depth: number

  // The open leaf: NO_LEAF, PARAGRAPH or CODE.
  leaf: number
  fenceChar: number
  fenceLength: number
  fenceColumn: number
  // First of the blank lines at the end of an open fence that no later line has claimed yet.
  pendingBlankLine: number

  // Blank lines since the last line that was not blank (C2-B-044, C2-B-052).
  blankCount: number
  // End of the last line that belongs to a block. Closing blocks end here.
  contentEnd: number

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
    fenceChar: 0,
    fenceLength: 0,
    fenceColumn: 0,
    pendingBlankLine: NO_LINE,
    blankCount: 0,
    contentEnd: 0,
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
