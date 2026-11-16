// The state of one inline pass over one content. Like the block state it is reused: its arrays
// are kept across contents, and a pass started inside another one takes its own state from the pool.
import { EVENT_WIDTH } from './events.ts'
import { NO_CHARACTER } from './unicode.ts'

// A token is seven ints: kind, start, end and four fields whose meaning depends on the kind.
// Offsets count in the content. The text between two tokens is plain text.
export const TOKEN_WIDTH = 7
export const TOKEN_START = 1
export const TOKEN_END = 2
export const TOKEN_A = 3
export const TOKEN_B = 4
export const TOKEN_C = 5
export const TOKEN_D = 6

// Token kinds below the inline kinds. An atom has the kind of its node, its payload in A and B,
// its enter flags in C and its aux in D.
/** A token that turned out to be text: a failed opener, a closer with no partner. */
export const TOKEN_TEXT = 0
/** A bracket opener. A: its form. B: the token of its closer, or NONE. C: the kind of its node, or 0. */
export const TOKEN_OPEN = 1
/** A closing bracket. A: the token of its opener. */
export const TOKEN_CLOSE = 2
/** A link tail. A, B: the destination. C: the start of the quoted title, or NONE. */
export const TOKEN_TAIL = 3
/** A bare delimiter. A: its mark. B: the token of its partner, or NONE. C: what it can do. */
export const TOKEN_DELIMITER = 4
export const TOKEN_BRACED_OPEN = 5
/** A mark before a closing brace. C: what the mark can do as a bare delimiter (C2-I-057). */
export const TOKEN_BRACED_CLOSE = 6
/** Text that is printed as written (C2-I-035). */
export const TOKEN_LITERAL = 7

export const NONE = -1

// Forms of a bracket opener.
export const OPEN_PLAIN = 0
export const OPEN_IMAGE = 1
export const OPEN_FOOTNOTE = 2
export const OPEN_EXTENSION = 3

// What a bare delimiter can do (C2-I-047, C2-I-048), and whether it stands between two word characters (C2-I-053).
export const CAN_OPEN = 1
export const CAN_CLOSE = 2
export const BETWEEN_WORDS = 4

const INITIAL_TOKENS = 256 * TOKEN_WIDTH
const INITIAL_EVENTS = 512 * EVENT_WIDTH
const INITIAL_STACK = 256
const INITIAL_LINES = 16
const INITIAL_TEXT = 1024
const POOL_SIZE = 4

export interface InlineState {
  src: string
  /** The content: its lines joined by one line feed (C2-I-003), without trailing spaces and tabs. */
  text: string
  end: number
  // Per line of the content: its offset in the content and in the source.
  lineText: Int32Array
  lineSource: Int32Array
  lineCount: number
  /** C2-B-144: a line block reads `%%` as text. */
  lineComments: boolean
  cell: boolean
  /** C2-I-015: backtick runs indexed by length for repeated cell scans. */
  codeRuns: Map<number, number[]> | null
  codeRunCursors: Map<number, number>
  /** End of the last backtick run tried inside a cell (C2-I-015). */
  codeRunEnd: number
  /** C2-H-172: whether the text the scan has read so far holds a bidirectional control. */
  bidi: boolean
  /** Definition keys from the completed block pass, including definitions after this content. */
  definitions: ReadonlySet<string> | null

  tokens: Int32Array
  tokenLength: number
  /** End of the last token, so that a break or a comment takes only spaces that are still text. */
  tokenEnd: number
  events: Int32Array
  eventLength: number

  // Open bracket openers, as token offsets.
  brackets: Int32Array
  bracketDepth: number

  // Memos that let an opener fail in bounded work. Each holds the offset up to which a search
  // has already found nothing, or NONE. The three closer memos hold the offset from which on no
  // closer follows, or NONE: an opener before it has not failed (C2-I-025, C2-I-060, C2-I-076).
  commentCloserMissingFrom: number
  editorialCloserMissingFrom: number
  labelCloserMissingFrom: number
  xrefFailEnd: number
  doubleQuoteFailEnd: number
  singleQuoteFailEnd: number
  valueFailEnd: number
  // The destination run that was scanned last: its range, the parenthesis depth before each of
  // its characters and the lowest depth from each character on.
  tailStart: number
  tailEnd: number
  tailTitleFailed: boolean
  tailDepth: Int32Array
  tailLowest: Int32Array
  // Results of the last link tail and attribute block that were read.
  tailDestinationEnd: number
  tailTitleStart: number

