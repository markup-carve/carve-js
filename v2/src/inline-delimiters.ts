// Bare and braced delimiters. The scan pushes a token for each mark that may open or close; the
// pairing pass then runs the one delimiter stack (C2-I-008) over the tokens, after the brackets
// are settled (C2-I-007).
import { BRACE_CLOSE } from './chars.ts'
import { characterAfter, characterBefore } from './inline-atoms.ts'
import { IMAGE, LABEL } from './inline-kinds.ts'
import {
  BETWEEN_WORDS, CAN_CLOSE, CAN_OPEN, type InlineState, NONE, pushToken, TOKEN_A, TOKEN_B, TOKEN_BRACED_CLOSE,
  TOKEN_BRACED_OPEN, TOKEN_C, TOKEN_CLOSE, TOKEN_DELIMITER, TOKEN_END, TOKEN_LITERAL, TOKEN_OPEN, TOKEN_START,
  TOKEN_TAIL, TOKEN_TEXT, TOKEN_WIDTH,
} from './inline-state.ts'
import { BARE_MARKS, BRACED_MARKS, DEPTH_CAP } from './inline-tables.ts'
import { codePointAt, isBoundarySpace, isJoining, isWordCharacter } from './unicode.ts'

const SLASH_MARK = BRACED_MARKS.indexOf(BARE_MARKS[0]!)
// Classes of a stack entry: the nine braced marks, then the two bare delimiters, a bracket
// construct, which bounds the delimiters inside it, and an entry that left the stack (C2-I-053).
const BARE_CLASS = BRACED_MARKS.length
const BARRIER = BARE_CLASS + BARE_MARKS.length
const DEAD = BARRIER + 1

function markIndex(text: string, pos: number): number {
  return BRACED_MARKS.indexOf(text[pos]!)
}

/** C2-I-047, C2-I-048: what the single bare delimiter at `pos` can do. */
function flanking(state: InlineState, pos: number): number {
  const before = characterBefore(state, pos)
  const after = characterAfter(state, pos + 1)
  const wordBefore = isWordCharacter(before)
  const wordAfter = isWordCharacter(after)
  let flags = wordBefore && wordAfter ? BETWEEN_WORDS : 0
  if (!wordBefore && !isBoundarySpace(after)) flags |= CAN_OPEN
  if (!isBoundarySpace(before) && !wordAfter) flags |= CAN_CLOSE
  return flags
}

/** A slash or a star (C2-I-046). A mark before `}` may be a braced closer (C2-I-057). */
export function scanBareMark(state: InlineState, pos: number): number {
  const text = state.text
  const code = text.charCodeAt(pos)
  let last = pos
  while (last + 1 < state.end && text.charCodeAt(last + 1) === code) last++
  const closer = last + 1 < state.end && text.charCodeAt(last + 1) === BRACE_CLOSE
  const mark = markIndex(text, pos)
  if (last > pos) {
    // C2-I-049: each character of a run is text. The last one may still close a braced span.
    if (closer) pushToken(state, TOKEN_BRACED_CLOSE, last, last + 2, mark, NONE, 0, NONE)
    return closer ? last + 2 : last + 1
  }
  // C2-I-050: a delimiter before a combining mark is text.
  if (isJoining(codePointAt(text, pos + 1, state.end))) return pos + 1
  const flags = flanking(state, pos)
  if (closer) pushToken(state, TOKEN_BRACED_CLOSE, pos, pos + 2, mark, NONE, flags, NONE)
  else if (flags !== 0) pushToken(state, TOKEN_DELIMITER, pos, pos + 1, mark, NONE, flags, NONE)
  return closer ? pos + 2 : pos + 1
}

/** A mark that is no bare delimiter: before `}` it may be a braced closer, and otherwise it is text. */
export function scanBracedMark(state: InlineState, pos: number): number {
  if (pos + 1 >= state.end || state.text.charCodeAt(pos + 1) !== BRACE_CLOSE) return pos + 1
  pushToken(state, TOKEN_BRACED_CLOSE, pos, pos + 2, markIndex(state.text, pos), NONE, 0, NONE)
  return pos + 2
}

