// C2-W-092: the start of each content line of a planned leaf, tested for reading as a block opener
// or an interrupter. A rule gives the unit that takes the backslash (C2-W-090), no escape, or no
// decision. The first line of a paragraph and its later lines have rules of their own, and so do
// lines inside an item, a description or a footnote body (C2-B-015) and inside a quote.
import { isImageOnly } from './image-line.ts'
import { isAbbreviation, isAttributeLine, isDefinition, taskBoxEnd } from './lines.ts'
import { ATOM, ESCAPE, type Leaf, TEXT } from './write-plan-model.ts'

/** Where the leaf stands, as far as its line starts depend on it. */
export interface LeafPlace {
  /** The leaf is the content of a paragraph or a line, whose first unit starts a content line. */
  paragraph: boolean
  /** Inside an item, a description or a footnote body: a list marker opens on every line. */
  inItem: boolean
  inQuote: boolean
  inDescriptionList: boolean
  /** Inside any container: a definition does not open there (C2-B-081). */
  nested: boolean
  /** The leaf is the content of a list item, which has a task box or not (C2-B-046), or null. */
  item: 'plain' | 'task' | null
  /** The type of the block before the paragraph, or null. */
  before: string | null
  /** The leaf starts the document: its first line is line 1. */
  documentStart: boolean
  /** The leaf is a line of a line block, which recognizes only prefixes and the closer (C2-B-123). */
  line: boolean
  /** The leaf is a term, whose later lines continue like paragraph text (C2-B-069). */
  term: boolean
}

export const NO_ESCAPE = -1
export const UNDECIDED = -2

const LF = 10
const SPACE = 32
const BRACE_OPEN = 123
const TAB = 9

function code(leaf: Leaf, at: number): number {
  return at >= 0 && at < leaf.codes.length ? leaf.codes[at]! : -1
}

function isBlank(value: number): boolean {
  return value === SPACE || value === TAB
}

function isLineEnd(value: number): boolean {
  return value === LF || value === -1
}

function runEnd(leaf: Leaf, at: number, value: number): number {
  let end = at
  while (code(leaf, end) === value) end++
  return end
}

/** Whether a blank and some content follow `at` on its line: the content a list marker needs. */
function hasContentBehind(leaf: Leaf, at: number): boolean {
  if (code(leaf, at) !== SPACE) return false
  let end = at
  while (isBlank(code(leaf, end))) end++
  return !isLineEnd(code(leaf, end))
}

/** Whether only blanks follow `at` on its line. */
function restIsBlank(leaf: Leaf, at: number): boolean {
  let end = at
  while (isBlank(code(leaf, end))) end++
  return isLineEnd(code(leaf, end))
}

function lineEndsWith(leaf: Leaf, at: number, value: number): boolean {
  let end = at
  while (end < leaf.codes.length && leaf.codes[end] !== LF) end++
  while (end > at && isBlank(code(leaf, end - 1))) end--
  return end - 1 > at && code(leaf, end - 1) === value
}

/** C2-B-151, C2-B-152: one to six `=` or `#` and a blank start a heading. */
function heading(leaf: Leaf, at: number, value: number): number {
  const end = runEnd(leaf, at, value)
  if (end - at > 6) return NO_ESCAPE
  if (code(leaf, end) === SPACE) return at
  if (code(leaf, end) === TAB) return UNDECIDED
  return isLineEnd(code(leaf, end)) ? UNDECIDED : NO_ESCAPE
}

/** C2-B-036: a number of one to nine digits before `.` or `)` and content is an ordered marker; the mark takes the backslash. */
function digits(leaf: Leaf, at: number): number {
  let end = at
  while (code(leaf, end) >= 48 && code(leaf, end) <= 57) end++
  const mark = code(leaf, end)
  if (end - at > 9 || (mark !== 46 && mark !== 41)) return NO_ESCAPE
  // C2-B-101: the attributes of an item abut its marker.
  if (code(leaf, end + 1) === BRACE_OPEN) return UNDECIDED
  // C2-B-033: a bare marker is text.
  return hasContentBehind(leaf, end + 1) ? end : NO_ESCAPE
}

/** C2-B-015: a bullet and content. */
function bullet(leaf: Leaf, at: number): number {
  // C2-B-101: the attributes of an item abut its marker.
  if (code(leaf, at + 1) === BRACE_OPEN) return UNDECIDED
  // C2-B-033: a bare marker is text.
  return hasContentBehind(leaf, at + 1) ? at : NO_ESCAPE
}