  // The delimiter stack (C2-I-008). An entry is a token, its class, the entry of its class below
  // it, and the offsets of the last slash and star between two word characters when it was pushed.
  stackToken: Int32Array
  stackClass: Int8Array
  stackBelow: Int32Array
  stackSlash: Int32Array
  stackStar: Int32Array
  stackLength: number
  stackLive: number
  classTop: Int32Array
  stackFloor: number
  lastSlash: number
  lastStar: number

  // The shadow of the delimiter stack the scan keeps to count open entries (inline-depth.ts, C2-I-118).
  depthClass: Int8Array
  depthToken: Int32Array
  depthSlash: Int32Array
  depthStar: Int32Array
  depthLength: number
  depthLive: number
  depthFloor: number
  depthLastSlash: number
  depthLastStar: number

  // Emission: the line of the source cursor, the last search for a line break and its answer,
  // and the typography state.
  line: number
  breakFrom: number
  nextBreak: number
  previous: number
  singleQuoteOpen: boolean
  // The state of single quotes around each open inline footnote (C2-I-109).
  footnoteQuotes: Uint8Array
  footnoteDepth: number
  /** The token behind the text stretch being written (C2-I-117). */
  nextToken: number
  /** Start of the text that is not written yet, and the kind of the last smart node. */
  textRun: number
  smartKind: number
}

function createState(): InlineState {
  return {
    src: '',
    text: '',
    end: 0,
    lineText: new Int32Array(INITIAL_LINES),
    lineSource: new Int32Array(INITIAL_LINES),
    lineCount: 0,
    lineComments: true,
    cell: false,
    codeRuns: null,
    codeRunCursors: new Map(),
    codeRunEnd: 0,
    bidi: false,
    definitions: null,
    tokens: new Int32Array(INITIAL_TOKENS),
    tokenLength: 0,
    tokenEnd: 0,
    events: new Int32Array(INITIAL_EVENTS),
    eventLength: 0,
    brackets: new Int32Array(INITIAL_STACK),
    bracketDepth: 0,
    commentCloserMissingFrom: NONE,
    editorialCloserMissingFrom: NONE,
    labelCloserMissingFrom: NONE,
    xrefFailEnd: NONE,
    doubleQuoteFailEnd: NONE,
    singleQuoteFailEnd: NONE,
    valueFailEnd: NONE,
    tailStart: NONE,
    tailEnd: NONE,
    tailTitleFailed: false,
    tailDepth: new Int32Array(INITIAL_TEXT),
    tailLowest: new Int32Array(INITIAL_TEXT),
    tailDestinationEnd: 0,
    tailTitleStart: NONE,
    stackToken: new Int32Array(INITIAL_STACK),
    stackClass: new Int8Array(INITIAL_STACK),
    stackBelow: new Int32Array(INITIAL_STACK),
    stackSlash: new Int32Array(INITIAL_STACK),
    stackStar: new Int32Array(INITIAL_STACK),
    stackLength: 0,
    stackLive: 0,
    classTop: new Int32Array(16),
    stackFloor: NONE,
    lastSlash: NONE,
    lastStar: NONE,
    depthClass: new Int8Array(INITIAL_STACK),
    depthToken: new Int32Array(INITIAL_STACK),
    depthSlash: new Int32Array(INITIAL_STACK),
    depthStar: new Int32Array(INITIAL_STACK),
    depthLength: 0,
    depthLive: 0,
    depthFloor: NONE,
    depthLastSlash: NONE,
    depthLastStar: NONE,
    line: 0,
    breakFrom: 0,
    nextBreak: NONE,
    previous: NO_CHARACTER,
    singleQuoteOpen: false,
    footnoteQuotes: new Uint8Array(256),
    footnoteDepth: 0,
    nextToken: 0,
    textRun: 0,
    smartKind: 0,
  }
}

const pool: InlineState[] = []

export function acquireInlineState(): InlineState {
  return pool.pop() ?? createState()
}

/** Gives a state back. Its events must not be read after this. */
export function releaseInlineState(state: InlineState): void {
  state.src = ''
  state.text = ''
  state.definitions = null
  if (state.codeRuns !== null) {
    state.codeRuns = null
    state.codeRunCursors.clear()
  }
  if (pool.length < POOL_SIZE) pool.push(state)
}

