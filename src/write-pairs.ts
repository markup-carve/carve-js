// C2-W-146: the text the escaping procedure wrote is tested with the pair rules of lint, and each
// mark of a reported opening run takes a backslash, so canonical output does not fail them.
import { forEachSlot, INLINE_PARENTS, type Node, type ParagraphNode, type TextNode } from './ast.ts'
import { nextPair, pairEnd } from './pair-marks.ts'
import { isAsciiPunctuation } from './unicode.ts'

const PAIR_RULES = [
  ['_', 'deprecated-bare-underline'], ['~', 'deprecated-bare-strike'], ['=', 'deprecated-bare-highlight'],
  ['~~', 'markdown-strikethrough-double-tilde'], ['**', 'markdown-strong-double-star'],
] as const

const PARENTS: ReadonlySet<string> = new Set(INLINE_PARENTS)

/** No text of the group holds a pair mark: the pair rules ask nothing of it. */
export const NO_PAIRS = 0
/** Plain paragraphs, whose pair escapes no enclosing spelling choice can change: they are placed before the write. */
export const EARLY_PAIRS = 1
/** Any other group with a pair mark: its pair escapes are tested once its other escapes are settled. */
export const LATE_PAIRS = 2

const WORD = /[\p{L}\p{N}]/u

const HOLDS_MARKS = 1
const ONLY_PLAIN = 2

/** HOLDS_MARKS where `value` holds a pair mark, ONLY_PLAIN where it holds only letters, digits and ` _~=*.,;:!?-`. */
function readText(value: string): number {
  let marks = 0
  for (let at = 0; at < value.length; at++) {
    const code = value.charCodeAt(at)
    const kind = code < 128 ? PLAIN[code]! : plainPoint(value, at)
    if (kind === 0) return marks | (/[~_=*]/.test(value.slice(at)) ? HOLDS_MARKS : 0)
    if (kind === MARK) marks = HOLDS_MARKS
    else if (kind === ASTRAL) at++
  }
  return marks | ONLY_PLAIN
}

/** The kind of the character at `at` beyond ASCII: a letter or digit of one or two code units, else 0. */
function plainPoint(value: string, at: number): number {
  const point = value.codePointAt(at)!
  if (!WORD.test(String.fromCodePoint(point))) return 0
  return point > 0xffff ? ASTRAL : 1
}

const MARK = 2
const ASTRAL = 3
const PLAIN = new Uint8Array(128)
for (const ch of '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ .,;:!?-') PLAIN[ch.charCodeAt(0)] = 1
for (const ch of '_~=*') PLAIN[ch.charCodeAt(0)] = MARK

function hasMarksBelow(node: Node): boolean {
  const stack = [node]
  for (let next = stack.pop(); next !== undefined; next = stack.pop()) {
    if (next.type === 'text' && /[~_=*]/.test(next.value)) return true
    forEachSlot(next, (nodes) => { for (const child of nodes) stack.push(child) })
  }
  return false
}

function onlyText(children: readonly Node[]): boolean {
  for (const child of children) if (child.type !== 'text') return false
  return true
}

/** The pair escapes asked for, by text node: offsets in its value, unsorted, with a repeat where two rules ask. */
export type Asked = Map<TextNode, number[]>

/**
 * How the pair rules reach `group`: NO_PAIRS, EARLY_PAIRS or LATE_PAIRS, read in one walk. For EARLY_PAIRS, `early`
 * (empty on entry) receives the escapes they ask for under `escapes`, found in the same walk.
 */
export function pairReach(group: readonly Node[], escapes: ReadonlyMap<TextNode, readonly number[]>, early: Asked): number {
  let read = ONLY_PLAIN
  for (const node of group) {
    if ((read & ONLY_PLAIN) !== 0 && node.type === 'paragraph' && onlyText(node.children)) {
      read = readParagraph(node, read, escapes, early)
      continue
    }
    read &= ~ONLY_PLAIN
    if ((read & HOLDS_MARKS) === 0 && hasMarksBelow(node)) read |= HOLDS_MARKS
  }
  if ((read & HOLDS_MARKS) === 0) return NO_PAIRS
  if ((read & ONLY_PLAIN) === 0) {
    early.clear()
    return LATE_PAIRS
  }
  dropEscaped(early, escapes)
  return EARLY_PAIRS
}

/** `read` with the text of a paragraph of text nodes, and its pair escapes in `early` while the group stays plain. */
function readParagraph(node: ParagraphNode, read: number, escapes: ReadonlyMap<TextNode, readonly number[]>,
  early: Asked): number {
  let next = read
  for (const child of node.children as readonly TextNode[]) {
    const text = readText(child.value)
    next = (next | (text & HOLDS_MARKS)) & (text | HOLDS_MARKS)
  }
  // A node with metadata has slots beside its children (forEachSlot).
  if (node.metadata !== undefined && hasMarksBelow(node)) next |= HOLDS_MARKS
  if (next !== (HOLDS_MARKS | ONLY_PLAIN)) return next
  if (node.metadata === undefined) testChildren(node.children, escapes, early)
  else for (const [text, offsets] of pairEscapes([node], escapes)) early.set(text, offsets)
  return next
}

/**
 * One run of text and soft breaks as the writer spells it. The spelling is kept in slices; a character of it maps back
 * to its text node through `inserted`, the places of the backslashes the spelling adds, and `parts`, the start of each
 * text node or soft break in the run without them.
 */
interface Run {
  chunks: string[]
  length: number
  inserted: number[]
  parts: (TextNode | null)[]
  starts: number[]
  plain: number
}

function newRun(): Run {
  return { chunks: [], length: 0, inserted: [], parts: [], starts: [], plain: 0 }
}