/** C2-B-014, C2-B-159, C2-B-166: what opens on every line: a fence run, a star run alone, a table row. */
function anyLine(leaf: Leaf, at: number, value: number): number {
  const end = runEnd(leaf, at, value)
  if (value === 96) return end - at >= 3 && !tickBehind(leaf, end) ? at : NO_ESCAPE
  if (value === 58) return end - at < 3 ? NO_ESCAPE : divLine(leaf, at, end)
  if (value === 37) return end - at < 3 ? NO_ESCAPE : fence(leaf, at, end)
  if (value === 42) return end - at >= 3 && restIsBlank(leaf, end) ? at : NO_ESCAPE
  if (value === 124) return pipeLine(leaf, at)
  return NO_ESCAPE
}

/** C2-B-118: a backtick in the info string makes the run no fence opener. */
function tickBehind(leaf: Leaf, from: number): boolean {
  for (let at = from; !isLineEnd(code(leaf, at)); at++) if (code(leaf, at) === 96) return true
  return false
}

/** C2-B-119, C2-B-196: a colon run is a div line where spaces or the line end follow it, or only blanks; glued to a name, it is text. */
function divLine(leaf: Leaf, at: number, end: number): number {
  let after = end
  while (code(leaf, after) === SPACE) after++
  if (isLineEnd(code(leaf, after))) return at
  // C2-B-033: a tab before further text leaves the line text.
  if (code(leaf, after) !== TAB) return after > end ? at : NO_ESCAPE
  while (isBlank(code(leaf, after))) after++
  return isLineEnd(code(leaf, after)) ? at : NO_ESCAPE
}

/** C2-B-014, C2-B-033: a div or a comment fence opens where a blank or the end of the line follows its run. */
function fence(leaf: Leaf, at: number, end: number): number {
  return code(leaf, end) === SPACE || isLineEnd(code(leaf, end)) ? at : UNDECIDED
}

/** C2-B-031: a quote mark before a space or the end of the line. */
function quoteMark(leaf: Leaf, at: number): number {
  const next = code(leaf, at + 1)
  if (next === SPACE || isLineEnd(next)) return at
  return decidedIf(next === TAB)
}

/** C2-B-043: a bare dot opens an item where its content does not start with a dot and a blank. */
function bareDot(leaf: Leaf, at: number): number {
  if (!hasContentBehind(leaf, at + 1)) return NO_ESCAPE
  let content = at + 1
  while (isBlank(code(leaf, content))) content++
  const next = code(leaf, content + 1)
  return code(leaf, content) === 46 && (isBlank(next) || isLineEnd(next)) ? NO_ESCAPE : at
}

/** C2-B-160, C2-B-161: a hyphen run is text, but on line 1 three hyphens open frontmatter. */
function hyphenLine(leaf: Leaf, at: number, place: LeafPlace): number {
  const end = runEnd(leaf, at, 45)
  if (end - at < 3 || !place.documentStart) return bullet(leaf, at)
  for (let unit = at; unit < end; unit++) if (leaf.kinds[unit] !== TEXT) return UNDECIDED
  return bullet(leaf, at)
}

/** C2-B-166, C2-B-167: a table row ends with a pipe, a row attribute or a line comment may follow it. */
function pipeLine(leaf: Leaf, at: number): number {
  if (lineEndsWith(leaf, at, 124)) return at
  for (let unit = at + 1; unit < leaf.codes.length && leaf.codes[unit] !== LF; unit++) {
    if (leaf.codes[unit] === 124 && mayCloseRow(leaf, unit + 1)) return UNDECIDED
  }
  return NO_ESCAPE
}

/** C2-B-167: behind a closing pipe only a brace block, glued or after a space, or a line comment after whitespace may follow. */
function mayCloseRow(leaf: Leaf, at: number): boolean {
  let unit = at
  while (isBlank(code(leaf, unit))) unit++
  const value = code(leaf, unit)
  return value === 123 || isLineEnd(value) || (unit > at && value === 37)
}

/** C2-B-133: a line comment at the start of a line. */
function percent(leaf: Leaf, at: number): number {
  return code(leaf, at + 1) === 37 ? at : NO_ESCAPE
}