function growStack(state: InlineState): void {
  const size = state.stackToken.length * 2
  const grow = (array: Int32Array): Int32Array => {
    const larger = new Int32Array(size)
    larger.set(array)
    return larger
  }
  const classes = new Int8Array(size)
  classes.set(state.stackClass)
  state.stackClass = classes
  state.stackToken = grow(state.stackToken)
  state.stackBelow = grow(state.stackBelow)
  state.stackSlash = grow(state.stackSlash)
  state.stackStar = grow(state.stackStar)
}

/** Pushes an entry. `below` is the entry of its class below it, or for a bracket construct the floor it replaces. */
function push(state: InlineState, token: number, entryClass: number, below: number): number {
  const at = state.stackLength
  if (at === state.stackToken.length) growStack(state)
  state.stackToken[at] = token
  state.stackClass[at] = entryClass
  state.stackBelow[at] = below
  state.stackSlash[at] = state.lastSlash
  state.stackStar[at] = state.lastStar
  state.stackLength = at + 1
  state.stackLive++
  return at
}

function pushDelimiter(state: InlineState, token: number, entryClass: number): void {
  state.classTop[entryClass] = push(state, token, entryClass, state.classTop[entryClass]!)
}

/** Takes the entry `at` from its class and from the count of open entries. */
function unlink(state: InlineState, at: number): void {
  state.classTop[state.stackClass[at]!] = state.stackBelow[at]!
  state.stackLive--
}

/** Removes every entry above `at`. C2-I-051: their delimiters are text. */
function removeAbove(state: InlineState, at: number): void {
  for (let entry = state.stackLength - 1; entry > at; entry--) {
    if (state.stackClass[entry] === DEAD) continue
    unlink(state, entry)
    state.tokens[state.stackToken[entry]!] = TOKEN_TEXT
  }
  state.stackLength = at + 1
}

/** Removes the top entry, and the entries below it that left the stack earlier. */
function pop(state: InlineState): void {
  state.stackLength--
  while (state.stackLength > 0 && state.stackClass[state.stackLength - 1] === DEAD) state.stackLength--
}

function depth(state: InlineState): number {
  return state.baseDepth + state.stackLive
}

/** Closes the entry `at` with the closer `token`: the pair forms a node. */
function closeEntry(state: InlineState, at: number, token: number): void {
  const tokens = state.tokens
  const opener = state.stackToken[at]!
  removeAbove(state, at)
  unlink(state, at)
  pop(state)
  tokens[opener + TOKEN_B] = token
  tokens[token + TOKEN_B] = opener
}

/** C2-I-051: a bare delimiter closes the nearest open entry of its kind, or opens, or is text. */
function bareDelimiter(state: InlineState, token: number): void {
  const tokens = state.tokens
  const flags = tokens[token + TOKEN_C]!
  const slash = tokens[token + TOKEN_A] === SLASH_MARK
  const entryClass = slash ? BARE_CLASS : BARE_CLASS + 1
  const top = state.classTop[entryClass]!
  if ((flags & BETWEEN_WORDS) !== 0) {
    if (slash) state.lastSlash = token
    else state.lastStar = token
  } else if ((flags & CAN_CLOSE) !== 0 && top > state.stackFloor) {
    closeBare(state, top, token, slash ? state.lastSlash : state.lastStar)
    return
  } else if ((flags & CAN_OPEN) !== 0 && depth(state) < DEPTH_CAP) {
    pushDelimiter(state, token, entryClass)
    return
  }
  tokens[token] = TOKEN_TEXT
}

function closeBare(state: InlineState, at: number, token: number, lastBetweenWords: number): void {
  const tokens = state.tokens
  const opener = state.stackToken[at]!
  if (lastBetweenWords < opener) {
    closeEntry(state, at, token)
    return
  }
  // C2-I-053: the span holds its own delimiter between two word characters. Its entry leaves
  // the stack, every other entry stays, and both delimiters are text.
  unlink(state, at)
  state.stackClass[at] = DEAD
  if (at === state.stackLength - 1) pop(state)
  tokens[opener] = TOKEN_TEXT
  tokens[token] = TOKEN_TEXT
}