function escapedAt(escapes: ReadonlyMap<TextNode, readonly number[]>, node: TextNode, at: number): boolean {
  const offsets = escapes.get(node)
  return offsets !== undefined && offsets[firstAtOrAbove(offsets, at)] === at
}

/** C2-W-097: a backslash before punctuation, a space or the end of the line is written as two. */
function doubled(value: string, at: number): boolean {
  const next = value.charCodeAt(at + 1)
  return Number.isNaN(next) || next === 32 || next === 10 || isAsciiPunctuation(next)
}

/** The doubled backslashes of `value` (C2-W-097), ascending. */
function doubledBackslashes(value: string): number[] {
  const out: number[] = []
  for (let at = value.indexOf('\\'); at >= 0; at = value.indexOf('\\', at + 1)) if (doubled(value, at)) out.push(at)
  return out
}

function spell(run: Run, node: TextNode, escapes: ReadonlyMap<TextNode, readonly number[]>): void {
  const value = node.value
  const asked = escapes.get(node) ?? []
  const slashes = value.includes('\\') ? doubledBackslashes(value) : []
  run.parts.push(node)
  run.starts.push(run.plain)
  let from = 0
  let a = 0
  let b = 0
  // Each offset that is asked or a doubled backslash takes one backslash, in ascending order.
  for (let at = 0; ; at++) {
    while (a < asked.length && asked[a]! < at) a++
    while (b < slashes.length && slashes[b]! < at) b++
    at = Math.min(a < asked.length ? asked[a]! : value.length, b < slashes.length ? slashes[b]! : value.length)
    if (at >= value.length) break
    run.chunks.push(value.slice(from, at), '\\')
    run.length += at - from
    run.inserted.push(run.length)
    run.length++
    from = at
  }
  run.chunks.push(value.slice(from))
  run.length += value.length - from
  run.plain += value.length
}

function softBreak(run: Run): void {
  run.parts.push(null)
  run.starts.push(run.plain)
  run.chunks.push('\n')
  run.length++
  run.plain++
}

/** Asks for the character `at` of the spelling of `run`, unless the spelling added it. */
function askAt(run: Run, at: number, found: Asked): void {
  const added = firstAtOrAbove(run.inserted, at)
  if (run.inserted[added] === at) return
  const plain = at - added
  // The last part that starts at or before `plain`; an empty text node shares its start with the part behind it.
  const part = firstAtOrAbove(run.starts, plain + 1) - 1
  const node = run.parts[part]
  if (node !== null && node !== undefined) ask(found, node, plain - run.starts[part]!)
}

/** The index of the first entry of the ascending list `list` that is not below `value`. */
function firstAtOrAbove(list: readonly number[], value: number): number {
  let low = 0
  let high = list.length
  while (low < high) {
    const middle = (low + high) >>> 1
    if (list[middle]! < value) low = middle + 1
    else high = middle
  }
  return low
}

function ask(found: Asked, node: TextNode, at: number): void {
  const offsets = found.get(node)
  if (offsets === undefined) found.set(node, [at])
  else offsets.push(at)
}

function testRun(run: Run, found: Asked): void {
  if (run.length === 0) return
  const source = run.chunks.join('')
  for (const [mark, id] of PAIR_RULES) {
    for (let start = nextPair(source, mark, id, 0); start >= 0; start = nextPair(source, mark, id, pairEnd)) {
      for (let at = start; at < start + mark.length; at++) askAt(run, at, found)
    }
  }
}

function testPlainText(node: TextNode, found: Asked): void {
  const value = node.value
  let offsets: number[] | undefined
  for (const [mark, id] of PAIR_RULES) {
    for (let start = nextPair(value, mark, id, 0); start >= 0; start = nextPair(value, mark, id, pairEnd)) {
      offsets ??= found.get(node) ?? []
      for (let at = start; at < start + mark.length; at++) offsets.push(at)
    }
  }
  if (offsets !== undefined && offsets.length > 0) found.set(node, offsets)
}

function testChildren(children: readonly Node[], escapes: ReadonlyMap<TextNode, readonly number[]>, found: Asked): void {
  const only = children.length === 1 ? children[0] : undefined
  if (only?.type === 'text' && !only.value.includes('\\') && !escapes.has(only)) {
    testPlainText(only, found)
    return
  }
  let run = newRun()
  for (const child of children) {
    if (child.type === 'text') spell(run, child, escapes)
    else if (child.type === 'soft_break') softBreak(run)
    else {
      testRun(run, found)
      run = newRun()
    }
  }
  testRun(run, found)
}

/** Leaves out of `found` what `escapes` already holds. */
function dropEscaped(found: Asked, escapes: ReadonlyMap<TextNode, readonly number[]>): void {
  for (const [node, offsets] of found) {
    if (!escapes.has(node)) continue
    const kept = offsets.filter((at) => !escapedAt(escapes, node, at))
    if (kept.length === 0) found.delete(node)
    else found.set(node, kept)
  }
}

/** The escapes that the pair rules ask for in `group` under the escapes `escapes` already holds. */
export function pairEscapes(group: readonly Node[], escapes: ReadonlyMap<TextNode, readonly number[]>): Asked {
  const found: Asked = new Map()
  const stack: Node[] = [...group]
  for (let node = stack.pop(); node !== undefined; node = stack.pop()) {
    if (PARENTS.has(node.type) && 'children' in node) testChildren(node.children as readonly Node[], escapes, found)
    forEachSlot(node, (nodes) => { for (const child of nodes) stack.push(child) })
  }
  dropEscaped(found, escapes)
  return found
}
