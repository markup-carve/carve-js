// The planned escapes of an inline leaf (C2-W-088 to C2-W-099, C2-W-125): every unit of text is
// looked up by its code in the tables of write-tables.ts, and a unit that can start a construct goes
// to the resolver of its context. A resolver returns bare, an escape, or no decision; a leaf with no
// decision is left to the repair of write.ts.
import { forEachSlot, type Node, type TextNode } from './ast.ts'
import { isAsciiPunctuation, isWordCharacter } from './unicode.ts'
import { IN_CELL } from './write-inline.ts'
import {
  ATOM, CLOSE, createLeaf, ESCAPE, inNote, type Leaf, leafText, modelContent, modelInlines, OPEN, TEXT, trimLast, undecide,
} from './write-plan-model.ts'
import { emptyMemo, readAttributeBlock } from './attributes.ts'
import { opensAngleAtom } from './write-plan-angle.ts'
import { checkBrackets, isFootnoteCaret } from './write-plan-brackets.ts'
import { checkPairs } from './write-plan-pairs.ts'
import { colonName, NAME, sigilName, UNKNOWN } from './write-plan-sigil.ts'
import { checkSmart } from './write-plan-smart.ts'
import { type LeafPlace, lineEscape, UNDECIDED } from './write-plan-lines.ts'
import { BRACED_CLOSER_MARKS, INLINE_TRIGGERS, LINE_TRIGGERS } from './write-tables.ts'
import { type Writer } from './write-state.ts'
import { MAX_DEPTH } from './state.ts'
import { BRACED_MARKS } from './inline-tables.ts'

/** What one planned write of a group collects. */
export interface Plan {
  undecided: string | null
  /** Where the plan lost its decision: the leaf around the unit, for the report of the gates. */
  detail: string
  /** The text nodes that a planned leaf holds. */
  covered: Set<TextNode>
  /** The escapes the plan places, by text node, in ascending order. */
  escapes: Map<TextNode, number[]>
  /** C2-W-069: the bare emphasis and strong that the next write gives their braced form. */
  respell: Node[]
  /** Where each list of nodes of the group stands, for the rules of its line starts. */
  places: Map<readonly Node[], LeafPlace>
  leaves: number
  /** C2-W-016: the nodes whose value no spelling keeps, which the write reports. */
  lost: Node[]
}

export function createPlan(): Plan {
  return {
    undecided: null, detail: '', covered: new Set(), escapes: new Map(), respell: [], places: new Map(), leaves: 0, lost: [],
  }
}

/** How the caller of a leaf ends it: as `writeContent`, as `writeInlines`, or as a line of a line block. */
export const AS_CONTENT = 0
export const AS_INLINES = 1
export const AS_LINE = 2

/** Where the first unit of a leaf stands: at the start of a content line, or behind a mark on its line. */
export const LINE_START = 1
export const AFTER_MARK = 0
export const IN_TITLE = 2

const LF = 10
const SPACE = 32
const TAB = 9
const CR = 13
const BACKSLASH = 92

type Resolver = (leaf: Leaf, at: number, escaped: Uint8Array) => void

function code(leaf: Leaf, at: number): number {
  return at >= 0 && at < leaf.codes.length ? leaf.codes[at]! : -1
}

function isSpace(value: number): boolean {
  return value === SPACE || value === TAB || value === LF || value === -1
}

function isAsciiAlphanumeric(value: number): boolean {
  return (value >= 48 && value <= 57) || (value >= 65 && value <= 90) || (value >= 97 && value <= 122)
}

/** Whether a unit is literal text for the reader: escaped, or the body of an atom. */
function isLiteral(leaf: Leaf, at: number, escaped: Uint8Array): boolean {
  return escaped[at] !== 0 || leaf.kinds[at - 1] === ESCAPE
}

function undecidedIf(condition: boolean, leaf: Leaf, why: string): void {
  if (condition) undecide(leaf, why)
}

/** C2-W-099: a run of hyphens of text takes a backslash before every second hyphen. */
function hyphen(leaf: Leaf, at: number, escaped: Uint8Array): void {
  if (code(leaf, at - 1) === 45) return undecidedIf(leaf.kinds[at - 1] !== TEXT, leaf, 'hyphen neighbor')
  let end = at
  while (code(leaf, end) === 45) {
    if (leaf.kinds[end] !== TEXT || isLiteral(leaf, end, escaped)) return undecide(leaf, 'hyphen run')
    end++
  }
  const before = code(leaf, at - 1)
  const after = code(leaf, end)
  // C2-I-115, C2-I-117: an arrow, a braced mark or `+-` that the run could make with its neighbors.
  // C2-I-057: `-}` closes only while a `{-` is open, so with none before the run it is text.
  const closer = after === 125 && firstOpen(leaf, 45) < at
  if (before === 43) return plusHyphen(leaf, at, end, closer, escaped)
  if (end - at > 1 && (before === 123 || before === 60 || closer || after === 62)) return undecide(leaf, 'hyphen neighbor')
  for (let unit = at + 1; unit < end; unit += 2) escaped[unit] = 1
}

function plusHyphen(leaf: Leaf, at: number, end: number, closer: boolean, escaped: Uint8Array): void {
  if (!closer && plusMinus(leaf, at, end)) escaped[at - 1] = 1
  else undecide(leaf, 'hyphen neighbor')
}

/** The first `{` of the leaf before the ASCII mark `value`, or the leaf's length; found once per leaf for every mark. */
function firstOpen(leaf: Leaf, value: number): number {
  if (leaf.opens === null) {
    const opens = new Int32Array(128).fill(leaf.codes.length)
    for (let at = leaf.codes.length - 2; at >= 0; at--) {
      const mark = leaf.codes[at] === 123 ? leaf.codes[at + 1]! : 128
      if (mark < 128) opens[mark] = at
    }
    leaf.opens = opens
  }
  return leaf.opens[value] ?? leaf.codes.length
}

/**
 * C2-I-117: `+-` of text whose exact run stands alone in its text reads as the plus-minus sign, whose opener takes the
 * backslash. A neighbor of another kind, or a brace that may make the `+` a mark, is left to the repair.
 */
function plusMinus(leaf: Leaf, at: number, end: number): boolean {
  if (end - at !== 1 || leaf.kinds[at - 1] !== TEXT || code(leaf, end) === 43) return false
  const outer = code(leaf, at - 2)
  return outer < 0 || (leaf.kinds[at - 2] === TEXT && outer !== 43 && outer !== 45 && outer !== 123)
}

/** C2-W-095: a straight quote of text would read as a smart quote. */
function quote(leaf: Leaf, at: number, escaped: Uint8Array): void {
  if (isLiteral(leaf, at, escaped)) return
  escaped[at] = 1
}

function dots(leaf: Leaf, at: number): void {
  undecidedIf(code(leaf, at + 1) === 46 && code(leaf, at + 2) === 46, leaf, 'dot run')
}

/** C2-I-026: a braced comment counts as nothing for the sigil boundary, so the character before it decides. */
function behindBracedComment(leaf: Leaf, at: number): boolean {
  const owner = leaf.owners[at - 1]
  return leaf.kinds[at - 1] === ATOM && owner?.type === 'comment' && owner.form === 'braced'
}