/** The rule for the first line of a paragraph, by its first character. */
function firstLine(leaf: Leaf, at: number, place: LeafPlace): number {
  const value = code(leaf, at)
  if (value === 35 || value === 61) return heading(leaf, at, value)
  if (value >= 48 && value <= 57) return digits(leaf, at)
  switch (value) {
    case 62: return quoteMark(leaf, at)
    case 45: return hyphenLine(leaf, at, place)
    case 42: return runEnd(leaf, at, 42) - at >= 3 ? anyLine(leaf, at, 42) : starLine(leaf, at, place)
    case 46: return bareDot(leaf, at)
    case 58: return colon(leaf, at, place)
    default: return otherLine(leaf, at, value, place, true)
  }
}

/** C2-B-016, C2-W-121: a term mark opens a description list; a description mark opens below one. */
function colon(leaf: Leaf, at: number, place: LeafPlace): number {
  const end = runEnd(leaf, at, 58)
  if (end - at >= 3) return divLine(leaf, at, end)
  if (end - at === 2) return code(leaf, end) === SPACE ? at : decidedIf(code(leaf, end) === TAB)
  if (!isBlank(code(leaf, end)) && !isLineEnd(code(leaf, end))) return NO_ESCAPE
  return place.before === 'definition_list' || place.inDescriptionList ? UNDECIDED : NO_ESCAPE
}

/**
 * C2-B-016: a description mark or a term mark opens on every line inside a description list, except that a term mark
 * directly after paragraph text inside an item is a lazy line (C2-B-024).
 */
function laterColon(leaf: Leaf, at: number, place: LeafPlace): number {
  const run = runEnd(leaf, at, 58) - at
  // C2-B-016, C2-B-071: a later term line stands at the content column, not at the list's, so a mark there is text.
  if (place.term && run < 3) return NO_ESCAPE
  return place.inItem && run === 2 ? NO_ESCAPE : colon(leaf, at, place)
}

/** A later line of a paragraph: list markers only inside an item (C2-B-015). */
function laterLine(leaf: Leaf, at: number, place: LeafPlace): number {
  const value = code(leaf, at)
  // C2-B-092: an attribute line is no interrupter, so below a line of the paragraph it is text.
  if (value === 123) return NO_ESCAPE
  if (place.inDescriptionList && value === 58) return laterColon(leaf, at, place)
  // C2-B-036: an ordered marker interrupts a paragraph only with the number 1.
  if (place.inItem && value >= 48 && value <= 57) return value === 49 && code(leaf, at + 1) < 48 ? digits(leaf, at) : NO_ESCAPE
  if (place.inItem && (value === 45 || value === 42 || value === 46)) return firstLine(leaf, at, place)
  if (value === 42 && runEnd(leaf, at, 42) - at < 3) return NO_ESCAPE
  return laterOther(leaf, at, value, place)
}

function laterOther(leaf: Leaf, at: number, value: number, place: LeafPlace): number {
  // C2-B-015: outside an item no list is open for a letter marker to continue.
  if (!place.inItem && isLetter(value)) return NO_ESCAPE
  return otherLine(leaf, at, value, place, false)
}

type LineRule = (leaf: Leaf, at: number, place: LeafPlace, first: boolean) => number

function decidedIf(condition: boolean): number {
  return condition ? UNDECIDED : NO_ESCAPE
}

// C2-B-081, C2-B-046, C2-B-090, C2-B-156, C2-B-146: a definition shape, an attribute line or an include, a caption.
// Each depends on more than its line, so it is left to the repair. A `+` line is text: a continuation row stands
// directly below a row (C2-B-175), and a paragraph line below a blank line (C2-W-017) or paragraph text.
const OTHER_RULES: ReadonlyMap<number, LineRule> = new Map<number, LineRule>([
  [96, (leaf, at) => anyLine(leaf, at, 96)],
  [58, (leaf, at) => anyLine(leaf, at, 58)],
  [42, (leaf, at) => anyLine(leaf, at, 42)],
  [124, (leaf, at) => anyLine(leaf, at, 124)],
  [37, percent],
  [SPACE, () => UNDECIDED],
  [TAB, () => UNDECIDED],
  [91, bracketLine],
  [123, attributeLine],
  [94, caption],
])

/** The rules that hold on the first and on later lines, and the openers left to the repair. */
function otherLine(leaf: Leaf, at: number, value: number, place: LeafPlace, first: boolean): number {
  const rule = OTHER_RULES.get(value)
  if (rule !== undefined) return rule(leaf, at, place, first)
  return decidedIf(letterMarker(leaf, at))
}

