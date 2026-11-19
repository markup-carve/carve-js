// C2-I-098 to C2-I-100: each occurrence of a defined term in the ordinary text of an inline flow
// is an abbreviation node. A term is ASCII letters and digits (C2-B-084) and matches a whole word.
import { type AbbreviationNode, type Inline, type InlineParent, isInlineParent, type TextNode } from './ast.ts'
import { addText, type TreeContext } from './ast-inline.ts'
import { codePointAt, codePointBefore, isAsciiAlphanumeric, isWordCharacter, NO_CHARACTER } from './unicode.ts'

/** C2-I-100: no term matches in the text of these nodes, whose content is not flow of this content. */
function isFlowParent(node: Inline): node is Inline & InlineParent {
  return isInlineParent(node)
}

// What `leadingCharacter` gives for a node the flow passes through, distinct from every character and from NO_CHARACTER.
const PASSES_THROUGH = NO_CHARACTER - 1

/** The first character of `node`, or `after` when the flow passes through it. An element edge is no boundary (C2-I-099). */
function leadingCharacter(node: Inline, after: number): number {
  if (node.type === 'text') return codePointAt(node.value, 0, node.value.length)
  if (node.type === 'comment') return after
  if (!isFlowParent(node) || node.type === 'inline_footnote') return NO_CHARACTER
  return node.children.length > 0 ? firstCharacter(node.children, 0, NO_CHARACTER) : after
}

/** The first character of the flow at `nodes[from]`, or `after` when the list ends there. */
function firstCharacter(nodes: readonly Inline[], from: number, after: number): number {
  for (let at = from; at < nodes.length; at++) {
    const found = leadingCharacter(nodes[at]!, PASSES_THROUGH)
    if (found !== PASSES_THROUGH) return found
  }
  return after
}

/** The first character of the flow behind each node, in one pass from the end, so empty nodes are not walked again per node. */
function followingCharacters(nodes: readonly Inline[], after: number): Int32Array {
  const following = new Int32Array(nodes.length)
  let next = after
  for (let at = nodes.length - 1; at >= 0; at--) {
    following[at] = next
    next = leadingCharacter(nodes[at]!, next)
  }
  return following
}

function lastCharacter(nodes: readonly Inline[], before: number): number {
  for (let at = nodes.length - 1; at >= 0; at--) {
    const node = nodes[at]!
    if (node.type === 'text') return codePointBefore(node.value, node.value.length)
    if (node.type === 'comment') continue
    if (!isFlowParent(node) || node.type === 'inline_footnote') return NO_CHARACTER
    if (node.children.length > 0) return lastCharacter(node.children, NO_CHARACTER)
  }
  return before
}

/** The end of the run of ASCII letters and digits that starts at `at`, or `at` when none starts there. */
function wordEnd(value: string, at: number): number {
  let end = at
  while (end < value.length && isAsciiAlphanumeric(value.charCodeAt(end))) end++
  return end
}

/** One text node while its terms are cut out of it. */
interface Split {
  ctx: TreeContext
  node: TextNode
  value: string
  start: number
  parts: Inline[]
  done: number
  // The last index whose source offset was asked for, and that offset: indexes only grow, so no index is walked twice.
  seen: number
  seenOffset: number
}

/** The source offset of index `index` of the value: an escape is two characters of source. */
function offsetOf(split: Split, index: number): number {
  if (split.start < 0) return -1
  const { value } = split
  const src = split.ctx.src
  let at = split.seenOffset
  for (let seen = split.seen; seen < index; seen++, at++) {
    if (src[at] === '\\' && src[at + 1] === value[seen]) at++
  }
  split.seen = index
  split.seenOffset = at
  return at
}

function addTerm(split: Split, at: number, end: number, expansion: string): void {
  const { ctx, value, parts } = split
  if (at > split.done) addText(ctx, parts, value.slice(split.done, at), offsetOf(split, split.done), offsetOf(split, at))
  const term: AbbreviationNode = { type: 'abbreviation', key: value.slice(at, end), namespace: 'abbr', expansion }
  const pos = split.node.pos
  if (split.start >= 0 && pos !== undefined) term.pos = { ...pos, startOffset: offsetOf(split, at), endOffset: offsetOf(split, end) }
  parts.push(term)
  split.done = end
}

/** The parts of one text node: its text around the abbreviation nodes of the terms in it, or null when it holds none. */
/** C2-I-099: whether the word `[at, end)` of `value` stands alone: the character on each side is absent or is no word character. */
function standsAlone(value: string, at: number, end: number, before: number, after: number): boolean {
  const left = at === 0 ? before : codePointBefore(value, at)
  const right = end === value.length ? after : codePointAt(value, end, value.length)
  return !isWordCharacter(left) && !isWordCharacter(right)
}

function splitText(ctx: TreeContext, node: TextNode, before: number, after: number): Inline[] | null {
  const value = node.value
  const start = node.pos?.startOffset ?? -1
  const split: Split = { ctx, node, value, start, parts: [], done: 0, seen: 0, seenOffset: start }
  for (let at = 0; at < value.length;) {
    const end = wordEnd(value, at)
    const expansion = end === at ? undefined : ctx.abbreviations.get(value.slice(at, end))
    if (expansion !== undefined && standsAlone(value, at, end, before, after)) addTerm(split, at, end, expansion)
    at = Math.max(end, at + 1)
  }
  if (split.parts.length === 0) return null
  if (split.done < value.length) addText(ctx, split.parts, value.slice(split.done), offsetOf(split, split.done), node.pos?.endOffset ?? -1)
  return split.parts
}

function applyTo(ctx: TreeContext, nodes: Inline[], before: number, after: number): Inline[] {
  let out: Inline[] | null = null
  let previous = before
  let following: Int32Array | null = null
  for (let at = 0; at < nodes.length; at++) {
    const node = nodes[at]!
    const next = (): number => (following ??= followingCharacters(nodes, after))[at]!
    let parts: Inline[] | null = null
    if (node.type === 'text') {
      parts = splitText(ctx, node, previous, next())
      previous = codePointBefore(node.value, node.value.length)
    } else if (node.type === 'inline_footnote') {
      // C2-I-109: an inline footnote is a flow of its own.
      node.children = applyTo(ctx, node.children, NO_CHARACTER, NO_CHARACTER)
      previous = NO_CHARACTER
    } else if (isFlowParent(node)) {
      node.children = applyTo(ctx, node.children, previous, next())
      previous = lastCharacter(node.children, previous)
    } else if (node.type !== 'comment') {
      previous = NO_CHARACTER
    }
    if (parts !== null) out ??= nodes.slice(0, at)
    if (out !== null) for (const part of parts ?? [node]) out.push(part)
  }
  return out ?? nodes
}

/** Replaces, in place, the defined terms in the text of one content by abbreviation nodes. */
export function applyAbbreviations(ctx: TreeContext, nodes: Inline[]): void {
  const result = applyTo(ctx, nodes, NO_CHARACTER, NO_CHARACTER)
  if (result === nodes) return
  // Not a spread: a content may hold more nodes than a call takes arguments.
  nodes.length = 0
  for (const node of result) nodes.push(node)
}