/** C2-I-090: a name of a mention or a tag after a boundary. */
/** The code point that ends at unit `at`, or -1 for a broken surrogate pair. */
function codePointBefore(leaf: Leaf, at: number): number {
  const low = code(leaf, at)
  if (low < 0xd800 || low >= 0xe000) return low
  const high = code(leaf, at - 1)
  if (low < 0xdc00 || high < 0xd800 || high >= 0xdc00) return -2
  return (high - 0xd800) * 0x400 + low - 0xdc00 + 0x10000
}

function sigil(leaf: Leaf, at: number, escaped: Uint8Array): void {
  const before = codePointBefore(leaf, at - 1)
  if (before === -2 || behindBracedComment(leaf, at)) return undecide(leaf, 'sigil')
  if (before >= 0 && isWordCharacter(before)) return
  // C2-I-063: `@}` closes nothing, and `#}` closes an editorial comment only behind its opener `{#` of text, which
  // brace() leaves to the repair, so a sigil before `}` is text, behind a node too.
  const name = sigilName(leaf, at)
  if (name === UNKNOWN) undecide(leaf, 'sigil')
  else if (name === NAME) escaped[at] = 1
}

/** C2-I-093, C2-I-094: a symbol or an inline extension. */
function colon(leaf: Leaf, at: number, escaped: Uint8Array): void {
  const before = codePointBefore(leaf, at - 1)
  if (before === -2 || behindBracedComment(leaf, at)) return undecide(leaf, 'symbol')
  if (before >= 0 && isWordCharacter(before)) return
  const name = colonName(leaf, at)
  if (name === UNKNOWN) undecide(leaf, 'symbol')
  else if (name === NAME) escaped[at] = 1
}

function nextIs(leaf: Leaf, at: number, chars: string): boolean {
  const next = code(leaf, at + 1)
  return next >= 0 && chars.includes(String.fromCharCode(next))
}

const NO_REFERENCE = 0
const REFERENCE = 1
const UNREAD = 2

/**
 * C2-I-094, C2-I-074, C2-I-089: a `[` behind a text `:name` opens an inline extension and behind a text `!` an image,
 * which the repair decides; behind a bare `^` it opens an inline footnote, which write-plan-brackets.ts pairs. -1 where
 * none of them opens.
 */
function openedBefore(leaf: Leaf, at: number, escaped: Uint8Array): number {
  if (leaf.extensions.has(at)) return UNREAD
  if (leaf.kinds[at - 1] !== TEXT) return -1
  const before = code(leaf, at - 1)
  if (before === 33) return UNREAD
  return isFootnoteCaret(leaf, at - 1, escaped) ? NO_REFERENCE : -1
}

/**
 * C2-I-087, C2-I-079: whether the text `[^` at `at` opens a footnote reference: its label runs to the next `]` that no
 * backslash escapes and holds more than blanks. A label that holds a node or a `%` is left to the repair (C2-I-077).
 */
function footnoteReading(leaf: Leaf, at: number, escaped: Uint8Array): number {
  // With no `]` behind it the bracket opens nothing, behind a sigil or not.
  if (leaf.lastBracket <= at + 2) return NO_REFERENCE
  const opened = openedBefore(leaf, at, escaped)
  if (opened >= 0) return opened
  let blank = true
  for (let unit = at + 2; unit < leaf.codes.length; unit++) {
    const value = leaf.codes[unit]!
    if ((leaf.kinds[unit] !== TEXT && leaf.kinds[unit] !== ESCAPE) || value === 37) return UNREAD
    if (value === 93 && leaf.kinds[unit - 1] !== ESCAPE) return blank ? NO_REFERENCE : REFERENCE
    if (value !== 32 && value !== 9 && value !== LF) blank = false
  }
  return NO_REFERENCE
}

/** Whether the plan decided the text `[` at `at` before a caret: escaped as a footnote reference, or bare as none. */
function footnotePlanned(leaf: Leaf, at: number, escaped: Uint8Array): boolean {
  // A backslash the writer placed may be needless; the repair removes it (C2-W-088).
  if (leaf.kinds[at] !== TEXT || leaf.kinds[at - 1] === ESCAPE) return false
  return escaped[at] !== 0 || footnoteReading(leaf, at, escaped) === NO_REFERENCE
}

/**
 * C2-W-094: an opening bracket before `^` opens a footnote reference (C2-I-087), whose `[` takes the backslash; pairs
 * are checked in write-plan-brackets.ts.
 */
function bracket(leaf: Leaf, at: number, escaped: Uint8Array): void {
  if (isLiteral(leaf, at, escaped) || !nextIs(leaf, at, '^') || inNote(leaf, at)) return
  const reading = leaf.kinds[at + 1] === TEXT ? footnoteReading(leaf, at, escaped) : UNREAD
  if (reading === UNREAD) undecide(leaf, 'footnote bracket')
  else if (reading === REFERENCE) escaped[at] = 1
}

// C2-I-036: the atoms that are no host of an attribute block.
const NO_HOSTS: ReadonlySet<string> = new Set([
  'mention', 'tag', 'xref', 'comment', 'critic_comment', 'raw_inline', 'smart_punctuation', 'soft_break', 'hard_break',
])

// C2-I-036: the hosts of an attribute block; a node of any other type behind a block is left to the repair.
const HOSTS: ReadonlySet<string> = new Set([
  'span', 'link', 'image', 'autolink', 'code', 'literal_inline', 'math', 'footnote_ref', 'inline_footnote', 'symbol',
  'inline_extension', 'emphasis', 'strong', 'delete', 'insert', 'highlight', 'superscript', 'subscript',
])

function isHost(leaf: Leaf, at: number): boolean {
  const owner = leaf.owners[at - 1]
  return owner !== undefined && HOSTS.has(owner.type)
}

function behindHost(leaf: Leaf, at: number): boolean {
  const kind = leaf.kinds[at - 1]
  if (kind === CLOSE) return true
  return kind === ATOM && !NO_HOSTS.has(leaf.owners[at - 1]!.type)
}

/** C2-I-021: only behind a plain code span is `{=` a raw marker; anywhere else it is a braced opener. */
function behindCode(leaf: Leaf, at: number): boolean {
  return leaf.kinds[at - 1] === ATOM && leaf.owners[at - 1]?.type === 'code'
}

/** C2-I-028: whether a `}` follows the brace at `at` on its line; a CR is read past, so a `}` behind it counts. */
function closesOnLine(leaf: Leaf, at: number): boolean {
  if (at < leaf.braceFailEnd) return false
  let end = at + 1
  while (end < leaf.codes.length && leaf.codes[end] !== 10 && leaf.codes[end] !== 125) end++
  if (leaf.codes[end] === 125) return true
  leaf.braceFailEnd = end
  return false
}

const ESCAPED = 1

/**
 * C2-I-028, C2-I-043: how a text brace behind a host reads, by the reader's grammar on the read text up to the line
 * end. A block that forms takes the backslash on its brace (C2-W-090); a brace that forms none is text. A node, an
 * escape or a comment brace inside the text leaves it to the repair, and so does `{=`, which behind a code span may
 * be a raw marker (C2-I-021).
 */
