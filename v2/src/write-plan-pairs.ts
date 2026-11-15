// C2-W-093: the delimiters of a planned leaf, paired by the reader's one delimiter stack (C2-I-008,
// C2-I-047 to C2-I-061) over the written units, with no parse. A pair is wanted when both of its
// marks are the marks of one node of the tree; every other pair, and a wanted mark left unpaired,
// leaves the leaf undecided.
import { type Node } from './ast.ts'
import { DEPTH_CAP } from './inline-tables.ts'
import { isBoundarySpace, isJoining, isWordCharacter, NO_CHARACTER } from './unicode.ts'
import { ATOM, CLOSE, ESCAPE, type Leaf, OPEN, TEXT, undecide } from './write-plan-model.ts'

const BRACE_OPEN = 123
const BRACE_CLOSE = 125
const SLASH = 47
const STAR = 42
const BRACKET_OPEN = 91
const BRACKET_CLOSE = 93
const MARKS = '*+,-/=^_~'

const DELIMITER = 0
const BRACED_OPEN = 1
const BRACED_CLOSE = 2
const ENTER = 3
const LEAVE = 4

const CAN_OPEN = 1
const CAN_CLOSE = 2
const BETWEEN_WORDS = 4

interface Token {
  kind: number
  start: number
  end: number
  /** The index of the mark in MARKS, or -1 for a bracket. */
  mark: number
  flags: number
  pair: number
}

interface Entry {
  token: number
  /** 0 to 8 a braced mark, 9 and 10 the bare slash and star, 11 a bracket barrier, 12 an entry that left. */
  cls: number
  below: number
  slash: number
  star: number
}

const BARE_CLASS = MARKS.length
const BARRIER = BARE_CLASS + 2
const DEAD = BARRIER + 1

interface Stack {
  tokens: Token[]
  entries: Entry[]
  top: number[]
  floor: number
  lastSlash: number
  lastStar: number
  /** C2-I-118: the open containers around the leaf and the open entries count toward the depth cap. */
  base: number
  live: number
  deepest: number
  /** A bracket of the tree past the cap, which the reader demotes to text. */
  demoted: boolean
}

function depth(s: Stack): number {
  return s.base + s.live
}

/** A token whose units are partly a mark of the tree and partly something else. */
const MIXED = 'mixed'

/** The node whose mark the units `[start, end)` are, null where none of them is a mark, or MIXED. */
function ownerOf(leaf: Leaf, start: number, end: number): Node | null | typeof MIXED {
  const kind = leaf.kinds[start]
  const owner = kind === OPEN || kind === CLOSE ? leaf.owners[start]! : null
  for (let at = start + 1; at < end; at++) {
    const other = leaf.kinds[at] === OPEN || leaf.kinds[at] === CLOSE ? leaf.owners[at]! : null
    if (other !== owner || (owner !== null && leaf.kinds[at] !== kind)) return MIXED
  }
  return owner
}

/** Whether the unit `at` is a braced comment, which counts as nothing for its neighbors (C2-I-026). */
function isBracedComment(leaf: Leaf, at: number): boolean {
  const owner = leaf.owners[at]
  return leaf.kinds[at] === ATOM && owner?.type === 'comment' && owner.form === 'braced'
}

function codeBefore(leaf: Leaf, at: number): number {
  let pos = at - 1
  while (pos >= 0 && isBracedComment(leaf, pos)) pos--
  if (pos < 0) return NO_CHARACTER
  const code = leaf.codes[pos]!
  if (code >= 0xdc00 && code < 0xe000 && pos > 0) return String.fromCharCode(leaf.codes[pos - 1]!, code).codePointAt(0)!
  return code
}

function codeAfter(leaf: Leaf, at: number): number {
  let pos = at
  while (pos < leaf.codes.length && isBracedComment(leaf, pos)) pos++
  if (pos >= leaf.codes.length) return NO_CHARACTER
  const code = leaf.codes[pos]!
  // C2-I-011: an escaped no-break space is whitespace for the test.
  if (code === 92 && leaf.codes[pos + 1] === 32 && leaf.kinds[pos] === ATOM) return 0xa0
  if (code >= 0xd800 && code < 0xdc00 && pos + 1 < leaf.codes.length) {
    return String.fromCharCode(code, leaf.codes[pos + 1]!).codePointAt(0)!
  }
  return code
}

