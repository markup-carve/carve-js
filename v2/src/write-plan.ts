// The planned escapes of an inline leaf (C2-W-088 to C2-W-099, C2-W-125): every unit of text is
// looked up by its code in the tables of write-tables.ts, and a unit that can start a construct goes
// to the resolver of its context. A resolver returns bare, an escape, or no decision; a leaf with no
// decision is left to the repair of write.ts.
import { type Node, type TextNode } from './ast.ts'
import { isWordCharacter } from './unicode.ts'
import { IN_CELL } from './write-inline.ts'
import {
  ATOM, CLOSE, createLeaf, ESCAPE, type Leaf, leafText, modelContent, modelInlines, OPEN, TEXT, trimLast, undecide,
} from './write-plan-model.ts'
import { checkPairs } from './write-plan-pairs.ts'
import { INLINE_TRIGGERS, LINE_TRIGGERS } from './write-tables.ts'
import { type Writer } from './write-state.ts'

/** What one planned write of a group collects. */
export interface Plan {
  undecided: string | null
  /** The text nodes that a planned leaf holds. */
  covered: Set<TextNode>
  /** The escapes the plan places, by text node, in ascending order. */
  escapes: Map<TextNode, number[]>
  leaves: number
}

export function createPlan(): Plan {
  return { undecided: null, covered: new Set(), escapes: new Map(), leaves: 0 }
}

/** How the caller of a leaf ends it: as `writeContent`, as `writeInlines`, or as a line of a line block. */
export const AS_CONTENT = 0
export const AS_INLINES = 1
export const AS_LINE = 2

/** Where the first unit of a leaf stands: at the start of a content line, or behind a mark on its line. */
export const LINE_START = 1
export const AFTER_MARK = 0

const LF = 10
const SPACE = 32
const TAB = 9
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
  if (code(leaf, at - 1) === 45) return
  let end = at
  while (code(leaf, end) === 45) {
    if (leaf.kinds[end] !== TEXT || isLiteral(leaf, end, escaped)) return undecide(leaf, 'hyphen run')
    end++
  }
  const before = code(leaf, at - 1)
  const after = code(leaf, end)
  if (before === 123 || before === 60 || before === 43 || after === 125 || after === 62) return undecide(leaf, 'hyphen neighbor')
  for (let unit = at + 1; unit < end; unit += 2) escaped[unit] = 1
}

/** C2-W-095: a straight quote of text would read as a smart quote. */
function quote(leaf: Leaf, at: number, escaped: Uint8Array): void {
  if (isLiteral(leaf, at, escaped)) return
  escaped[at] = 1
}

function dots(leaf: Leaf, at: number): void {
  undecidedIf(code(leaf, at + 1) === 46 && code(leaf, at + 2) === 46, leaf, 'dot run')
}

/** C2-I-090: a name of a mention or a tag after a boundary. */
function sigil(leaf: Leaf, at: number): void {
  const before = code(leaf, at - 1)
  if (before >= 0 && isWordCharacter(before)) return
  const next = code(leaf, at + 1)
  undecidedIf(isAsciiAlphanumeric(next) || next === 95 || next === 45 || next === 125, leaf, 'sigil')
}

/** C2-I-093, C2-I-094: a symbol or an inline extension. */
function colon(leaf: Leaf, at: number): void {
  let end = at + 1
  while (end < leaf.codes.length && (isAsciiAlphanumeric(code(leaf, end)) || '+-_'.includes(String.fromCharCode(code(leaf, end))))) end++
  if (end === at + 1) return
  const after = code(leaf, end)
  undecidedIf(after === 58 || after === 91, leaf, 'symbol')
}

function nextIs(leaf: Leaf, at: number, chars: string): boolean {
  const next = code(leaf, at + 1)
  return next >= 0 && chars.includes(String.fromCharCode(next))
}

/** An opening bracket with a closing bracket behind it, or the reverse, may form a construct (C2-W-094). */
function bracket(leaf: Leaf, at: number, escaped: Uint8Array): void {
  if (isLiteral(leaf, at, escaped)) return
  const opening = code(leaf, at) === 91
  const step = opening ? 1 : -1
  const wanted = opening ? 93 : 91
  for (let unit = at + step; unit >= 0 && unit < leaf.codes.length; unit += step) {
    if (code(leaf, unit) === wanted && !isLiteral(leaf, unit, escaped)) return undecide(leaf, 'bracket pair')
  }
  undecidedIf(opening && nextIs(leaf, at, '^'), leaf, 'footnote bracket')
}

/** C2-W-096: a brace that opens a comment or an attribute block; a braced opener is paired in write-plan-pairs.ts. */
function brace(leaf: Leaf, at: number, escaped: Uint8Array): void {
  if (isLiteral(leaf, at, escaped)) return
  const before = leaf.kinds[at - 1]
  if (before === ATOM || before === CLOSE) return undecide(leaf, 'attribute block')
  undecidedIf(nextIs(leaf, at, '%#_='), leaf, 'brace')
}