function hostBlock(leaf: Leaf, at: number, escaped: Uint8Array): number {
  // C2-I-043: a valid block comes before a comment, so `{%` and `{#` are read as a block first.
  if (nextIs(leaf, at, '=')) return UNDECIDED
  let end = at
  const codes = leaf.codes
  while (end < codes.length && end - at < LONGEST_BLOCK && codes[end] !== LF && leaf.kinds[end] === TEXT && escaped[end] === 0) end++
  if (end - at >= LONGEST_BLOCK) return UNDECIDED
  const text = String.fromCharCode(...leaf.codes.slice(at, end))
  if (readAttributeBlock(text, 0, text.length, emptyMemo(), null) >= 0) return isHost(leaf, at) ? ESCAPED : UNDECIDED
  return end === leaf.codes.length || leaf.codes[end] === LF ? 0 : UNDECIDED
}

/** C2-W-096: a brace that opens a comment or an attribute block; a braced opener is paired in write-plan-pairs.ts. */
function brace(leaf: Leaf, at: number, escaped: Uint8Array): void {
  if (isLiteral(leaf, at, escaped)) return
  // C2-I-028: behind a host the brace may open its attribute block; a braced opener is no attribute block.
  if (behindHost(leaf, at) && !nextIs(leaf, at, behindCode(leaf, at) ? '*+,-/^~' : '*+,-/^~=') && closesOnLine(leaf, at)) {
    const reading = hostBlock(leaf, at, escaped)
    if (reading === UNDECIDED) return undecide(leaf, 'attribute block')
    if (reading === ESCAPED) return void (escaped[at] = 1)
  }
  // C2-I-025, C2-I-043: `{%` and `{#` open a comment only where a `%}` or a `#}` follows in the content, behind the
  // mark of the opener and, for `{#`, one character more.
  const next = code(leaf, at + 1)
  undecidedIf((next === 37 || next === 35) && lastClose(leaf, next) >= at + (next === 35 ? 4 : 3), leaf, 'brace')
  // C2-W-096: the source of an atom may start a braced mark that the pairs of text do not see.
  // C2-I-060: with no closer of that mark later in the leaf, the opener is text and the atom keeps its source.
  const opens = leaf.kinds[at + 1] === ATOM && nextIs(leaf, at, BRACED_CLOSER_MARKS)
  undecidedIf(opens && lastClose(leaf, code(leaf, at + 1)) > at, leaf, 'brace')
}

/** The last `}` of the leaf behind the ASCII mark `value`, or -1; found once per leaf for every mark. */
function lastClose(leaf: Leaf, value: number): number {
  if (leaf.closes === null) {
    const closes = new Int32Array(128).fill(-1)
    for (let at = leaf.codes.length - 1; at > 0; at--) {
      const mark = leaf.codes[at] === 125 ? leaf.codes[at - 1]! : 128
      if (mark < 128 && closes[mark]! < 0) closes[mark] = at
    }
    leaf.closes = closes
  }
  return value < 128 ? (leaf.closes[value] ?? -1) : -1
}

/** A closing brace behind an atom whose source ends in a braced mark. */
function closingBrace(leaf: Leaf, at: number, escaped: Uint8Array): void {
  if (isLiteral(leaf, at, escaped) || leaf.kinds[at - 1] !== ATOM) return
  const before = code(leaf, at - 1)
  // C2-I-060: with no opener of that mark earlier in the leaf, the closer is text.
  const marked = before >= 0 && BRACED_CLOSER_MARKS.includes(String.fromCharCode(before))
  undecidedIf(marked && firstOpen(leaf, before) < at - 1, leaf, 'brace')
}

/** Whether the bare text before `at` is one of `chars`, so that a run that starts there may take `at` in. */
function runBefore(leaf: Leaf, at: number, escaped: Uint8Array, chars: string): boolean {
  const before = code(leaf, at - 1)
  return before >= 0 && leaf.kinds[at - 1] === TEXT && !isLiteral(leaf, at - 1, escaped) && chars.includes(String.fromCharCode(before))
}

/** C2-I-115: a `=` behind a bare `=` is taken in only by `==>` from that `=` or by `<==` from the character before it. */
function takenFromEquals(leaf: Leaf, at: number, escaped: Uint8Array): boolean {
  if (code(leaf, at) !== 61 || !runBefore(leaf, at, escaped, '=')) return false
  return code(leaf, at + 1) === 62 || code(leaf, at - 2) === 60
}

/**
 * C2-I-115, C2-I-117: a replaced run that starts at the text sign `at` (the sign and one of `seconds`, and `==>`)
 * takes the backslash on the sign; `=>` is no replaced run. A sign that a run from the character before may take in,
 * one of `inside`, is left to the repair, and so is a run that reaches into a node. A mark before a closing brace is
 * paired in write-plan-pairs.ts.
 */
function signRun(seconds: string, inside: string): Resolver {
  return (leaf, at, escaped) => {
    if (isLiteral(leaf, at, escaped) || !nextIs(leaf, at, seconds)) return
    const why = `mark ${String.fromCharCode(code(leaf, at))}`
    const taken = runBefore(leaf, at, escaped, inside) || takenFromEquals(leaf, at, escaped)
    if (taken || leaf.kinds[at + 1] !== TEXT) return undecide(leaf, why)
    if (code(leaf, at) !== 61) {
      escaped[at] = 1
      return
    }
    if (code(leaf, at + 1) === 61 && code(leaf, at + 2) === 62) {
      if (leaf.kinds[at + 2] === TEXT) escaped[at] = 1
      else undecide(leaf, why)
    }
  }
}

/** Whether the atom unit `at` continues the atom before it; two atoms in a row are two nodes. */
function continuesAtom(leaf: Leaf, at: number): boolean {
  return leaf.kinds[at - 1] === ATOM && leaf.owners[at - 1] === leaf.owners[at]
}

/** Whether the unit `at` is an opening bracket of the tree: a mark, or the start of an atom. */
function treeBracket(leaf: Leaf, at: number): boolean {
  const kind = leaf.kinds[at]
  return leaf.codes[at] === 91 && (kind === OPEN || (kind === ATOM && !continuesAtom(leaf, at)))
}

function opensLink(leaf: Leaf, at: number): boolean {
  return treeBracket(leaf, at) && leaf.owners[at]?.type === 'link'
}

/** Whether the unit `at` starts a code span of the tree. */
function opensCode(leaf: Leaf, at: number): boolean {
  return leaf.kinds[at] === ATOM && !continuesAtom(leaf, at) && leaf.owners[at]?.type === 'code'
}

/**
 * C2-W-090: a sigil glued to a bracket or a backtick of a construct of the tree takes the backslash, as the image
 * sigil before a link and the math sigil before a code span. Before a text bracket, the pair decides
 * (write-plan-brackets.ts); before the other characters of `rest`, the leaf is left to the repair.
 */
function gluedSigil(leaf: Leaf, at: number, escaped: Uint8Array, opens: (leaf: Leaf, at: number) => boolean, rest: string): void {
  if (isLiteral(leaf, at, escaped)) return
  if (opens(leaf, at + 1)) {
    // C2-W-091: bare, the construct does not form, and a delimiter before it may pair into its source first.
    if (leaf.textMark) return undecide(leaf, 'sigil order')
    escaped[at] = 1
    return
  }
  if (plannedTick(leaf, at + 1)) return
  undecidedIf(nextIs(leaf, at, rest), leaf, `sigil ${String.fromCharCode(code(leaf, at))}`)
}