/** C2-I-047, C2-I-048. */
export function flanking(leaf: Leaf, at: number): number {
  const before = codeBefore(leaf, at)
  const after = codeAfter(leaf, at + 1)
  const wordBefore = isWordCharacter(before)
  const wordAfter = isWordCharacter(after)
  let flags = wordBefore && wordAfter ? BETWEEN_WORDS : 0
  if (!wordBefore && !isBoundarySpace(after)) flags |= CAN_OPEN
  if (!isBoundarySpace(before) && !wordAfter) flags |= CAN_CLOSE
  return flags
}

function addToken(tokens: Token[], kind: number, start: number, end: number, mark: number, flags: number): void {
  tokens.push({ kind, start, end, mark, flags, pair: -1 })
}

/** A slash or a star, as `scanBareMark` reads it. */
function bareMark(tokens: Token[], leaf: Leaf, at: number, escaped: Uint8Array): number {
  const codes = leaf.codes
  const code = codes[at]!
  let last = at
  while (last + 1 < codes.length && codes[last + 1] === code && escaped[last + 1] === 0 && leaf.kinds[last + 1] !== ATOM) last++
  const closer = last + 1 < codes.length && codes[last + 1] === BRACE_CLOSE && leaf.kinds[last + 1] !== ATOM
  const mark = MARKS.indexOf(String.fromCharCode(code))
  if (last > at) {
    if (closer) addToken(tokens, BRACED_CLOSE, last, last + 2, mark, 0)
    return closer ? last + 2 : last + 1
  }
  if (isJoining(codeAfter(leaf, at + 1))) return at + 1
  const flags = flanking(leaf, at)
  if (closer) addToken(tokens, BRACED_CLOSE, at, at + 2, mark, flags)
  else if (flags !== 0) addToken(tokens, DELIMITER, at, at + 1, mark, flags)
  return closer ? at + 2 : at + 1
}

function isPlain(leaf: Leaf, escaped: Uint8Array, at: number): boolean {
  return at < leaf.codes.length && escaped[at] === 0 && leaf.kinds[at] !== ATOM && leaf.kinds[at] !== ESCAPE
}

/** The marks of brackets of the tree bound the delimiters inside them (C2-I-007). */
function bracketToken(tokens: Token[], leaf: Leaf, at: number): boolean {
  const kind = leaf.kinds[at]
  const code = leaf.codes[at]
  if (kind === OPEN && code === BRACKET_OPEN) {
    addToken(tokens, ENTER, at, at + 1, -1, 0)
    return true
  }
  if (kind === CLOSE && code === BRACKET_CLOSE) {
    addToken(tokens, LEAVE, at, at + 1, -1, 0)
    return true
  }
  return false
}

function scanAt(tokens: Token[], leaf: Leaf, at: number, escaped: Uint8Array): number {
  const codes = leaf.codes
  const code = codes[at]!
  if (bracketToken(tokens, leaf, at)) return at + 1
  if (code === BRACE_OPEN && isPlain(leaf, escaped, at + 1) && MARKS.includes(String.fromCharCode(codes[at + 1]!))) {
    addToken(tokens, BRACED_OPEN, at, at + 2, MARKS.indexOf(String.fromCharCode(codes[at + 1]!)), 0)
    return at + 2
  }
  if (code === SLASH || code === STAR) return bareMark(tokens, leaf, at, escaped)
  if (MARKS.includes(String.fromCharCode(code)) && isPlain(leaf, escaped, at + 1) && codes[at + 1] === BRACE_CLOSE) {
    addToken(tokens, BRACED_CLOSE, at, at + 2, MARKS.indexOf(String.fromCharCode(code)), 0)
    return at + 2
  }
  return at + 1
}

