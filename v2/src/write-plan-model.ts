// The content of one inline leaf as the reader sees it, built from the tree with the writer's own
// spellings, with the origin of every code unit: a text node and its offset, a mark of a node, or the
// body of an atom (C2-W-088). The planner compares it with what the writer wrote for the leaf.
import { forEachSlot, type LinkNode, type Node, type NodeOfType, type TextNode } from './ast.ts'
import { braceBlock } from './write-attributes.ts'
import {
  BARE_BREAKS, escapeOffsets, IN_BRACKET, IN_CELL, IN_EMPHASIS, IN_STRONG, joinsNextCode, kindsBelow, rawReference, target,
  writeInline,
} from './write-inline.ts'
import { type Writer } from './write-state.ts'

/** A unit of a text node. */
export const TEXT = 0
/** A backslash that the writer places before the next unit of a text node. */
export const ESCAPE = 1
/** A mark of a node of the tree: the opener or the closer of its syntax. */
export const OPEN = 2
export const CLOSE = 3
/** The body of a node written whole: a code span, a symbol, an attribute block, a link tail. */
export const ATOM = 4

export interface Leaf {
  codes: number[]
  kinds: number[]
  /** The text node of a text unit, and the node of a mark or an atom. */
  owners: Node[]
  /** The offset in the value of a text unit, else -1. */
  offsets: number[]
  /** Why the leaf has no decision, or null. */
  undecided: string | null
  /** C2-W-069: the bare emphasis and strong that take their braced form. */
  respell: Node[]
  /** The unit being decided, and the unit at which the leaf lost its decision, for the report of the gates. */
  cursor: number
  where: number
  /** C2-I-005: the units inside an attribute block of text, which the reader takes whole; null where there is none. */
  opaque: Uint8Array | null
  /** C2-I-109: the reader's single quote state at the unit being decided; an inline footnote saves it. */
  singleQuoteOpen: boolean
  inlineFootnote: boolean
  /** The end of the last cross-reference scan that found no `>`. */
  angleFailEnd: number
  /** The leaf is the content of a table cell. */
  inCell: boolean
  /** The last backtick written by an atom, or -1. */
  lastAtomTick: number
  /** The last `%}` and the last `#}`, once a brace asked for them. */
  closes: [number, number] | null
  /** C2-I-094: the opening bracket of each inline extension of text, with its colon. */
  extensions: Map<number, number>
  /** Whether a delimiter character of text came before the unit in the scan. */
  textMark: boolean
  /** The first unit of a braced comment of the tree, or -1. */
  firstComment: number
}

export function createLeaf(): Leaf {
  return {
    codes: [], kinds: [], owners: [], offsets: [], undecided: null, respell: [], cursor: 0, where: 0, opaque: null,
    singleQuoteOpen: false, inlineFootnote: false, angleFailEnd: -1, inCell: false, lastAtomTick: -1, closes: null, extensions: new Map(),
    textMark: false, firstComment: -1,
  }
}

function push(leaf: Leaf, code: number, kind: number, owner: Node, offset: number): void {
  if (code === 96 && kind === ATOM) leaf.lastAtomTick = leaf.codes.length
  if (leaf.firstComment < 0 && kind === ATOM && owner.type === 'comment' && owner.form === 'braced') leaf.firstComment = leaf.codes.length
  leaf.codes.push(code)
  leaf.kinds.push(kind)
  leaf.owners.push(owner)
  leaf.offsets.push(offset)
}

function pushString(leaf: Leaf, value: string, kind: number, owner: Node): void {
  for (let at = 0; at < value.length; at++) push(leaf, value.charCodeAt(at), kind, owner, -1)
}

export function undecide(leaf: Leaf, why: string): void {
  if (leaf.undecided !== null) return
  leaf.undecided = why
  leaf.where = leaf.cursor
}

const BACKSLASH = 92
const SPACE = 32
const TAB = 9
const LF = 10

function textUnits(w: Writer, leaf: Leaf, node: TextNode, flags: number): void {
  if ((flags & IN_CELL) !== 0 && w.wrapPoints?.has(node) === true) return undecide(leaf, 'continuation row')
  const value = node.value
  const escapes = escapeOffsets(w, node, flags)
  let next = 0
  for (let at = 0; at < value.length; at++) {
    if (next < escapes.length && escapes[next] === at) {
      next++
      push(leaf, BACKSLASH, ESCAPE, node, at)
    }
    push(leaf, value.charCodeAt(at), TEXT, node, at)
  }
}

/** Takes the spaces and tabs of text from the end of the leaf (C2-W-022). */
function trimText(leaf: Leaf, from: number): void {
  let end = leaf.codes.length
  while (end > from && leaf.kinds[end - 1] === TEXT && (leaf.codes[end - 1] === SPACE || leaf.codes[end - 1] === TAB)) end--
  leaf.codes.length = end
  leaf.kinds.length = end
  leaf.owners.length = end
  leaf.offsets.length = end
}

function around(w: Writer, leaf: Leaf, node: Node, children: readonly Node[], open: string, close: string, flags: number): void {
  pushString(leaf, open, OPEN, node)
  modelInlines(w, leaf, children, flags)
  pushString(leaf, close, CLOSE, node)
}

/** C2-W-069, C2-W-070: the marks of emphasis and strong, as the writer chooses them. */
function paired(mark: string, bit: number): ContainerModel<'emphasis' | 'strong'> {
  return (w, leaf, node, flags) => {
    if (node.children.length === 0) return false
    const inside = bit === 1 ? IN_EMPHASIS : IN_STRONG
    const braced = (flags & inside) !== 0 || (kindsBelow(w, node) & bit) !== 0 || (w.forms.get(node) ?? 0) > 0
    around(w, leaf, node, node.children, braced ? `{${mark}` : mark, braced ? `${mark}}` : mark, flags | inside)
    return true
  }
}