/**
 * A backtick of text whose run the tick plan writes escaped, or bare where no later run closes it: either way no span
 * opens there, so a sigil glued to it opens none either.
 */
function plannedTick(leaf: Leaf, at: number): boolean {
  if (code(leaf, at) !== 96 || leaf.kinds[at] !== TEXT || leaf.kinds[at - 1] === ESCAPE) return false
  leaf.ticks ??= tickPlan(leaf)
  return leaf.ticks[at] === TICK_BARE || leaf.ticks[at] === TICK_ESCAPED
}

/**
 * C2-I-055: behind a bare `{` of text the caret makes a braced opener, which write-plan-pairs.ts pairs, and no
 * footnote sigil; behind `[` it makes a footnote reference where a `]` follows (C2-I-087).
 */
function caret(leaf: Leaf, at: number, escaped: Uint8Array): void {
  const before = code(leaf, at - 1)
  const textBefore = leaf.kinds[at - 1] === TEXT
  if (before === 123 && textBefore && !isLiteral(leaf, at - 1, escaped)) return
  // C2-I-089: inside a note a caret pair opens nothing.
  if (inNote(leaf, at)) return
  if ((before === 123 && !textBefore) || (before === 91 && leaf.lastBracket > at && !footnotePlanned(leaf, at - 1, escaped))) {
    return undecide(leaf, 'footnote bracket')
  }
  gluedSigil(leaf, at, escaped, treeBracket, '')
}

/** C2-I-073, C2-I-096, C2-I-117: an autolink, a cross-reference or an arrow or comparison that opens at `<`. */
function angle(leaf: Leaf, at: number, escaped: Uint8Array): void {
  if (isLiteral(leaf, at, escaped)) return
  const next = code(leaf, at + 1)
  if (next === 61 && leaf.kinds[at + 1] === TEXT) {
    escaped[at] = 1
    return
  }
  if (next === 61) return undecide(leaf, 'angle')
  // C2-I-115: `<--` is left to the hyphen run; `<-` alone stays as typed.
  if (opensAngleAtom(leaf, at)) escaped[at] = 1
}

/** C2-B-133: `%%` at the start of a line or after whitespace opens a line comment; its first `%` takes the backslash. */
function percent(leaf: Leaf, at: number, escaped: Uint8Array): void {
  // C2-I-025: `%}` closes only a braced comment of text, whose `{%` the brace resolver leaves to the repair.
  // C2-I-023: a line comment starts only on a line of content, which a title is not.
  if (leaf.inTitle || isLiteral(leaf, at, escaped) || !nextIs(leaf, at, '%')) return
  const before = code(leaf, at - 1)
  if (before === 37 || before === 123) return undecidedIf(!percentBehindText(leaf, at, before, escaped), leaf, 'mark %')
  // C2-B-135: in the body of a line block `%%` is text.
  if (isSpace(before) && !leaf.inLine) escaped[at] = 1
}

/** C2-I-055: a bare `{` of text before the mark of a node reads as a braced opener with it, so it takes the backslash. */
function bracesBeforeMarks(leaf: Leaf, escaped: Uint8Array): void {
  for (let at = leaf.codes.indexOf(123); at >= 0; at = leaf.codes.indexOf(123, at + 1)) {
    const next = leaf.kinds[at + 1]
    if (leaf.kinds[at] !== TEXT || isLiteral(leaf, at, escaped) || (next !== OPEN && next !== CLOSE)) continue
    if (BRACED_MARKS.includes(String.fromCharCode(leaf.codes[at + 1]!))) escaped[at] = 1
  }
}

/**
 * C2-I-023: at the start of the content of a bracket or a braced opener, `%%` opens a line comment too. Decided once
 * the brackets are, since an escaped `[` opens nothing and the `%` then needs no backslash.
 */
function percentsBehindOpeners(leaf: Leaf, escaped: Uint8Array): void {
  for (let at = leaf.codes.indexOf(37); at >= 0; at = leaf.codes.indexOf(37, at + 1)) {
    if (leaf.inTitle || leaf.inLine || leaf.kinds[at] !== TEXT || isLiteral(leaf, at, escaped) || !nextIs(leaf, at, '%')) continue
    if (opensContentBefore(leaf, at - 1, escaped)) escaped[at] = 1
  }
}

/** Whether the unit `at` ends a bracket or a braced opener, of the tree or of text the reader reads as one. */
function opensContentBefore(leaf: Leaf, at: number, escaped: Uint8Array): boolean {
  const value = code(leaf, at)
  if (leaf.kinds[at] === OPEN) {
    return value === 91 || (code(leaf, at - 1) === 123 && leaf.kinds[at - 1] === OPEN && BRACED_MARKS.includes(String.fromCharCode(value)))
  }
  if (leaf.kinds[at] !== TEXT || isLiteral(leaf, at, escaped)) return false
  if (value === 91) return true
  // A `{` of text before a mark of the tree is escaped for that mark, so it opens nothing.
  return BRACED_MARKS.includes(String.fromCharCode(value)) && code(leaf, at - 1) === 123 && leaf.kinds[at - 1] === TEXT
    && !isLiteral(leaf, at - 1, escaped)
}

/**
 * C2-B-133: behind a `%` of text, or behind a `{` that opens no braced comment (C2-I-025), `%%` stands after no
 * whitespace and is text.
 */
function percentBehindText(leaf: Leaf, at: number, before: number, escaped: Uint8Array): boolean {
  if (leaf.kinds[at - 1] !== TEXT) return false
  return before === 37 || isLiteral(leaf, at - 1, escaped) || lastClose(leaf, 37) < at + 2
}

const RESOLVERS: Readonly<Record<string, Resolver>> = {
  '!': (leaf, at, escaped) => {
    if (nextIs(leaf, at, '=') && leaf.kinds[at - 1] !== TEXT && at > 0) undecide(leaf, 'sigil !')
    else if (nextIs(leaf, at, '=') && leaf.kinds[at + 1] === TEXT && !isLiteral(leaf, at, escaped)) escaped[at] = 1
    else if (treeBracket(leaf, at + 1) && !opensLink(leaf, at + 1)) undecide(leaf, 'sigil !')
    else gluedSigil(leaf, at, escaped, (l, unit) => opensLink(l, unit) || opensCode(l, unit), '`=')
  },
  '"': quote,
  '#': (leaf, at, escaped) => { if (!isLiteral(leaf, at, escaped)) sigil(leaf, at, escaped) },
  '$': (leaf, at, escaped) => gluedSigil(leaf, at, escaped, opensCode, '$'),
  '%': percent,
  '\'': quote,
  '(': (leaf, at) => undecidedIf(nextIs(leaf, at, 't') && code(leaf, at + 2) === 109, leaf, 'trademark'),
  '*': () => undefined,
  '+': signRun('-', ''),
  ',': () => undefined,
  '-': hyphen,
  '.': (leaf, at, escaped) => { if (!isLiteral(leaf, at, escaped)) dots(leaf, at) },
  '/': () => undefined,
  ':': (leaf, at, escaped) => { if (!isLiteral(leaf, at, escaped)) colon(leaf, at, escaped) },
  '<': angle,
  '=': signRun('=>', '!<>'),
  '>': signRun('=', '-=<'),
  '@': (leaf, at, escaped) => { if (!isLiteral(leaf, at, escaped)) sigil(leaf, at, escaped) },
  '[': bracket,
  // C2-W-097: a backslash the writer leaves single before punctuation stands in what it takes for a quoted brace
  // value (C2-I-033); an escape of the plan may have undone that quote.
  '\\': (leaf, at) => {
    const next = code(leaf, at + 1)
    undecidedIf(leaf.kinds[at - 1] !== ESCAPE && (next === 32 || isAsciiPunctuation(next)), leaf, 'backslash')
  },
  ']': () => undefined,
  '^': caret,
  '_': () => undefined,
  '`': backtick,
  '{': brace,
  '|': () => undefined,
  '}': closingBrace,
  '~': () => undefined,
}