/** The delimiter tokens of the leaf. An escaped unit and the body of an atom are text. */
function scan(leaf: Leaf, escaped: Uint8Array): Token[] {
  const tokens: Token[] = []
  for (let at = 0; at < leaf.codes.length;) {
    const kind = leaf.kinds[at]
    if (kind === ESCAPE) at += 2
    else if (kind === ATOM || escaped[at] !== 0 || leaf.opaque?.[at] === 1) at++
    else at = scanAt(tokens, leaf, at, escaped)
  }
  return tokens
}

function push(s: Stack, token: number, cls: number, below: number): number {
  s.entries.push({ token, cls, below, slash: s.lastSlash, star: s.lastStar })
  s.live++
  s.deepest = Math.max(s.deepest, s.live)
  return s.entries.length - 1
}

function unlink(s: Stack, at: number): void {
  const entry = s.entries[at]!
  s.top[entry.cls] = entry.below
  s.live--
}

function removeAbove(s: Stack, at: number): void {
  for (let entry = s.entries.length - 1; entry > at; entry--) {
    if (s.entries[entry]!.cls !== DEAD) unlink(s, entry)
  }
  s.entries.length = at + 1
}

function pop(s: Stack): void {
  s.entries.length--
  while (s.entries.length > 0 && s.entries[s.entries.length - 1]!.cls === DEAD) s.entries.length--
}

function closeEntry(s: Stack, at: number, token: number): void {
  const opener = s.entries[at]!.token
  removeAbove(s, at)
  unlink(s, at)
  pop(s)
  s.tokens[opener]!.pair = token
  s.tokens[token]!.pair = opener
}

function closeBare(s: Stack, at: number, token: number, lastBetweenWords: number): void {
  const opener = s.entries[at]!.token
  if (lastBetweenWords < opener) return closeEntry(s, at, token)
  // C2-I-053: the span holds its own delimiter between two word characters; both are text.
  unlink(s, at)
  s.entries[at]!.cls = DEAD
  if (at === s.entries.length - 1) pop(s)
}

function bareDelimiter(s: Stack, token: number): void {
  const t = s.tokens[token]!
  const slash = t.mark === MARKS.indexOf('/')
  const cls = slash ? BARE_CLASS : BARE_CLASS + 1
  const top = s.top[cls]!
  if ((t.flags & BETWEEN_WORDS) !== 0) {
    if (slash) s.lastSlash = token
    else s.lastStar = token
  } else if ((t.flags & CAN_CLOSE) !== 0 && top > s.floor) {
    closeBare(s, top, token, slash ? s.lastSlash : s.lastStar)
  } else if ((t.flags & CAN_OPEN) !== 0 && depth(s) < DEPTH_CAP) {
    s.top[cls] = push(s, token, cls, top)
  }
}

function bracedCloser(s: Stack, token: number): void {
  const t = s.tokens[token]!
  const top = s.top[t.mark]!
  if (top <= s.floor) {
    // No braced opener is open: the mark is read by the bare rules.
    if (t.flags === 0) return
    t.kind = DELIMITER
    t.end--
    return bareDelimiter(s, token)
  }
  const entry = s.entries[top]!
  s.lastSlash = entry.slash
  s.lastStar = entry.star
  if (s.tokens[entry.token]!.end !== t.start) return closeEntry(s, top, token)
  // C2-I-061: an opener glued to its own closer forms nothing.
  unlink(s, top)
  pop(s)
}

function enter(s: Stack, token: number): void {
  if (depth(s) >= DEPTH_CAP) {
    s.demoted = true
    return
  }
  s.floor = push(s, token, BARRIER, s.floor)
  s.lastSlash = -1
  s.lastStar = -1
}

function leave(s: Stack): void {
  const at = s.floor
  if (at < 0) return
  removeAbove(s, at)
  const entry = s.entries[at]!
  s.floor = entry.below
  s.lastSlash = entry.slash
  s.lastStar = entry.star
  s.live--
  pop(s)
}

function braceOpener(s: Stack, token: number): void {
  const mark = s.tokens[token]!.mark
  if (depth(s) < DEPTH_CAP) s.top[mark] = push(s, token, mark, s.top[mark]!)
}

