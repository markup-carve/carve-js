// C2-I-098 to C2-I-100: each occurrence of a defined term in the ordinary text of an inline flow
// is an abbreviation node. A term is ASCII letters and digits (C2-B-084) and matches a whole word.
import { type AstNode, INLINE_PARENTS } from './ast.ts'
import { addText, type TreeContext } from './ast-inline.ts'
import { codePointAt, codePointBefore, isWordCharacter, NO_CHARACTER } from './unicode.ts'

/** C2-I-100: no term matches in the text of these nodes, whose content is not flow of this content. */
function isFlowParent(node: AstNode): boolean {
  return node.children !== undefined && INLINE_PARENTS.includes(node.type)
}

/** The first character of the flow at `nodes[from]`, or `after` when the list ends there. An element edge is no boundary (C2-I-099). */
function firstCharacter(nodes: AstNode[], from: number, after: number): number {
  for (let at = from; at < nodes.length; at++) {
    const node = nodes[at]!
    if (node.type === 'text') return codePointAt(node.value!, 0, node.value!.length)
    if (node.type === 'comment') continue
    if (!isFlowParent(node) || node.type === 'inline_footnote') return NO_CHARACTER
    if (node.children!.length > 0) return firstCharacter(node.children!, 0, NO_CHARACTER)
  }
  return after
}

function lastCharacter(nodes: AstNode[], before: number): number {
  for (let at = nodes.length - 1; at >= 0; at--) {
    const node = nodes[at]!
    if (node.type === 'text') return codePointBefore(node.value!, node.value!.length)
    if (node.type === 'comment') continue
    if (!isFlowParent(node) || node.type === 'inline_footnote') return NO_CHARACTER
    if (node.children!.length > 0) return lastCharacter(node.children!, NO_CHARACTER)
  }
  return before
}

/** The source offset of index `index` of the value of a text node that starts at `start`: an escape is two characters of source. */
function sourceOffset(src: string, start: number, value: string, index: number): number {
  let at = start
  for (let seen = 0; seen < index; seen++, at++) {
    if (src[at] === '\\' && src[at + 1] === value[seen]) at++
  }
  return at
}

function isAsciiWord(code: number): boolean {
  return (code >= 48 && code <= 57) || (code >= 65 && code <= 90) || (code >= 97 && code <= 122)
}

/** The end of the run of ASCII letters and digits that starts at `at`, or `at` when none starts there. */
function wordEnd(value: string, at: number): number {
  let end = at
  while (end < value.length && isAsciiWord(value.charCodeAt(end))) end++
  return end
}

/** One text node while its terms are cut out of it. */
interface Split {
  ctx: TreeContext
  node: AstNode
  value: string
  start: number
  parts: AstNode[]
  done: number
}

function offsetOf(split: Split, index: number): number {
  return split.start < 0 ? -1 : sourceOffset(split.ctx.src, split.start, split.value, index)
}

function addTerm(split: Split, at: number, end: number, expansion: string): void {
  const { ctx, value, parts } = split
  if (at > split.done) addText(ctx, parts, value.slice(split.done, at), offsetOf(split, split.done), offsetOf(split, at))
  const term: AstNode = { type: 'abbreviation', key: value.slice(at, end), namespace: 'abbr', expansion }
  if (split.start >= 0) term.pos = { ...split.node.pos!, startOffset: offsetOf(split, at), endOffset: offsetOf(split, end) }
  parts.push(term)
  split.done = end
}

/** The parts of one text node: its text around the abbreviation nodes of the terms in it, or null when it holds none. */
function splitText(ctx: TreeContext, node: AstNode, before: number, after: number): AstNode[] | null {
  const value = node.value!
  const split: Split = { ctx, node, value, start: node.pos?.startOffset ?? -1, parts: [], done: 0 }
  for (let at = 0; at < value.length;) {
    const end = wordEnd(value, at)
    if (end === at) {
      at++
      continue
    }
    const expansion = ctx.abbreviations.get(value.slice(at, end))
    // C2-I-099: the character on each side is absent or is no word character.
    const left = at === 0 ? before : codePointBefore(value, at)
    const right = end === value.length ? after : codePointAt(value, end, value.length)
    if (expansion !== undefined && !isWordCharacter(left) && !isWordCharacter(right)) addTerm(split, at, end, expansion)
    at = end
  }
  if (split.parts.length === 0) return null
  if (split.done < value.length) addText(ctx, split.parts, value.slice(split.done), offsetOf(split, split.done), node.pos?.endOffset ?? -1)
  return split.parts
}

function applyTo(ctx: TreeContext, nodes: AstNode[], before: number, after: number): AstNode[] {
  let out: AstNode[] | null = null
  let previous = before
  for (let at = 0; at < nodes.length; at++) {
    const node = nodes[at]!
    const next = (): number => firstCharacter(nodes, at + 1, after)
    let parts: AstNode[] | null = null
    if (node.type === 'text') {
      parts = splitText(ctx, node, previous, next())
      previous = codePointBefore(node.value!, node.value!.length)
    } else if (node.type === 'inline_footnote') {
      // C2-I-109: an inline footnote is a flow of its own.
      node.children = applyTo(ctx, node.children!, NO_CHARACTER, NO_CHARACTER)
      previous = NO_CHARACTER
    } else if (isFlowParent(node)) {
      node.children = applyTo(ctx, node.children!, previous, next())
      previous = lastCharacter(node.children, previous)
    } else if (node.type !== 'comment') {
      previous = NO_CHARACTER
    }
    if (parts !== null) out ??= nodes.slice(0, at)
    if (out !== null) out.push(...(parts ?? [node]))
  }
  return out ?? nodes
}

/** Replaces, in place, the defined terms in the text of one content by abbreviation nodes. */
export function applyAbbreviations(ctx: TreeContext, nodes: AstNode[]): void {
  const result = applyTo(ctx, nodes, NO_CHARACTER, NO_CHARACTER)
  if (result !== nodes) nodes.splice(0, nodes.length, ...result)
}