const TICK_BARE = 1
const TICK_ESCAPED = 2
const TICK_UNDECIDED = 3

/**
 * C2-I-015, C2-I-017: a run opens only where a run of its length stands later in the content, and that search is
 * lexical, so an escaped backtick closes too. From the end, a run of text that a later run would close takes a
 * backslash before its first backtick, then before the next while the rest is closed too (C2-W-088), and leaves
 * lone backticks and one run of the rest behind it. A run glued to an atom or to an escape of the writer is left
 * to the repair.
 */
function tickPlan(leaf: Leaf): Uint8Array {
  const codes = leaf.codes
  const ticks = new Uint8Array(codes.length)
  const later = new Set<number>()
  let end = codes.length
  while (end > 0) {
    if (codes[end - 1] !== 96) {
      // C2-B-138: no code span reaches across a comment-only line, so the runs behind it close none before it.
      if (startsCommentLine(leaf, end - 1)) later.clear()
      end--
      continue
    }
    let start = end - 1
    while (start > 0 && codes[start - 1] === 96) start--
    tickRun(leaf, ticks, start, end, later)
    end = start
  }
  return ticks
}

/** Whether the unit `at` starts the comment of a comment-only line: a line comment of the tree behind a line feed. */
function startsCommentLine(leaf: Leaf, at: number): boolean {
  if (leaf.kinds[at] === TEXT || leaf.owners[at]?.type !== 'comment' || leaf.codes[at] !== 37) return false
  if (leaf.owners[at - 1] === leaf.owners[at]) return false
  let before = at - 1
  while (leaf.codes[before] === 32 || leaf.codes[before] === 9) before--
  return before < 0 || leaf.codes[before] === LF
}

function tickRun(leaf: Leaf, ticks: Uint8Array, start: number, end: number, later: Set<number>): void {
  const length = end - start
  let text = 0
  for (let at = start; at < end; at++) if (leaf.kinds[at] === TEXT) text++
  if (text === 0 || text < length || leaf.kinds[start - 1] === ESCAPE) {
    if (text > 0) ticks.fill(TICK_UNDECIDED, start, end)
    later.add(length)
    return
  }
  let escapes = 0
  while (escapes < length && later.has(length - escapes)) escapes++
  ticks.fill(TICK_ESCAPED, start, start + escapes)
  ticks.fill(TICK_BARE, start + escapes, end)
  if (escapes > 1) later.add(1)
  later.add(escapes === 0 ? length : length - escapes + 1)
}

function backtick(leaf: Leaf, at: number, escaped: Uint8Array): void {
  if (isLiteral(leaf, at, escaped)) return
  // C2-B-169: in a cell the run is read against the pipes of its row, so a later cell can close it.
  if (leaf.inCell) return undecide(leaf, 'backtick in a cell')
  leaf.ticks ??= tickPlan(leaf)
  const decision = leaf.ticks[at]
  if (decision === TICK_BARE) return
  // C2-W-091: bare, the run would pair with a later code span of the tree and shift it, and the procedure escapes
  // what that shift uncovers first. Behind a delimiter of text, the construct that delimiter opens bare may come first.
  if (decision === TICK_UNDECIDED) undecide(leaf, 'backtick glued')
  else if (leaf.lastAtomTick > at && !opensFirst(leaf, at)) undecide(leaf, 'backtick before a code span')
  else if (leaf.textMark) undecide(leaf, 'backtick in a mark')
  else escaped[at] = 1
}

/**
 * C2-W-088, C2-W-091: bare, the text backtick at `at` pairs with a later run and shifts what lies behind it. Where
 * nothing before it can open a construct, no mark of the tree is open and no sigil is glued to it, the code span it
 * opens is the leftmost construct the tree does not hold, so the procedure escapes it first, as the plan does.
 */
function opensFirst(leaf: Leaf, at: number): boolean {
  const before = code(leaf, at - 1)
  return leaf.openDepth === 0 && before !== 33 && before !== 36
}

/** The run of `value` at `at` and its length. */
function runLength(leaf: Leaf, at: number, value: number): number {
  let end = at
  while (code(leaf, end) === value) end++
  return end - at
}

/** C2-W-092: whether the content line that starts at `at` can read as a block opener. */
function opensBlock(leaf: Leaf, at: number): boolean {
  const first = code(leaf, at)
  if (first === SPACE || first === TAB) return true
  if (first < 0 || first >= 128) return false
  if (isAsciiAlphanumeric(first)) return orderedMarker(leaf, at)
  if (first === 46) return isSpace(code(leaf, at + 1))
  if (LINE_TRIGGERS[first] === 0) return false
  return lineOpener(leaf, at, first)
}

/** C2-B-036: a number, a letter or a numeral before `.` or `)` and a space. */
function orderedMarker(leaf: Leaf, at: number): boolean {
  let end = at
  while (end - at < 10 && isAsciiAlphanumeric(code(leaf, end))) end++
  const after = code(leaf, end)
  return (after === 46 || after === 41) && isSpace(code(leaf, end + 1))
}

function lineEndsWith(leaf: Leaf, at: number, value: number): boolean {
  let end = at
  while (end < leaf.codes.length && leaf.codes[end] !== LF) end++
  while (end > at && (code(leaf, end - 1) === SPACE || code(leaf, end - 1) === TAB)) end--
  return code(leaf, end - 1) === value
}

function lineOpener(leaf: Leaf, at: number, first: number): boolean {
  const next = code(leaf, at + 1)
  switch (first) {
    case 35:
    case 61: return isSpace(code(leaf, at + runLength(leaf, at, first)))
    case 62:
    case 94: return isSpace(next)
    case 42: return isSpace(next) || next === 42 || next === 91
    case 58: return isSpace(next) || next === 58
    case 96: return next === 96
    case 37: return next === 37
    // C2-B-090: a braced opener is no attribute block, so it opens no attribute line.
    case 123: return !nextIs(leaf, at, '*+,-/^~=') && lineEndsWith(leaf, at, 125)
    case 91: return definitionShape(leaf, at)
    default: return true
  }
}

/** C2-B-081: a label and a colon at the start of a line. */
function definitionShape(leaf: Leaf, at: number): boolean {
  for (let unit = at; unit < leaf.codes.length && leaf.codes[unit] !== LF; unit++) {
    if (leaf.codes[unit] === 93 && code(leaf, unit + 1) === 58) return true
  }
  return false
}