function pairAll(tokens: Token[], base: number): Stack {
  const s: Stack = {
    tokens, entries: [], top: new Array<number>(BARRIER).fill(-1), floor: -1, lastSlash: -1, lastStar: -1,
    base, live: 0, deepest: 0, demoted: false,
  }
  for (let at = 0; at < tokens.length; at++) {
    const kind = tokens[at]!.kind
    if (kind === DELIMITER) bareDelimiter(s, at)
    else if (kind === BRACED_OPEN) braceOpener(s, at)
    else if (kind === BRACED_CLOSE) bracedCloser(s, at)
    else if (kind === ENTER) enter(s, at)
    else if (!s.demoted) leave(s)
  }
  return s
}

const DELIMITED: readonly string[] = ['emphasis', 'strong', 'underline', 'strike', 'highlight', 'superscript', 'subscript',
  'insert', 'delete']

/** The nodes whose marks pair as one node of the tree. Null where a pair is not a node of the tree. */
function formedNodes(leaf: Leaf, tokens: readonly Token[]): Set<Node> | null {
  const formed = new Set<Node>()
  for (const token of tokens) {
    if (token.kind === ENTER || token.kind === LEAVE) continue
    leaf.cursor = token.start
    const owner = ownerOf(leaf, token.start, token.end)
    if (owner === MIXED) return null
    if (token.pair < 0) continue
    const pair = tokens[token.pair]!
    if (owner === null || ownerOf(leaf, pair.start, pair.end) !== owner) return null
    formed.add(owner)
  }
  return formed
}

// C2-W-125: the characters before a mark that the repair escapes before it gives a node its other spelling.
const JOINING = '\\!^$`{'

/** The unit of the closing mark of `owner` behind `at`. */
function closerOf(leaf: Leaf, at: number, owner: Node): number {
  for (let unit = at + 1; unit < leaf.codes.length; unit++) if (leaf.kinds[unit] === CLOSE && leaf.owners[unit] === owner) return unit
  return -1
}

/**
 * C2-W-069: a bare emphasis or strong whose own opener cannot open or whose closer cannot close at
 * its neighbors takes the braced form. Where a character before the opener could take an escape
 * instead (C2-W-125), the leaf is left undecided.
 */
function respell(leaf: Leaf, at: number, owner: Node): void {
  const close = closerOf(leaf, at, owner)
  if ((owner.type !== 'emphasis' && owner.type !== 'strong') || close < 0) return undecide(leaf, 'mark of the tree does not pair')
  const before = at > 0 && leaf.kinds[at - 1] === TEXT ? String.fromCharCode(leaf.codes[at - 1]!) : ''
  const intrinsic = (flanking(leaf, at) & CAN_OPEN) === 0 || (flanking(leaf, close) & CAN_CLOSE) === 0
  if (!intrinsic || (before !== '' && JOINING.includes(before))) return undecide(leaf, 'mark of the tree does not pair')
  leaf.respell.push(owner)
}

/** C2-W-093: every pair the reader forms is a node of the tree, and the marks of every delimited node pair. */
export function checkPairs(leaf: Leaf, escaped: Uint8Array, depthBound: number): void {
  const tokens = scan(leaf, escaped)
  // C2-I-118: the plan knows the depth of a leaf at the top level only; elsewhere the cap must stay out of reach.
  const s = pairAll(tokens, 0)
  if (s.demoted || (depthBound > 0 && s.deepest + depthBound >= DEPTH_CAP)) return undecide(leaf, 'depth cap')
  const formed = formedNodes(leaf, tokens)
  if (formed === null) return undecide(leaf, 'text pairs')
  for (let at = 0; at < leaf.codes.length && leaf.undecided === null; at++) {
    leaf.cursor = at
    const owner = leaf.owners[at]!
    if (leaf.kinds[at] !== OPEN || !DELIMITED.includes(owner.type) || formed.has(owner)) continue
    if (leaf.codes[at] === BRACE_OPEN) return undecide(leaf, 'mark of the tree does not pair')
    respell(leaf, at, owner)
  }
}