function grown(array: Int32Array): Int32Array {
  const larger = new Int32Array(array.length * 2)
  larger.set(array)
  return larger
}

/** Appends a token and returns its offset in the token array. */
export function pushToken(
  state: InlineState, kind: number, start: number, end: number, a: number, b: number, c: number, d: number,
): number {
  const at = state.tokenLength
  if (at + TOKEN_WIDTH > state.tokens.length) state.tokens = grown(state.tokens)
  const tokens = state.tokens
  tokens[at] = kind
  tokens[at + TOKEN_START] = start
  tokens[at + TOKEN_END] = end
  tokens[at + TOKEN_A] = a
  tokens[at + TOKEN_B] = b
  tokens[at + TOKEN_C] = c
  tokens[at + TOKEN_D] = d
  state.tokenLength = at + TOKEN_WIDTH
  state.tokenEnd = end
  return at
}

export function writeInlineEvent(state: InlineState, tag: number, a: number, b: number): void {
  const at = state.eventLength
  if (at + EVENT_WIDTH > state.events.length) state.events = grown(state.events)
  const events = state.events
  events[at] = tag
  events[at + 1] = a
  events[at + 2] = b
  state.eventLength = at + EVENT_WIDTH
}

const LINE_FEED = 10
const SPACE = 32
const TAB = 9
const BACKSLASH = 92

/**
 * C2-I-002: the end of the line `[start, end)` without its spaces and tabs at the end, on every line of
 * the content. A space that a backslash escapes stays (C2-I-011): an odd number of backslashes stands before it.
 */
function lineEnd(src: string, start: number, end: number): number {
  let trimmed = end
  while (trimmed > start && (src.charCodeAt(trimmed - 1) === SPACE || src.charCodeAt(trimmed - 1) === TAB)) trimmed--
  if (trimmed === end || src.charCodeAt(trimmed) !== SPACE) return trimmed
  let first = trimmed
  while (first > start && src.charCodeAt(first - 1) === BACKSLASH) first--
  return (trimmed - first) % 2 === 1 ? trimmed + 1 : trimmed
}

/** The lines `spans[from..to)` of the source, each without its trailing spaces, with one line feed between two. */
function joinLines(src: string, spans: ArrayLike<number>, from: number, to: number): string {
  if (from >= to) return ''
  let text = src.slice(spans[from], lineEnd(src, spans[from]!, spans[from + 1]!))
  for (let at = from + 2; at < to; at += 2) text += `\n${src.slice(spans[at], lineEnd(src, spans[at]!, spans[at + 1]!))}`
  return text
}

/** True when a memo of a missing closer covers an opener whose search starts at `pos`. */
export function closerMissing(from: number, pos: number): boolean {
  return from !== NONE && pos >= from
}

/** Sets the content of a pass: the source spans `spans[from..to)`, as start and end pairs. */
export function setContent(state: InlineState, src: string, spans: ArrayLike<number>, from: number, to: number): void {
  const lines = (to - from) >> 1
  if (lines > state.lineText.length) {
    state.lineText = new Int32Array(lines * 2)
    state.lineSource = new Int32Array(lines * 2)
  }
  // Lines that follow each other in the source, with one line feed between two, are one piece of it: no copy is made.
  let joined = true
  let length = 0
  for (let at = from, line = 0; at < to; at += 2, line++) {
    const end = lineEnd(src, spans[at]!, spans[at + 1]!)
    if (line > 0) length++
    // A line that loses spaces before a line feed makes the content a copy.
    joined &&= at + 2 >= to ? true : end === spans[at + 1] && spans[at + 2] === end + 1 && src.charCodeAt(end) === LINE_FEED
    state.lineText[line] = length
    state.lineSource[line] = spans[at]!
    length += end - spans[at]!
  }
  state.src = src
  state.text = joined && to > from ? src.slice(spans[from], lineEnd(src, spans[to - 2]!, spans[to - 1]!)) : joinLines(src, spans, from, to)
  state.lineCount = lines
  if (length + 2 > state.tailDepth.length) {
    state.tailDepth = new Int32Array(length * 2 + 2)
    state.tailLowest = new Int32Array(length * 2 + 2)
  }
}
