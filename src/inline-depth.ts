// C2-I-118: the count of entries open on the bracket stack and the delimiter stack when an opener
// is read. The scan keeps it with a shadow of the delimiter stack that pairs as the pairing pass
// will, an open bracket standing as the bound of a construct until its closing bracket settles it.
// The pairing pass stays the authority on what pairs; this shadow only decides which openers are pushed.
import {
  BETWEEN_WORDS, CAN_CLOSE, CAN_OPEN, type InlineState, NONE, TOKEN_A, TOKEN_C, TOKEN_END, TOKEN_START, TOKEN_TEXT,
} from './inline-state.ts'
import { BARE_MARKS, BRACED_MARKS, DEPTH_CAP } from './inline-tables.ts'

const SLASH_MARK = BRACED_MARKS.indexOf(BARE_MARKS[0]!)
// Classes of a shadow entry: the braced marks, the two bare delimiters, an open bracket, an entry that left.
const BARE_CLASS = BRACED_MARKS.length
const FLOOR = BARE_CLASS + BARE_MARKS.length
const DEAD = FLOOR + 1

/** Whether an opener read now is text: 200 entries are open. */
export function atDepthCap(state: InlineState): boolean {
  return state.bracketDepth + state.depthLive >= DEPTH_CAP
}

function grow(state: InlineState): void {
  const size = state.depthClass.length * 2
  const classes = new Int8Array(size)
  classes.set(state.depthClass)
  state.depthClass = classes
  for (const key of ['depthToken', 'depthSlash', 'depthStar'] as const) {
    const larger = new Int32Array(size)
    larger.set(state[key])
    state[key] = larger
  }
}

function push(state: InlineState, entryClass: number, token: number): void {
  const at = state.depthLength
  if (at === state.depthClass.length) grow(state)
  state.depthClass[at] = entryClass
  state.depthToken[at] = token
  state.depthSlash[at] = state.depthLastSlash
  state.depthStar[at] = state.depthLastStar
  state.depthLength = at + 1
}

function trim(state: InlineState): void {
  while (state.depthLength > 0 && state.depthClass[state.depthLength - 1] === DEAD) state.depthLength--
}

/** The nearest open entry of `entryClass` above the innermost open bracket, or NONE. */
function find(state: InlineState, entryClass: number): number {
  for (let at = state.depthLength - 1; at > state.depthFloor; at--) if (state.depthClass[at] === entryClass) return at
  return NONE
}

/** C2-I-051: the entry `at` closes and every entry above it is removed. */
function closeWithAbove(state: InlineState, at: number): void {
  for (let entry = at; entry < state.depthLength; entry++) if (state.depthClass[entry]! < FLOOR) state.depthLive--
  state.depthLength = at
  trim(state)
}

/** The entry `at` leaves alone; the entries above it stay (C2-I-053, C2-I-061). */
function leave(state: InlineState, at: number): void {
  state.depthClass[at] = DEAD
  state.depthLive--
  trim(state)
}

export function enterBracket(state: InlineState): void {
  push(state, FLOOR, state.depthFloor)
  state.depthFloor = state.depthLength - 1
  state.depthLastSlash = NONE
  state.depthLastStar = NONE
}

/** C2-I-006, C2-I-007: a construct removes the entries inside it; a pair that forms none bounds nothing. */
export function leaveBracket(state: InlineState, formed: boolean): void {
  const at = state.depthFloor
  if (at === NONE) return
  state.depthFloor = state.depthToken[at]!
  state.depthLastSlash = state.depthSlash[at]!
  state.depthLastStar = state.depthStar[at]!
  if (formed) {
    closeWithAbove(state, at)
    return
  }
  state.depthClass[at] = DEAD
  trim(state)
}

/** A bare delimiter `token` (C2-I-051, C2-I-053). At the cap one that would open is text. */
export function countBare(state: InlineState, token: number): void {
  const tokens = state.tokens
  const flags = tokens[token + TOKEN_C]!
  const slash = tokens[token + TOKEN_A] === SLASH_MARK
  if ((flags & BETWEEN_WORDS) !== 0) {
    if (slash) state.depthLastSlash = token
    else state.depthLastStar = token
    return
  }
  const entryClass = slash ? BARE_CLASS : BARE_CLASS + 1
  const at = (flags & CAN_CLOSE) !== 0 ? find(state, entryClass) : NONE
  if (at !== NONE) closeBare(state, at, slash ? state.depthLastSlash : state.depthLastStar)
  else if ((flags & CAN_OPEN) !== 0) openBare(state, token, entryClass)
}

function closeBare(state: InlineState, at: number, lastBetweenWords: number): void {
  if (lastBetweenWords < state.depthToken[at]!) closeWithAbove(state, at)
  else leave(state, at)
}

function openBare(state: InlineState, token: number, entryClass: number): void {
  const tokens = state.tokens
  const flags = tokens[token + TOKEN_C]!
  if (atDepthCap(state)) {
    tokens[token + TOKEN_C] = flags & ~CAN_OPEN
    if ((flags & CAN_CLOSE) === 0) tokens[token] = TOKEN_TEXT
    return
  }
  push(state, entryClass, token)
  state.depthLive++
}

/** C2-I-024: the token of the innermost braced opener open above the innermost open bracket, or NONE. */
export function innermostBracedOpener(state: InlineState): number {
  for (let at = state.depthLength - 1; at > state.depthFloor; at--) if (state.depthClass[at]! < BARE_CLASS) return state.depthToken[at]!
  return NONE
}

export function countBracedOpen(state: InlineState, token: number): void {
  push(state, state.tokens[token + TOKEN_A]!, token)
  state.depthLive++
}

/** C2-I-057, C2-I-061: a braced closer `token`. With no opener of its mark it is read as a bare delimiter. */
export function countBracedClose(state: InlineState, token: number): void {
  const tokens = state.tokens
  const at = find(state, tokens[token + TOKEN_A]!)
  if (at === NONE) {
    if (tokens[token + TOKEN_C] !== 0) countBare(state, token)
    return
  }
  state.depthLastSlash = state.depthSlash[at]!
  state.depthLastStar = state.depthStar[at]!
  if (tokens[state.depthToken[at]! + TOKEN_END] === tokens[token + TOKEN_START]) leave(state, at)
  else closeWithAbove(state, at)
}