/** C2-I-057, C2-I-058: a mark before `}` closes the nearest open braced opener of its mark. */
function bracedCloser(state: InlineState, token: number): void {
  const tokens = state.tokens
  const mark = tokens[token + TOKEN_A]!
  const top = state.classTop[mark]!
  if (top <= state.stackFloor) {
    // No braced opener is open: the brace is text and the mark is read by the bare rules.
    if (tokens[token + TOKEN_C] === 0) {
      tokens[token] = TOKEN_TEXT
      return
    }
    tokens[token] = TOKEN_DELIMITER
    tokens[token + TOKEN_END]!--
    bareDelimiter(state, token)
    return
  }
  const opener = state.stackToken[top]!
  // The inside of a braced span does not count for a bare span around it (C2-I-053).
  state.lastSlash = state.stackSlash[top]!
  state.lastStar = state.stackStar[top]!
  if (tokens[opener + TOKEN_END] !== tokens[token + TOKEN_START]) {
    closeEntry(state, top, token)
    return
  }
  // C2-I-061: an opener glued to its own closer forms nothing.
  unlink(state, top)
  pop(state)
  tokens[opener] = TOKEN_TEXT
  tokens[token] = TOKEN_TEXT
}

/** C2-I-118: a construct past the cap is text, with its brackets and what is glued to them. */
function demote(state: InlineState, open: number): void {
  const tokens = state.tokens
  const close = tokens[open + TOKEN_B]!
  tokens[open] = TOKEN_TEXT
  tokens[close] = TOKEN_TEXT
  const part = close + TOKEN_WIDTH
  if (part < state.tokenLength && (tokens[part] === TOKEN_TAIL || tokens[part] === LABEL)) tokens[part] = TOKEN_LITERAL
}

/** C2-I-007: a bracket construct bounds the delimiters inside it. */
function enterConstruct(state: InlineState, open: number): void {
  if (state.tokens[open + TOKEN_C] === IMAGE) return
  if (depth(state) >= DEPTH_CAP) {
    demote(state, open)
    return
  }
  state.stackFloor = push(state, open, BARRIER, state.stackFloor)
  state.lastSlash = NONE
  state.lastStar = NONE
}

function leaveConstruct(state: InlineState, close: number): void {
  const open = state.tokens[close + TOKEN_A]!
  if (state.tokens[open + TOKEN_C] === IMAGE) return
  const at = state.stackFloor
  removeAbove(state, at)
  state.stackFloor = state.stackBelow[at]!
  state.lastSlash = state.stackSlash[at]!
  state.lastStar = state.stackStar[at]!
  state.stackLive--
  pop(state)
}

function braceOpener(state: InlineState, token: number): void {
  // C2-I-055: a braced opener has no condition. C2-I-118: past the cap it is text.
  if (depth(state) < DEPTH_CAP) pushDelimiter(state, token, state.tokens[token + TOKEN_A]!)
  else state.tokens[token] = TOKEN_TEXT
}

/** Pairs the delimiters of the content. Tokens that form no node become text. */
export function pairDelimiters(state: InlineState): void {
  const tokens = state.tokens
  state.stackLength = 0
  state.stackLive = 0
  state.stackFloor = NONE
  state.lastSlash = NONE
  state.lastStar = NONE
  // A content with no token has nothing to pair, which is every run of plain text.
  if (state.tokenLength === 0) return
  state.classTop.fill(NONE)
  for (let at = 0; at < state.tokenLength; at += TOKEN_WIDTH) {
    const kind = tokens[at]!
    if (kind === TOKEN_DELIMITER) bareDelimiter(state, at)
    else if (kind === TOKEN_BRACED_OPEN) braceOpener(state, at)
    else if (kind === TOKEN_BRACED_CLOSE) bracedCloser(state, at)
    else if (kind === TOKEN_OPEN) enterConstruct(state, at)
    else if (kind === TOKEN_CLOSE) leaveConstruct(state, at)
  }
  // C2-I-054, C2-I-060: an opener with no closer in its content is text.
  removeAbove(state, NONE)
}
