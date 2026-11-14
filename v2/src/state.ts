// The state of one block pass. Its arrays are kept across parses (the phase 0 spike measured
// that a fresh event array per parse more than doubles the time on small documents),
// so a parse takes its state from a pool and a parse started inside another one gets its own.
import { EVENT_WIDTH } from './events.ts'

/** C2-B-190: the deepest container stack. The document at index 0 is not counted. */
export const MAX_DEPTH = 200
export const NO_LEAF = -1
export const NO_LINE = -1
export const NO_DEPTH = -1

const INITIAL_EVENTS = 1024 * EVENT_WIDTH
const INITIAL_LINES = 256
const POOL_SIZE = 4

/** C2-B-001: the container stack, outermost first, with the document at index 0. */
export interface Containers {
  // `column` is the marker column of an item, a description or a footnote body, the column of a
  // description list and the run length of a div. `style` holds the enter flags that are the kind of a list or of a div.
  kind: Uint8Array
  column: Int32Array
  style: Uint8Array
  loose: Uint8Array
  depth: number
}

/** The open leaf: NO_LEAF, a text leaf, an opaque leaf or TABLE, whose rows are read like a leaf's lines. */
export interface OpenLeaf {
  kind: number
  // The first line of the open text leaf and the number of its lines (C2-B-017, C2-B-157).
  start: number
  end: number
  lines: number
  /** Column of the marker of the open heading (C2-B-154). */
  column: number
  // Closer character, opener run length and opener column of the open opaque leaf.
  fenceChar: number
  fenceLength: number
  fenceColumn: number
  // The open table: its rows so far, its head rows, whether the head is still open, and `footer-rows`.
  tableRows: number
  tableHeadRows: number
  tableHeadOpen: boolean
  tableFooterRows: number
}

/**
 * C2-B-001: the facts kept about the lines directly above. Whether the line is line 1 of the
 * document (C2-B-161) is not kept: the loop of the pass knows it.
 */
export interface LinesAbove {
  /** C2-B-052, C2-B-062: blank lines since the last line that was not blank. */
  blankCount: number
  /** C2-B-146: stack depth at which the block that closed directly above takes a caption, or NO_DEPTH. */
  captionDepth: number
  /** C2-B-090, C2-B-092: stack depth at which attribute lines are pending, or NO_DEPTH. */
  attributesDepth: number
  /** Source range of the pending attribute lines, for the keys the block pass reads (C2-B-180, C2-B-187). */
  attributesStart: number
  attributesEnd: number
  /** C2-B-091: the next enter event of the line takes the pending attribute lines. */
  takeAttributes: boolean
  /** C2-B-113: first of the blank lines at the end of an open opaque body that no later line has claimed yet. */
  heldBlankLine: number
}

/**
 * The cursor in the current line. `column` counts from the start of the line (C2-B-005);
 * `origin` is the column after the innermost matched quote mark and `prefixEnd` its offset (C2-B-003).
 */
export interface LineCursor {
  pos: number
  column: number
  origin: number
  prefixEnd: number
}

export interface BlockState {
  src: string

  // The output: events and the line-start table, which the tree builder reads.
  events: Int32Array
  eventLength: number
  lineStarts: Int32Array
  lineCount: number
  // End of the last line that belongs to a block. Closing blocks end here.
  contentEnd: number

  containers: Containers
  leaf: OpenLeaf
  above: LinesAbove
  cursor: LineCursor
}

function createState(): BlockState {
  return {
    src: '',
    events: new Int32Array(INITIAL_EVENTS),
    eventLength: 0,
    lineStarts: new Int32Array(INITIAL_LINES),
    lineCount: 0,
    contentEnd: 0,
    containers: {
      kind: new Uint8Array(MAX_DEPTH + 1),
      column: new Int32Array(MAX_DEPTH + 1),
      style: new Uint8Array(MAX_DEPTH + 1),
      loose: new Uint8Array(MAX_DEPTH + 1),
      depth: 0,
    },
    leaf: {
      kind: NO_LEAF, start: 0, end: 0, lines: 0, column: 0, fenceChar: 0, fenceLength: 0, fenceColumn: 0, tableRows: 0,
      tableHeadRows: 0, tableHeadOpen: false, tableFooterRows: 0,
    },
    above: {
      blankCount: 0, captionDepth: NO_DEPTH, attributesDepth: NO_DEPTH, attributesStart: 0, attributesEnd: 0, takeAttributes: false,
      heldBlankLine: NO_LINE,
    },
    cursor: { pos: 0, column: 0, origin: 0, prefixEnd: 0 },
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
