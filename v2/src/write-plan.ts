// The planned escapes of an inline leaf (C2-W-088 to C2-W-099, C2-W-125): every unit of text is
// looked up by its code in the tables of write-tables.ts, and a unit that can start a construct goes
// to the resolver of its context. A resolver returns bare, an escape, or no decision; a leaf with no
// decision is left to the repair of write.ts.
import { forEachSlot, type Node, type TextNode } from './ast.ts'
import { isWordCharacter } from './unicode.ts'
import { IN_CELL } from './write-inline.ts'
import {
  ATOM, CLOSE, createLeaf, ESCAPE, type Leaf, leafText, modelContent, modelInlines, OPEN, TEXT, trimLast, undecide,
} from './write-plan-model.ts'
import { opensAngleAtom } from './write-plan-angle.ts'
import { checkBrackets } from './write-plan-brackets.ts'
import { checkPairs } from './write-plan-pairs.ts'
import { checkSmart } from './write-plan-smart.ts'
import { type LeafPlace, lineEscape, UNDECIDED } from './write-plan-lines.ts'
import { INLINE_TRIGGERS, LINE_TRIGGERS } from './write-tables.ts'
import { type Writer } from './write-state.ts'

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
  /** C2-I-118: for each list of nodes of the group, twice the number of blocks around it, a bound of its depth. */
  depths: Map<readonly Node[], number>
  /** Where each list of nodes of the group stands, for the rules of its line starts. */
  places: Map<readonly Node[], LeafPlace>
  leaves: number
}

export function createPlan(): Plan {
  return {
    undecided: null, detail: '', covered: new Set(), escapes: new Map(), respell: [], depths: new Map(), places: new Map(), leaves: 0,
  }
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
  if (before === 123 || before === 60 || before === 43 || after === 125 || after === 62) return undecide(leaf, 'hyphen neighbor')
  for (let unit = at + 1; unit < end; unit += 2) escaped[unit] = 1
}

/** C2-W-095: a straight quote of text would read as a smart quote. */
function quote(leaf: Leaf, at: number, escaped: Uint8Array): void {
  if (isLiteral(leaf, at, escaped)) return
  // A quote behind a brace may stand in an attribute, where it reads as itself.
  if (leaf.firstBrace >= 0 && leaf.firstBrace < at) return undecide(leaf, 'quote in braces')
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

/** C2-W-094: an opening bracket before `^` may open a footnote reference; pairs are checked in write-plan-brackets.ts. */
function bracket(leaf: Leaf, at: number, escaped: Uint8Array): void {
  undecidedIf(!isLiteral(leaf, at, escaped) && nextIs(leaf, at, '^'), leaf, 'footnote bracket')
}

/** C2-W-096: a brace that opens a comment or an attribute block; a braced opener is paired in write-plan-pairs.ts. */
function brace(leaf: Leaf, at: number, escaped: Uint8Array): void {
  if (isLiteral(leaf, at, escaped)) return
  const before = leaf.kinds[at - 1]
  // C2-I-028: behind a host the brace may open its attribute block; a braced opener is no attribute block.
  if ((before === ATOM || before === CLOSE) && !nextIs(leaf, at, '*+,-/^~')) return undecide(leaf, 'attribute block')
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
    escaped[at] = 1
    return
  }
  undecidedIf(nextIs(leaf, at, rest), leaf, `sigil ${String.fromCharCode(code(leaf, at))}`)
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
  if (isLiteral(leaf, at, escaped)) return
  if (nextIs(leaf, at, '}')) return undecide(leaf, 'mark %')
  if (!nextIs(leaf, at, '%')) return
  const before = code(leaf, at - 1)
  if (before === 37 || before === 123) return undecide(leaf, 'mark %')
  if (isSpace(before)) escaped[at] = 1
}