/** C2-W-071, C2-W-116: a span that has only a braced form. */
function braced(mark: string): ContainerModel<'underline' | 'strike' | 'highlight' | 'superscript' | 'subscript' | 'insert' | 'delete'> {
  return (w, leaf, node, flags) => {
    if (node.children.length === 0) return false
    around(w, leaf, node, node.children, `{${mark}`, `${mark}}`, flags)
    return true
  }
}

/** C2-W-067: a reference written as its source holds the texts below it as typed, so none of them takes a decision. */
function coverSource(w: Writer, node: Node): void {
  const covered = w.plan?.covered
  if (covered === undefined) return
  const pending: Node[] = [node]
  for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
    if (next.type === 'text') covered.add(next)
    forEachSlot(next, (children) => { pending.push(...children) })
  }
}

function linkUnits(w: Writer, leaf: Leaf, node: LinkNode, flags: number): boolean {
  const raw = rawReference(w, node, flags)
  if (raw !== null) {
    pushString(leaf, raw, ATOM, node)
    coverSource(w, node)
    return true
  }
  pushString(leaf, '[', OPEN, node)
  modelInlines(w, leaf, node.children, flags | IN_BRACKET)
  pushString(leaf, ']', CLOSE, node)
  pushString(leaf, target(node, node.href), ATOM, node)
  return true
}

type ContainerModel<T extends keyof NodeOfType> = (w: Writer, leaf: Leaf, node: NodeOfType[T], flags: number) => boolean

/** The nodes with content between marks, each read by a model of its own type; every other node is an atom. */
const CONTAINERS: { [T in keyof NodeOfType]?: ContainerModel<T> } = {
  emphasis: paired('/', 1),
  strong: paired('*', 2),
  underline: braced('_'),
  strike: braced('~'),
  highlight: braced('='),
  superscript: braced('^'),
  subscript: braced(','),
  insert: braced('+'),
  delete: braced('-'),
  span: (w, leaf, node, flags) => {
    around(w, leaf, node, node.children, '[', ']', flags)
    return true
  },
  inline_footnote: (w, leaf, node, flags) => {
    leaf.inlineFootnote = true
    around(w, leaf, node, node.children, '^[', ']', flags)
    return true
  },
  link: linkUnits,
  inline_extension: (w, leaf, node, flags) => {
    if (node.name.includes('.')) return false
    around(w, leaf, node, node.children, `:${node.name}[`, ']', flags)
    return true
  },
}

function containerUnits<T extends keyof NodeOfType>(w: Writer, leaf: Leaf, type: T, node: NodeOfType[T], flags: number): boolean {
  const model = CONTAINERS[type]
  return model !== undefined && model(w, leaf, node, flags)
}

function nodeUnits(w: Writer, leaf: Leaf, node: Node, flags: number): void {
  if (node.type === 'text') return textUnits(w, leaf, node, flags)
  if (node.type === 'soft_break') return push(leaf, LF, ATOM, node, -1)
  if (node.type === 'hard_break') return pushString(leaf, (flags & BARE_BREAKS) !== 0 ? '\n' : '\\\n', ATOM, node)
  if (node.type === 'inline_extension' && node.name.includes('.')) return undecide(leaf, 'extension')
  if (!containerUnits(w, leaf, node.type, node, flags)) return pushString(leaf, writeInline(w, node, flags), ATOM, node)
  // C2-W-076: the attribute block is glued to its host. C2-I-040: a span takes the block with no part.
  const block = braceBlock(node)
  pushString(leaf, node.type === 'span' && block === '' ? '{}' : block, ATOM, node)
}

/** The units of `nodes`, as `writeInlines` writes them. */
export function modelInlines(w: Writer, leaf: Leaf, nodes: readonly Node[], flags: number): void {
  for (let at = 0; at < nodes.length && leaf.undecided === null; at++) {
    const node = nodes[at]!
    const size = leaf.codes.length
    const lineStart = size === 0 || leaf.codes[size - 1] === LF
    // C2-I-023: a line comment starts at the start of a line or after whitespace, which it takes with it.
    if (node.type === 'comment' && node.form !== 'braced' && !lineStart) push(leaf, SPACE, ATOM, node, -1)
    if ((flags & IN_CELL) !== 0 && w.wrapStarts?.has(node) === true) return undecide(leaf, 'continuation row')
    if (joinsNextCode(nodes, at)) return undecide(leaf, 'code run')
    nodeUnits(w, leaf, node, flags)
    if (node.type === 'text' && nodes[at + 1]?.type === 'soft_break') trimText(leaf, size)
  }
}

/** `writeContent`: no space or tab of text at the end, and no line ending of a final hard break (C2-W-022). */
export function modelContent(w: Writer, leaf: Leaf, nodes: readonly Node[], flags: number): void {
  modelInlines(w, leaf, nodes, flags)
  const last = nodes[nodes.length - 1]
  if (last?.type === 'text') trimText(leaf, 0)
  else if (last?.type === 'hard_break' && leaf.codes[leaf.codes.length - 1] === LF) trimLast(leaf)
}

export function trimLast(leaf: Leaf): void {
  leaf.codes.length--
  leaf.kinds.length--
  leaf.owners.length--
  leaf.offsets.length--
}

/** The leaf as one string. */
export function leafText(leaf: Leaf): string {
  let out = ''
  const codes = leaf.codes
  for (let at = 0; at < codes.length; at += 4096) out += String.fromCharCode(...codes.slice(at, at + 4096))
  return out
}