/**
 * C2-B-146, C2-B-149: a caption line attaches only directly below an image, a table, a code block, a quote, a math
 * block or a figure group of its container. Below a line of text of the paragraph, or as the first line of the first
 * block of its container, it is text. Below a line that holds a node of the tree, below a line of text that has the
 * shape of a block image line (C2-B-197, decided by shape and not by inline parsing), or below another block, it is
 * left to the repair.
 */
function caption(leaf: Leaf, at: number, place: LeafPlace, first: boolean): number {
  if (!isBlank(code(leaf, at + 1)) && !isLineEnd(code(leaf, at + 1))) return NO_ESCAPE
  if (first) return decidedIf(place.before !== null)
  let unit = at - 2
  for (; unit >= 0 && leaf.codes[unit] !== LF; unit--) {
    if (leaf.kinds[unit] !== TEXT && leaf.kinds[unit] !== ESCAPE) return UNDECIDED
  }
  if (code(leaf, unit + 1) !== 33) return NO_ESCAPE
  let above = ''
  for (let char = unit + 1; char < at - 1; char++) above += String.fromCharCode(leaf.codes[char]!)
  return isImageOnly(above, 0, above.length) ? UNDECIDED : NO_ESCAPE
}

/**
 * C2-B-090, C2-B-091, C2-B-092: a first line that is an attribute line applies to the block the next line starts, so
 * the brace takes the backslash; alone it becomes a paragraph of its text. Stacked attribute lines and lines that
 * hold a node are left to the repair.
 */
function attributeLine(leaf: Leaf, at: number, _place: LeafPlace, first: boolean): number {
  if (isBracedOpener(code(leaf, at + 1)) || !lineEndsWith(leaf, at, 125)) return NO_ESCAPE
  if (!first) return UNDECIDED
  const [line, whole] = textOfLine(leaf, at)
  if (!whole || !isAttributeLine(line, 0, line.length)) return UNDECIDED
  const next = at + line.length + 1
  if (next > leaf.codes.length) return NO_ESCAPE
  const [after, afterWhole] = textOfLine(leaf, next)
  return afterWhole && isAttributeLine(after, 0, after.length) ? UNDECIDED : at
}

function isBracedOpener(value: number): boolean {
  return value >= 0 && '*+,-/^~='.includes(String.fromCharCode(value))
}

function definitionShape(leaf: Leaf, at: number): boolean {
  for (let unit = at; unit < leaf.codes.length && leaf.codes[unit] !== LF; unit++) {
    if (leaf.codes[unit] === 93 && code(leaf, unit + 1) === 58) return true
  }
  return false
}

/**
 * C2-B-081, C2-B-082, C2-B-083: the first line of a paragraph outside every container opens a definition when the
 * reader's definition shape matches it; a later line is a lazy line (C2-B-024). A line that holds a node is left to
 * the repair.
 */
function bracketLine(leaf: Leaf, at: number, place: LeafPlace, first: boolean): number {
  if (!first) return NO_ESCAPE
  if (place.item !== null && place.before === null) return taskBoxLine(leaf, at, place.item)
  if (place.nested || !definitionShape(leaf, at)) return NO_ESCAPE
  // An atom that starts the line takes no backslash; the reader sees its written body.
  if (leaf.kinds[at] === ATOM) return decidedIf(isDefinitionLine(leaf, at))
  const [line, whole] = textOfLine(leaf, at)
  if (!whole) return UNDECIDED
  return isDefinition(line, 0, line.length) ? at : NO_ESCAPE
}

/** C2-B-084, C2-B-081: on the first line outside every container, `*[` opens an abbreviation where its shape matches. */
function starLine(leaf: Leaf, at: number, place: LeafPlace): number {
  if (code(leaf, at + 1) !== 91 || place.nested) return bullet(leaf, at)
  // A node behind the text is content the expansion needs after its space.
  const [line, whole] = textOfLine(leaf, at)
  const shape = whole ? line : `${line}x`
  return isAbbreviation(shape, 0, shape.length) ? at : NO_ESCAPE
}