const RESOLVERS: Readonly<Record<string, Resolver>> = {
  '!': (leaf, at, escaped) => {
    if (nextIs(leaf, at, '=') && leaf.kinds[at - 1] !== TEXT && at > 0) undecide(leaf, 'sigil !')
    else if (nextIs(leaf, at, '=') && leaf.kinds[at + 1] === TEXT && !isLiteral(leaf, at, escaped)) escaped[at] = 1
    else if (treeBracket(leaf, at + 1) && !opensLink(leaf, at + 1)) undecide(leaf, 'sigil !')
    else gluedSigil(leaf, at, escaped, (l, unit) => opensLink(l, unit) || opensCode(l, unit), '`=')
  },
  '"': quote,
  '#': (leaf, at, escaped) => { if (!isLiteral(leaf, at, escaped)) sigil(leaf, at) },
  '$': (leaf, at, escaped) => gluedSigil(leaf, at, escaped, opensCode, '`$'),
  '%': percent,
  '\'': quote,
  '(': (leaf, at) => undecidedIf(nextIs(leaf, at, 't') && code(leaf, at + 2) === 109, leaf, 'trademark'),
  '*': () => undefined,
  '+': mark('-'),
  ',': () => undefined,
  '-': hyphen,
  '.': (leaf, at, escaped) => { if (!isLiteral(leaf, at, escaped)) dots(leaf, at) },
  '/': () => undefined,
  ':': (leaf, at, escaped) => { if (!isLiteral(leaf, at, escaped)) colon(leaf, at) },
  '<': angle,
  '=': mark('=>'),
  '>': mark('='),
  '@': (leaf, at, escaped) => { if (!isLiteral(leaf, at, escaped)) sigil(leaf, at) },
  '[': bracket,
  '\\': () => undefined,
  ']': () => undefined,
  '^': (leaf, at, escaped) => {
    if (code(leaf, at - 1) === 91) undecide(leaf, 'footnote bracket')
    else gluedSigil(leaf, at, escaped, treeBracket, '')
  },
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

/** C2-W-092: the line starts of a paragraph by the rules of write-plan-lines.ts; of any other leaf, none may open a block. */
function checkLines(leaf: Leaf, start: number, place: LeafPlace | undefined, escaped: Uint8Array): void {
  const rules = place?.paragraph === true && start === LINE_START ? place : null
  for (let at = -1; at < leaf.codes.length && leaf.undecided === null; at++) {
    leaf.cursor = Math.max(at, 0)
    if (at < 0 ? start !== LINE_START : leaf.codes[at] !== LF || leaf.kinds[at] === TEXT) continue
    if (rules === null) {
      undecidedIf(opensBlock(leaf, at + 1), leaf, 'line start')
      continue
    }
    const escape = lineEscape(leaf, at + 1, at < 0, rules)
    if (escape === UNDECIDED) undecide(leaf, `line start ${String.fromCharCode(code(leaf, at + 1))}`)
    else if (escape >= 0) escaped[escape] = 1
  }
}

/** C2-I-090, C2-W-125 six: a mention or a tag forms after a boundary, and a name character behind it lengthens it. */
function checkAtom(leaf: Leaf, at: number, node: Node): void {
  const type = node.type
  if (type === 'mention' || type === 'tag' || type === 'symbol' || type === 'caption_number') {
    const before = code(leaf, at - 1)
    if (before >= 0 && isWordCharacter(before)) return undecide(leaf, 'sigil boundary')
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
    if (kind !== TEXT) continue
    const value = codes[at]!
    // C2-W-016: a CR before a line end would join it; a line feed of text is left to the reparse.
    if (value === LF || (value === CR && (at + 1 === codes.length || codes[at + 1] === LF || codes[at + 1] === CR))) {
      return undecide(leaf, 'control')
    }
    if (value >= 128 || INLINE_TRIGGERS[value] === 0) continue
    RESOLVERS[String.fromCharCode(value)]?.(leaf, at, escaped)
  }
}

/** Records the depth bound of every list of nodes below `nodes`: twice the number of nodes around its owner. */
export function noteDepths(plan: Plan, nodes: readonly Node[]): void {
  const pending: [readonly Node[], number, LeafPlace][] = [[nodes, 0, TOP_PLACE]]
  for (;;) {
    const item = pending.pop()
    if (item === undefined) return
    const [list, level, place] = item
    for (let at = 0; at < list.length; at++) {
      const node = list[at]!
      const inner = innerPlace(node, place, at > 0 ? list[at - 1]!.type : null)
      forEachSlot(node, (children) => {
        plan.depths.set(children, 2 * level)
        plan.places.set(children, inner)
        pending.push([children, level + 1, inner])
      })
    }
  }
}

const TOP_PLACE: LeafPlace = { paragraph: false, inItem: false, inQuote: false, inDescriptionList: false, before: null }

/** The place of the slots of `node`, which stands in `place` behind a block of the type `before`. */
function innerPlace(node: Node, place: LeafPlace, before: string | null): LeafPlace {
  const type = node.type
  return {
    paragraph: type === 'paragraph',
    // C2-B-020: inside a quote, a list marker no longer interrupts the paragraph of the item around it.
    inItem: type !== 'block_quote' && (place.inItem || type === 'list_item' || type === 'definition_description' || type === 'footnote'),
    inQuote: place.inQuote || type === 'block_quote',
    inDescriptionList: place.inDescriptionList || type === 'definition_list',
    before,
  }
}

function analyze(w: Writer, leaf: Leaf, start: number, flags: number, bound: number, place: LeafPlace | undefined): Uint8Array {
  const escaped = new Uint8Array(leaf.codes.length)
  if (w.abbreviations.size > 0) undecide(leaf, 'abbreviations')
  if (leaf.undecided === null) checkLines(leaf, (flags & IN_CELL) !== 0 ? AFTER_MARK : start, place, escaped)
  if (leaf.undecided === null) scanUnits(leaf, escaped)
  if (leaf.undecided === null) checkBrackets(leaf, escaped, w.linkKeys.size > 0)
  if (leaf.undecided === null) checkPairs(leaf, escaped, bound)
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
  const bound = plan.depths.get(nodes)
  if (bound === undefined) undecide(leaf, 'depth')
  const escaped = leaf.undecided === null ? analyze(w, leaf, start, flags, bound ?? 0, plan.places.get(nodes)) : new Uint8Array(0)
  plan.leaves++
  if (leaf.undecided !== null) {
    plan.undecided = leaf.undecided
    const text = leafText(leaf)
    const before = JSON.stringify(text.slice(Math.max(0, leaf.where - 16), leaf.where))
    plan.detail = `${before} | ${JSON.stringify(text.slice(leaf.where, leaf.where + 16))}`
  } else record(plan, leaf, escaped)
  plan.respell.push(...leaf.respell)
  return content
}

/** A leaf the planner does not model: the group it stands in is undecided. */
export function unplanned(w: Writer, why: string): void {
  if (w.plan === null || w.plan.undecided !== null) return
  w.plan.undecided = why
}

export { OPEN }