/**
 * C2-B-123, C2-B-125: a line of a line block opens nothing but the closer, a bare run of three or more colons; the
 * spaces that lead it are content (C2-B-130). A tab meets the strip of C2-B-027, and a line of spaces alone is the
 * blank line between two stanzas (C2-B-131): those the plan leaves.
 */
function mayCloseLineBlock(leaf: Leaf): boolean {
  let at = 0
  while (code(leaf, at) === SPACE) at++
  const first = code(leaf, at)
  if (first < 0 || first === LF || first === TAB) return true
  if (first !== 58) return false
  const end = runLength(leaf, at, 58) + at
  let rest = end
  while (code(leaf, rest) === SPACE || code(leaf, rest) === TAB) rest++
  return end - at >= 3 && (code(leaf, rest) < 0 || code(leaf, rest) === LF)
}

/** C2-W-092: the line starts of a paragraph by the rules of write-plan-lines.ts; of any other leaf, none may open a block. */
function checkLines(leaf: Leaf, start: number, place: LeafPlace | undefined, escaped: Uint8Array): void {
  const rules = lineRules(start, place)
  const line = place?.line === true && start === LINE_START
  for (let at = -1; at < leaf.codes.length && leaf.undecided === null; at++) {
    leaf.cursor = Math.max(at, 0)
    if (at < 0 ? start !== LINE_START : leaf.codes[at] !== LF || leaf.kinds[at] === TEXT) continue
    if (line && at < 0) undecidedIf(mayCloseLineBlock(leaf), leaf, 'line start')
    else if (rules === null) undecidedIf(opensBlock(leaf, at + 1), leaf, 'line start')
    else checkLine(leaf, at, rules, escaped)
  }
}

/** The place whose line rules a leaf follows: a paragraph from its first line, a term on its later lines (C2-B-069). */
function lineRules(start: number, place: LeafPlace | undefined): LeafPlace | null {
  if (place === undefined) return null
  return (place.paragraph && start === LINE_START) || place.term ? place : null
}

function checkLine(leaf: Leaf, at: number, rules: LeafPlace, escaped: Uint8Array): void {
  const escape = lineEscape(leaf, at + 1, at < 0, rules)
  if (escape === UNDECIDED) undecide(leaf, `line start ${String.fromCharCode(code(leaf, at + 1))}`)
  else if (escape >= 0) escaped[escape] = 1
}

/** C2-I-090, C2-W-125 six: a mention or a tag forms after a boundary, and a name character behind it lengthens it. */
function checkAtom(leaf: Leaf, at: number, node: Node): void {
  const type = node.type
  if (type === 'mention' || type === 'tag' || type === 'symbol' || type === 'caption_number') {
    const before = code(leaf, at - 1)
    if ((before >= 0 && isWordCharacter(before)) || behindBracedComment(leaf, at)) return undecide(leaf, 'sigil boundary')
  }
  if (type === 'smart_punctuation') checkSmart(leaf, at, node)
  undecidedIf(type === 'abbreviation', leaf, type)
}

function atomEnd(leaf: Leaf, at: number): number {
  let end = at
  while (end < leaf.codes.length && leaf.kinds[end] === ATOM && leaf.owners[end] === leaf.owners[at]) end++
  return end
}

/** C2-W-125 six: a unit of text behind an atom that would lengthen it. */
function checkAtomEnd(leaf: Leaf, end: number, node: Node): void {
  const next = code(leaf, end)
  if (next < 0 || leaf.kinds[end] !== TEXT) return
  const type = node.type
  if (type === 'mention' || type === 'tag' || type === 'caption_number') {
    undecidedIf(isAsciiAlphanumeric(next) || next === 95 || next === 45 || next === 46, leaf, 'sigil end')
  } else if (type === 'code' || type === 'literal_inline' || type === 'math' || type === 'raw_inline') {
    undecidedIf(next === 96, leaf, 'code end')
  }
}

function isLineEndAfterCr(codes: readonly number[], at: number): boolean {
  return at === codes.length || codes[at] === LF
}

/**
 * C2-W-016: a CR before a line end joins it, in text and in the value of an atom alike, so no spelling keeps it. Each
 * such CR is reported, one entry per CR so the writer can tell that every line it ends with a CR is one the plan
 * reported, and taken out of the leaf, which is then read as the reader reads its lines. Returns the backslashes of
 * text left before a line end that way, which are doubled, as the reader would take them for a hard break.
 */
function dropLineEndCrs(leaf: Leaf): number[] {
  const doubled: number[] = []
  const ends: number[] = []
  for (let at = 0; at < leaf.codes.length; at++) if (leaf.codes[at] === CR && isLineEndAfterCr(leaf.codes, at + 1)) ends.push(at)
  for (const at of ends.reverse()) {
    leaf.lostValues.push(leaf.owners[at]!)
    for (const list of [leaf.codes, leaf.kinds, leaf.owners, leaf.offsets] as unknown[][]) list.splice(at, 1)
    shiftDown(doubled)
    if (code(leaf, at - 1) === BACKSLASH && leaf.kinds[at - 1] === TEXT) doubled.push(at - 1)
  }
  if (ends.length > 0) relocate(leaf)
  return doubled
}

function shiftDown(units: number[]): void {
  for (let at = 0; at < units.length; at++) units[at]!--
}

/** The last backtick of an atom and the last bracket, after units were taken out of the leaf. */
function relocate(leaf: Leaf): void {
  leaf.lastAtomTick = -1
  for (let at = 0; at < leaf.codes.length; at++) if (leaf.codes[at] === 96 && leaf.kinds[at] === ATOM) leaf.lastAtomTick = at
  leaf.lastBracket = leaf.codes.lastIndexOf(93)
}

function scanUnits(leaf: Leaf, escaped: Uint8Array): void {
  const codes = leaf.codes
  for (let at = 0; at < codes.length && leaf.undecided === null; at++) {
    leaf.cursor = at
    const kind = leaf.kinds[at]
    if (kind === ATOM && !continuesAtom(leaf, at)) {
      const node = leaf.owners[at]!
      checkAtom(leaf, at, node)
      checkAtomEnd(leaf, atomEnd(leaf, at), node)
      continue
    }
    if (kind === OPEN) openMark(leaf, at)
    else if (kind === CLOSE) leaf.openDepth--
    else if (kind === TEXT) at = textUnit(leaf, at, escaped) - 1
  }
}

/**
 * C2-I-043: a valid attribute block comes first at a brace, and `{_` may open one, since a key may start with `_`
 * (C2-I-030). A braced underline whose source reads as a block is left to the repair.
 */
function openMark(leaf: Leaf, at: number): void {
  leaf.openDepth++
  if (leaf.codes[at] !== 123 || code(leaf, at + 1) !== 95) return
  let end = at
  while (end < leaf.codes.length && leaf.codes[end] !== LF) end++
  const text = String.fromCharCode(...leaf.codes.slice(at, end))
  undecidedIf(readAttributeBlock(text, 0, text.length, emptyMemo(), null) >= 0, leaf, 'attribute block')
}

