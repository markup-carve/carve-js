// Properties of the public tree and of the HTML of every document. `checkTree` returns the first
// violation as text, or null.
import {
  type AstNode, decodeTree, encodeTree, parse, type Position, render, treesEqual, validateTree,
} from '../../src/index.ts'

const VOID_ELEMENTS = ['hr', 'img', 'br', 'input', 'col']
const TAG = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)((?:\s+[^\s"=<>/]+(?:="[^"]*")?)*)\s*>/y
const ATTRIBUTE = /\s+([^\s"=<>/]+)(?:="[^"]*")?/g

/** The slots of a node that hold positioned nodes, in the order a walker visits them (C2-A-025). */
function slotLists(node: AstNode): AstNode[][] {
  const lists: AstNode[][] = []
  if (node.children !== undefined) lists.push(node.children)
  if (Array.isArray(node.title)) lists.push(node.title)
  if (node.caption !== undefined) lists.push([node.caption])
  return lists
}

/** Line, column and byte offset of every string offset of `src`, computed without the engine. */
function sourceTable(src: string): Map<number, [number, number]> {
  const table = new Map<number, [number, number]>()
  const encoder = new TextEncoder()
  let line = 1
  let column = 1
  let bytes = 0
  table.set(0, [1, 1])
  for (const char of src) {
    bytes += encoder.encode(char).length
    if (char === '\n') {
      line++
      column = 1
    } else {
      column++
    }
    table.set(bytes, [line, column])
  }
  return table
}

/** C2-A-143: line and column are those of the offset. */
function checkPosition(pos: Position, table: Map<number, [number, number]>, path: string): string | null {
  if (pos.startOffset > pos.endOffset) return `${path}: the start lies behind the end`
  const start = table.get(pos.startOffset)
  const end = table.get(pos.endOffset)
  if (start === undefined || end === undefined) return `${path}: an offset inside a character`
  if (start[0] !== pos.startLine || start[1] !== pos.startColumn) return `${path}: the start line or column is not that of the offset`
  if (end[0] !== pos.endLine || end[1] !== pos.endColumn) return `${path}: the end line or column is not that of the offset`
  return null
}

function isBreak(node: AstNode): boolean {
  return node.type === 'soft_break' || node.type === 'hard_break'
}

/** C2-A-145, C2-A-146: siblings are ordered and disjoint; a comment before a block that took attribute lines is exempt. */
function checkSiblings(list: AstNode[], path: string): string | null {
  let last: AstNode | null = null
  for (const node of list) {
    if (node.pos === undefined) continue
    const exempt = last !== null && (last.type === 'comment' || (isBreak(last) && isBreak(node)))
    if (last !== null && !exempt && last.pos!.endOffset > node.pos.startOffset) return `${path}: ${last.type} overlaps ${node.type}`
    last = node
  }
  return null
}

/** C2-A-144: a child lies inside the nearest ancestor that has a position. */
function checkNode(node: AstNode, outer: Position | null, table: Map<number, [number, number]>, path: string): string | null {
  const pos = node.pos
  if (pos !== undefined) {
    const failure = checkPosition(pos, table, path)
    if (failure !== null) return failure
    if (outer !== null && (pos.startOffset < outer.startOffset || pos.endOffset > outer.endOffset)) return `${path}: ${node.type} lies outside its parent`
  }
  for (const list of slotLists(node)) {
    const failure = checkSiblings(list, path) ?? checkList(list, pos ?? outer, table, path)
    if (failure !== null) return failure
  }
  return null
}

function checkList(list: AstNode[], outer: Position | null, table: Map<number, [number, number]>, path: string): string | null {
  for (let at = 0; at < list.length; at++) {
    const failure = checkNode(list[at]!, outer, table, `${path}/${at}`)
    if (failure !== null) return failure
  }
  return null
}

/** Tags balanced, attributes quoted, no attribute twice, and no markup character outside a tag. */
export function checkHtml(html: string): string | null {
  const open: string[] = []
  for (let at = 0; at < html.length; at++) {
    const char = html[at]
    if (char === '>') return `a bare > at ${at}`
    if (char !== '<') continue
    TAG.lastIndex = at
    const match = TAG.exec(html)
    if (match === null) return `a malformed tag at ${at}: ${html.slice(at, at + 40)}`
    const names = Array.from(match[3]!.matchAll(ATTRIBUTE), (attribute) => attribute[1]!.toLowerCase())
    if (new Set(names).size !== names.length) return `an attribute twice in ${match[0]}`
    const name = match[2]!
    if (match[1] === '/') {
      if (open.pop() !== name) return `</${name}> closes nothing at ${at}`
    } else if (!VOID_ELEMENTS.includes(name)) {
      open.push(name)
    }
    at += match[0].length - 1
  }
  return open.length === 0 ? null : `<${open[open.length - 1]!}> is not closed`
}

export function checkTree(src: string): string | null {
  const tree = parse(src)
  try {
    validateTree(tree)
  } catch (error) {
    return `the validator refuses the tree: ${String(error)}`
  }
  const failure = checkNode(tree, null, sourceTable(src), '')
  if (failure !== null) return failure
  const json = encodeTree(tree)
  // C2-A-165: encode and decode give an equal tree in every field, positions included.
  const decoded = decodeTree(json)
  if (!treesEqual(tree, decoded) || encodeTree(decoded) !== json) return 'encode then decode gives another tree'
  if (encodeTree(parse(src)) !== json) return 'a second parse gives another tree'
  const html = render(src)
  if (render(decoded) !== html) return 'the tree renders differently from its source'
  return checkHtml(html)
}

export interface TreeEnumerationResult {
  documents: number
  failures: string[]
}

const MAX_REPORTED = 20

/** Checks every document of exactly `length` parts of `alphabet`, joined by `glue` behind `prefix`. */
export function enumerateTrees(alphabet: readonly string[], length: number, glue: string, prefix: string): TreeEnumerationResult {
  const result: TreeEnumerationResult = { documents: 0, failures: [] }
  const choice = new Array<number>(length).fill(0)
  const parts = new Array<string>(length).fill('')
  for (;;) {
    for (let at = 0; at < length; at++) parts[at] = alphabet[choice[at]!]!
    const src = prefix + parts.join(glue)
    result.documents++
    let failure: string | null
    try {
      failure = checkTree(src)
    } catch (error) {
      failure = `threw ${String(error)}`
    }
    if (failure !== null && result.failures.length < MAX_REPORTED) result.failures.push(`${JSON.stringify(src)}: ${failure}`)
    let at = length - 1
    while (at >= 0 && choice[at] === alphabet.length - 1) choice[at--] = 0
    if (at < 0) return result
    choice[at]!++
  }
}