/** A mark before a closing brace is paired in write-plan-pairs.ts; the other contexts of a mark are table entries. */
function mark(chars: string): Resolver {
  return (leaf, at, escaped) => {
    if (isLiteral(leaf, at, escaped)) return
    undecidedIf(nextIs(leaf, at, chars), leaf, `mark ${String.fromCharCode(code(leaf, at))}`)
  }
}

function always(why: string): Resolver {
  return (leaf, at, escaped) => undecidedIf(!isLiteral(leaf, at, escaped), leaf, why)
}

const RESOLVERS: Readonly<Record<string, Resolver>> = {
  '!': mark('[`='),
  '"': quote,
  '#': (leaf, at, escaped) => { if (!isLiteral(leaf, at, escaped)) sigil(leaf, at) },
  '$': mark('`$'),
  '%': mark('%}'),
  '\'': quote,
  '(': (leaf, at) => undecidedIf(nextIs(leaf, at, 't') && code(leaf, at + 2) === 109, leaf, 'trademark'),
  '*': () => undefined,
  '+': mark('-'),
  ',': () => undefined,
  '-': hyphen,
  '.': (leaf, at, escaped) => { if (!isLiteral(leaf, at, escaped)) dots(leaf, at) },
  '/': () => undefined,
  ':': (leaf, at, escaped) => { if (!isLiteral(leaf, at, escaped)) colon(leaf, at) },
  '<': mark('/-=abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ'),
  '=': mark('=>'),
  '>': mark('='),
  '@': (leaf, at, escaped) => { if (!isLiteral(leaf, at, escaped)) sigil(leaf, at) },
  '[': bracket,
  '\\': () => undefined,
  ']': bracket,
  '^': mark('['),
  '_': () => undefined,
  '`': always('backtick'),
  '{': brace,
  '|': () => undefined,
  '}': () => undefined,
  '~': () => undefined,
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
    case 123: return lineEndsWith(leaf, at, 125)
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

function checkLines(leaf: Leaf, start: number): void {
  if (start === LINE_START && opensBlock(leaf, 0)) return undecide(leaf, 'line start')
  for (let at = 0; at < leaf.codes.length; at++) {
    if (leaf.codes[at] === LF && leaf.kinds[at] !== TEXT && opensBlock(leaf, at + 1)) return undecide(leaf, 'line start')
  }
}

/** C2-I-090, C2-W-125 six: a mention or a tag forms after a boundary, and a name character behind it lengthens it. */
function checkAtom(leaf: Leaf, at: number, node: Node): void {
  const type = node.type
  if (type === 'mention' || type === 'tag' || type === 'symbol' || type === 'caption_number') {
    const before = code(leaf, at - 1)
    if (before >= 0 && isWordCharacter(before)) return undecide(leaf, 'sigil boundary')
  }
  undecidedIf(type === 'smart_punctuation' || type === 'abbreviation', leaf, type)
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
    undecidedIf(next === 96 || next === 123, leaf, 'code end')
  }
}

function scanUnits(leaf: Leaf, escaped: Uint8Array): void {
  const codes = leaf.codes
  for (let at = 0; at < codes.length && leaf.undecided === null; at++) {
    const kind = leaf.kinds[at]
    if (kind === ATOM && leaf.kinds[at - 1] !== ATOM) {
      const node = leaf.owners[at]!
      checkAtom(leaf, at, node)
      checkAtomEnd(leaf, atomEnd(leaf, at), node)
      continue
    }
    if (kind !== TEXT) continue
    const value = codes[at]!
    // C2-W-016: a control character of text, a CR or a line feed among them, is left to the reparse.
    if (value < 32 && value !== TAB) return undecide(leaf, 'control')
    if (value >= 128 || INLINE_TRIGGERS[value] === 0) continue
    RESOLVERS[String.fromCharCode(value)]?.(leaf, at, escaped)
  }
}

function analyze(w: Writer, leaf: Leaf, start: number, flags: number): Uint8Array {
  const escaped = new Uint8Array(leaf.codes.length)
  if (w.abbreviations.size > 0) undecide(leaf, 'abbreviations')
  if (leaf.undecided === null) checkLines(leaf, (flags & IN_CELL) !== 0 ? AFTER_MARK : start)
  if (leaf.undecided === null) scanUnits(leaf, escaped)
  if (leaf.undecided === null) checkPairs(leaf, escaped)
  return escaped
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
  const escaped = leaf.undecided === null ? analyze(w, leaf, start, flags) : new Uint8Array(0)
  plan.leaves++
  if (leaf.undecided !== null) plan.undecided = leaf.undecided
  else record(plan, leaf, escaped)
  return content
}

/** A leaf the planner does not model: the group it stands in is undecided. */
export function unplanned(w: Writer, why: string): void {
  if (w.plan !== null && w.plan.undecided === null) w.plan.undecided = why
}

export { OPEN }