/** Decides the unit of text at `at` by its resolver. Returns the unit behind what it decided. */
function textUnit(leaf: Leaf, at: number, escaped: Uint8Array): number {
  const value = leaf.codes[at]!
  // A line feed of text is left to the reparse.
  if (value === LF) undecide(leaf, 'control')
  if (value >= 128 || INLINE_TRIGGERS[value] === 0) return at + 1
  const block = value === 123 ? attributeBlockEnd(leaf, at, escaped) : -1
  if (block >= 0 && behindHost(leaf, at)) hostBlockEscape(leaf, at, block, escaped)
  else if (block >= 0) return opaqueBlock(leaf, at, block)
  RESOLVERS[String.fromCharCode(value)]?.(leaf, at, escaped)
  if (DELIMITER_CHARACTERS.includes(String.fromCharCode(value))) leaf.textMark = true
  // Escaped or not: the procedure reaches a later unit with this one still bare.
  if (TEXT_OPENERS.includes(String.fromCharCode(value)) && leaf.kinds[at - 1] !== ESCAPE) leaf.textOpener = true
  return at + 1
}

// C2-I-028: a valid attribute block stands on one line; a longer stretch is left to the repair.
const LONGEST_BLOCK = 256
const DELIMITER_CHARACTERS = '*+,-/=^_~{'
// The characters of text that can open a construct whose end lies further on.
const TEXT_OPENERS = '*+,-/=^_~{[<!$:@#%&`"\''

/**
 * C2-I-043: the end of the valid attribute block that the text brace at `at` opens, or -1. A quoted value may hold a
 * closing brace (C2-I-033), so the reader's grammar reads the line, not the text up to the first `}`.
 */
function attributeBlockEnd(leaf: Leaf, at: number, escaped: Uint8Array): number {
  if (isLiteral(leaf, at, escaped)) return -1
  let end = at + 1
  let closes = false
  for (; end < leaf.codes.length && end - at < LONGEST_BLOCK && leaf.codes[end] !== LF; end++) closes ||= leaf.codes[end] === 125
  if (!closes) return -1
  const text = String.fromCharCode(...leaf.codes.slice(at, end))
  const block = readAttributeBlock(text, 0, text.length, emptyMemo(), null)
  return block < 0 ? -1 : at + block
}

/** C2-I-028, C2-W-090: a valid block of text behind a host would attach to it, so its brace takes the backslash. */
function hostBlockEscape(leaf: Leaf, at: number, end: number, escaped: Uint8Array): void {
  if (!isHost(leaf, at)) return undecide(leaf, 'attribute block')
  for (let unit = at; unit < end; unit++) if (leaf.kinds[unit] !== TEXT || escaped[unit] !== 0) return undecide(leaf, 'attribute block')
  escaped[at] = 1
}

/**
 * C2-I-005, C2-I-036: a valid attribute block is an atom, so nothing in it is read; behind no host it is literal
 * text. Its units become opaque for the pairs and the brackets. Returns the unit behind it.
 */
function opaqueBlock(leaf: Leaf, at: number, end: number): number {
  leaf.opaque ??= new Uint8Array(leaf.codes.length)
  for (let unit = at; unit < end; unit++) {
    if (leaf.kinds[unit] !== TEXT) {
      undecide(leaf, 'attribute block')
      return end
    }
    leaf.opaque[unit] = 1
  }
  return end
}

// C2-B-190: the containers that count toward the block cap.
const BLOCK_CAP_CONTAINERS: readonly string[] = [
  'block_quote', 'list', 'list_item', 'definition_list', 'definition_description', 'footnote', 'div', 'admonition', 'directive',
  'figure_group', 'line_block',
]

/** Records where every list of nodes below `nodes` stands, and the blocks whose spelling the plan does not check. */
export function notePlaces(plan: Plan, nodes: readonly Node[], first: boolean): void {
  const pending: Pending[] = [[nodes, 0, 0, TOP_PLACE]]
  for (;;) {
    const item = pending.pop()
    if (item === undefined) return
    for (let at = 0; at < item[0].length; at++) noteNode(plan, pending, item, at, first)
  }
}

/** A list of nodes with its nesting below the group, the number of containers around it (C2-B-190), and its place. */
type Pending = [readonly Node[], number, number, LeafPlace]

function noteNode(plan: Plan, pending: Pending[], [list, depth, containers, place]: Pending, at: number, first: boolean): void {
  const node = list[at]!
  const shape = blockShape(node, containers)
  if (shape !== null && plan.undecided === null) plan.undecided = shape
  const inner = innerPlace(node, place, at > 0 ? list[at - 1]!.type : null)
  inner.documentStart = first && depth === 0 && at === 0
  const below = containers + (BLOCK_CAP_CONTAINERS.includes(node.type) ? 1 : 0)
  // Long quote prefixes can keep a multiline image alive past the modeled leaf boundary.
  if (below > MAX_DEPTH / 2 && node.type === 'image' && plan.undecided === null) plan.undecided = 'deep image'
  inner.capped = below >= MAX_DEPTH
  forEachSlot(node, (children) => {
    plan.places.set(children, inner)
    pending.push([children, depth + 1, below, inner])
  })
}

/** True when `children` is one node for which `test` holds, besides comments and breaks, as the reader tests it. */
function holdsOnly(children: readonly Node[], test: (node: Node) => boolean): boolean {
  let found = 0
  for (const child of children) {
    if (test(child)) found++
    else if (child.type !== 'comment' && child.type !== 'soft_break' && child.type !== 'hard_break') return false
  }
  return found === 1
}

/**
 * A block whose spelling the plan does not check, or null. C2-B-157, C2-B-158: a paragraph of one image or one
 * display math and no role may read back with one. A footnote reads the columns of a container on its first line
 * from behind its label, where the writer indents by two, so only a paragraph is planned there.
 */
function blockShape(node: Node, level: number): string | null {
  // C2-B-190: past the block cap the opener of a container is text, so a supplied container there has no spelling.
  if (level >= MAX_DEPTH && BLOCK_CAP_CONTAINERS.includes(node.type)) return 'block depth cap'
  if (node.type === 'paragraph' && node.role === undefined && holdsOnly(node.children,
    (child) => child.type === 'image' || (child.type === 'math' && child.display))) return 'block role'
  if (node.type === 'footnote' && node.children.length > 0 && node.children[0]!.type !== 'paragraph') return 'footnote container'
  return null
}

const TOP_PLACE: LeafPlace = {
  paragraph: false, inItem: false, inQuote: false, inDescriptionList: false, nested: false, item: null, before: null, documentStart: false,
  line: false, term: false, capped: false,
}

/** The place of the slots of `node`, which stands in `place` behind a block of the type `before`. */
function innerPlace(node: Node, place: LeafPlace, before: string | null): LeafPlace {
  const type = node.type
  return {
    paragraph: type === 'paragraph',
    // C2-B-020: inside a quote, a list marker no longer interrupts the paragraph of the item around it.
    inItem: type !== 'block_quote' && (place.inItem || type === 'list_item' || type === 'definition_description' || type === 'footnote'),
    inQuote: place.inQuote || type === 'block_quote',
    inDescriptionList: place.inDescriptionList || type === 'definition_list',
    nested: place.nested || type !== 'paragraph',
    item: node.type === 'list_item' ? (node.task === undefined ? 'plain' : 'task') : type === 'paragraph' ? place.item : null,
    before,
    documentStart: false,
    line: type === 'line',
    term: type === 'definition_term',
    capped: false,
  }
}