/** C2-B-046: a task box stands directly after the marker, so only the first line of the first block of an item has one. */
function taskBoxLine(leaf: Leaf, at: number, item: 'plain' | 'task'): number {
  if (code(leaf, at + 2) !== 93) return NO_ESCAPE
  if (item === 'task') return UNDECIDED
  // A node behind the text is content the box needs after its space.
  const [line, whole] = textOfLine(leaf, at)
  const shape = whole ? line : `${line}x`
  return taskBoxEnd(shape, 0, shape.length) >= 0 ? at : NO_ESCAPE
}

function isDefinitionLine(leaf: Leaf, at: number): boolean {
  let end = at
  while (end < leaf.codes.length && leaf.codes[end] !== LF) end++
  const line = String.fromCharCode(...leaf.codes.slice(at, end))
  return isDefinition(line, 0, line.length)
}

/** The text of the line from `at` up to its end or its first unit that is not text, and whether that is the end. */
function textOfLine(leaf: Leaf, at: number): [string, boolean] {
  let end = at
  while (end < leaf.codes.length && leaf.codes[end] !== LF && (leaf.kinds[end] === TEXT || leaf.kinds[end] === ESCAPE)) end++
  return [String.fromCharCode(...leaf.codes.slice(at, end)), end === leaf.codes.length || leaf.codes[end] === LF]
}

const ROMAN_LOWER = 'ivxlcdm'
const ROMAN_UPPER = 'IVXLCDM'

function isLetter(value: number): boolean {
  return (value >= 65 && value <= 90) || (value >= 97 && value <= 122)
}

/** C2-B-036, data/ordered-styles.json: one letter, or two or more roman letters of one case, before `.` or `)` and a blank. */
function letterMarker(leaf: Leaf, at: number): boolean {
  let end = at
  while (end - at < 10 && isLetter(code(leaf, end))) end++
  const after = code(leaf, end)
  if (end === at || end - at > 9 || (after !== 46 && after !== 41)) return false
  if (!isBlank(code(leaf, end + 1)) && !isLineEnd(code(leaf, end + 1))) return false
  if (end - at === 1) return true
  const letters = String.fromCharCode(...leaf.codes.slice(at, end))
  return [...letters].every((char) => ROMAN_LOWER.includes(char)) || [...letters].every((char) => ROMAN_UPPER.includes(char))
}

// C2-W-016: the atoms whose value the reader takes as it stands over a line end, `%%` lines included.
const RAW_VALUES: ReadonlySet<string> = new Set(['code', 'literal_inline', 'math', 'raw_inline', 'critic_comment'])

/** Whether the unit `at` continues the value of a span, a braced or an editorial comment from the line before. */
function insideRawValue(leaf: Leaf, at: number): boolean {
  const owner = leaf.owners[at]
  if (owner === undefined || leaf.kinds[at] !== ATOM || leaf.owners[at - 1] !== owner) return false
  return RAW_VALUES.has(owner.type) || (owner.type === 'comment' && owner.form === 'braced')
}

/** What a line start decides before its first character is read as an opener, or null. */
function lineStartRule(leaf: Leaf, at: number, first: boolean): number | null {
  const owner = leaf.kinds[at] === ATOM && leaf.owners[at - 1] !== leaf.owners[at] ? leaf.owners[at] : undefined
  // C2-B-138, C2-B-137: a comment of the tree at a line start stays a comment of the paragraph, except that a
  // line comment would make the first line a comment-only line.
  if (owner?.type === 'comment') return first && owner.form === 'line' ? UNDECIDED : NO_ESCAPE
  const value = code(leaf, at)
  // C2-B-133, C2-I-014: a `%%` line inside the value of a span that runs over the line end is a line of that value.
  if (value === 37 && insideRawValue(leaf, at)) return NO_ESCAPE
  // C2-B-165: a byte-order mark at the start of the source is skipped.
  if (value === 0xfeff && first) return UNDECIDED
  return value < 0 || value >= 128 ? NO_ESCAPE : null
}

/**
 * The escape the line that starts at `at` needs, NO_ESCAPE, or UNDECIDED. `first` says that the line is the first
 * line of a paragraph. The unit that takes the backslash must be text.
 */
export function lineEscape(leaf: Leaf, at: number, first: boolean, place: LeafPlace): number {
  const start = lineStartRule(leaf, at, first)
  if (start !== null) return start
  const escape = first ? firstLine(leaf, at, place) : laterLine(leaf, at, place)
  if (escape < 0) return escape
  return leaf.kinds[escape] === TEXT && leaf.kinds[escape - 1] !== ESCAPE ? escape : UNDECIDED
}