function analyze(w: Writer, leaf: Leaf, start: number, flags: number, place: LeafPlace | undefined): Uint8Array {
  const doubled = dropLineEndCrs(leaf)
  const escaped = new Uint8Array(leaf.codes.length)
  for (const at of doubled) escaped[at] = 1
  leaf.inCell = (flags & IN_CELL) !== 0
  leaf.inTitle = start === IN_TITLE
  leaf.inLine = place?.line === true
  if (w.abbreviations.size > 0) undecide(leaf, 'abbreviations')
  if (leaf.undecided === null) checkLines(leaf, (flags & IN_CELL) !== 0 ? AFTER_MARK : start, place, escaped)
  if (leaf.undecided === null) scanUnits(leaf, escaped)
  if (leaf.undecided === null) checkBrackets(leaf, escaped, w.linkKeys.size > 0)
  if (leaf.undecided === null) bracesBeforeMarks(leaf, escaped)
  if (leaf.undecided === null) checkPairs(leaf, escaped)
  if (leaf.undecided === null) percentsBehindOpeners(leaf, escaped)
  if (leaf.undecided === null) commentsBeforeClosers(leaf, escaped)
  return escaped
}

/**
 * C2-I-024: a line comment directly followed by the closer of a node of the tree ends before it only where that node
 * is a bracket or a braced form, which the spelling of the node decides; the plan leaves such a group to the repair.
 */
function commentsBeforeClosers(leaf: Leaf, escaped: Uint8Array): void {
  for (let at = 1; at < leaf.codes.length; at++) {
    const before = leaf.owners[at - 1]
    if (before?.type !== 'comment' || before.form !== 'line' || leaf.owners[at] === before) continue
    if (leaf.kinds[at] === CLOSE ? !closesAfterComment(leaf, at, escaped) : endsAComment(leaf, at, escaped)) {
      return undecide(leaf, 'comment before a closer')
    }
  }
}

/** The `[` before `at` that the reader reads as brackets and that no `]` before `at` closes. */
function openBrackets(leaf: Leaf, at: number, escaped: Uint8Array): number {
  let depth = 0
  for (let unit = 0; unit < at; unit++) {
    const kind = leaf.kinds[unit]
    if (kind !== OPEN && kind !== CLOSE && (kind !== TEXT || isLiteral(leaf, unit, escaped))) continue
    if (leaf.codes[unit] === 91) depth++
    else if (leaf.codes[unit] === 93 && depth > 0) depth--
  }
  return depth
}

/**
 * Whether the comment ends before the closing mark at `at`: a bracket, or the closer of a braced form where no
 * bracket of text the reader reads is open, which would be the innermost form.
 */
function closesAfterComment(leaf: Leaf, at: number, escaped: Uint8Array): boolean {
  if (leaf.codes[at] === 93) return openTextBraces(leaf, at, escaped) === 0
  return (leaf.codes[at] === 125 || leaf.codes[at + 1] === 125) && openTextBrackets(leaf, at, escaped) === 0
}

/** The braced openers of text the reader reads before `at` that no closer of their mark closes. */
function openTextBraces(leaf: Leaf, at: number, escaped: Uint8Array): number {
  const open: number[] = []
  for (let unit = 1; unit < at; unit++) {
    if (leaf.kinds[unit] !== TEXT || leaf.kinds[unit - 1] !== TEXT || isLiteral(leaf, unit, escaped)) continue
    const mark = leaf.codes[unit]!
    if (!BRACED_MARKS.includes(String.fromCharCode(mark))) continue
    if (leaf.codes[unit - 1] === 123 && !isLiteral(leaf, unit - 1, escaped)) open.push(mark)
    else if (leaf.codes[unit + 1] === 125 && open.includes(mark)) open.splice(open.lastIndexOf(mark), 1)
  }
  return open.length
}

/** The `[` of text the reader reads as brackets before `at` that no `]` closes. */
function openTextBrackets(leaf: Leaf, at: number, escaped: Uint8Array): number {
  let depth = 0
  for (let unit = 0; unit < at; unit++) {
    if (leaf.kinds[unit] !== TEXT || isLiteral(leaf, unit, escaped)) continue
    if (leaf.codes[unit] === 91) depth++
    else if (leaf.codes[unit] === 93 && depth > 0) depth--
  }
  return depth
}

/**
 * Whether text behind a comment starts with a braced closer, or with a bracket that the comment would take: one no
 * bracket the reader reads is open at.
 */
function endsAComment(leaf: Leaf, at: number, escaped: Uint8Array): boolean {
  if (leaf.kinds[at] !== TEXT || leaf.codes[at] === LF) return false
  if (leaf.codes[at] === 93) return openBrackets(leaf, at, escaped) === 0
  return BRACED_MARKS.includes(String.fromCharCode(leaf.codes[at]!)) && leaf.codes[at + 1] === 125
}

function record(plan: Plan, leaf: Leaf, escaped: Uint8Array): void {
  for (let at = 0; at < leaf.codes.length; at++) {
    const owner = leaf.owners[at]!
    if (leaf.kinds[at] === TEXT && owner.type === 'text') plan.covered.add(owner)
    if (escaped[at] === 0 || owner.type !== 'text') continue
    const list = plan.escapes.get(owner)
    if (list === undefined) plan.escapes.set(owner, [leaf.offsets[at]!])
    else list.push(leaf.offsets[at]!)
  }
}

/**
 * The hook of every inline leaf: `content` is what the writer wrote for `nodes`. While a group is
 * planned, the leaf is modelled, compared with `content` and analysed. Returns `content`.
 */
export function planLeaf(w: Writer, nodes: readonly Node[], flags: number, content: string, end: number, start: number): string {
  const plan = w.plan
  if (plan === null || plan.undecided !== null) return content
  const leaf = createLeaf()
  if (end === AS_CONTENT) modelContent(w, leaf, nodes, flags)
  else modelInlines(w, leaf, nodes, flags)
  if (end === AS_LINE && leaf.codes.length > 0) {
    if (leaf.codes[leaf.codes.length - 1] !== LF) undecide(leaf, 'line end')
    trimLast(leaf)
    leaf.codes.push(BACKSLASH)
    leaf.kinds.push(ATOM)
    leaf.owners.push(nodes[nodes.length - 1]!)
    leaf.offsets.push(-1)
  }
  if (leaf.undecided === null && leafText(leaf) !== content) undecide(leaf, 'model')
  if (!plan.places.has(nodes)) undecide(leaf, 'place')
  const escaped = leaf.undecided === null ? analyze(w, leaf, start, flags, plan.places.get(nodes)) : new Uint8Array(0)
  plan.leaves++
  if (leaf.undecided !== null) {
    plan.undecided = leaf.undecided
    const text = leafText(leaf)
    const before = JSON.stringify(text.slice(Math.max(0, leaf.where - 16), leaf.where))
    plan.detail = `${before} | ${JSON.stringify(text.slice(leaf.where, leaf.where + 16))}`
  } else {
    record(plan, leaf, escaped)
    plan.lost.push(...leaf.lostValues)
  }
  plan.respell.push(...leaf.respell)
  return content
}

/** A leaf the planner does not model: the group it stands in is undecided. */
export function unplanned(w: Writer, why: string): void {
  if (w.plan === null || w.plan.undecided !== null) return
  w.plan.undecided = why
}

export { OPEN }
