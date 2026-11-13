// Properties that hold for every document, checked on the events of one block pass.
// `checkDocument` returns the first violation as text, or null.
import {
  acquireState, type BlockState, buildTree, ENTER, EVENT_WIDTH, eventKind, eventType, EXIT, isLeaf, isOpaqueLeaf,
  lineAt, lineEndAt, releaseState, scanBlocks, SPAN,
} from '../../src/index.ts'
import { shape, shapeOf } from './shape.ts'

// A document that leaves every kind of container on the stack and every pending state set.
const LEFTOVER = '[^a]: > - a\n\n  :: t\n  : - ::: x\n      {.a}\n      ```\n\n'

export function checkDocument(src: string): string | null {
  const state = acquireState()
  try {
    scanBlocks(state, src)
    const failure = checkBalance(state) ?? checkOrder(state, src.length) ?? checkOwners(state, src)
    if (failure !== null) return failure
    const first = shapeOf(src, buildTree(state.events, state.eventLength))
    // The same state again, after another document: nothing may leak from one parse into the next.
    scanBlocks(state, LEFTOVER)
    scanBlocks(state, src)
    if (shapeOf(src, buildTree(state.events, state.eventLength)) !== first) return 'a second parse differs'
    const terminated = src.endsWith('\n') ? src : `${src}\n`
    if (shape(terminated) !== first) return 'a final line ending changes the tree'
    if (shape(`${terminated}\n`) !== first) return 'a trailing blank line changes the tree'
    return null
  } finally {
    releaseState(state)
  }
}

/** Every exit closes the block entered last, spans stand in leaves only, and a leaf holds no block. */
function checkBalance(state: BlockState): string | null {
  const events = state.events
  const open: number[] = []
  for (let at = 0; at < state.eventLength; at += EVENT_WIDTH) {
    const tag = events[at]!
    const type = eventType(tag)
    const top = open.length > 0 ? open[open.length - 1]! : -1
    if (type === ENTER) {
      if (top >= 0 && isLeaf(top)) return `event ${at}: a block inside a leaf`
      if (top < 0 && at > 0) return `event ${at}: a block after the document`
      open.push(eventKind(tag))
    } else if (type === SPAN) {
      if (top < 0 || !isLeaf(top)) return `event ${at}: a span outside a leaf`
    } else if (type === EXIT) {
      if (open.pop() !== eventKind(tag)) return `event ${at}: an exit that does not match its enter`
    } else {
      return `event ${at}: unknown event type`
    }
  }
  return open.length === 0 ? null : 'unclosed blocks at the end'
}

/** Offsets never go back, which keeps every span and block ordered and inside its container. */
function checkOrder(state: BlockState, length: number): string | null {
  const events = state.events
  let last = 0
  for (let at = 0; at < state.eventLength; at += EVENT_WIDTH) {
    const a = events[at + 1]!
    const end = eventType(events[at]!) === SPAN ? events[at + 2]! : a
    if (a < last || end < a || end > length) return `event ${at}: offsets out of order`
    last = end
  }
  return null
}

/**
 * Every line has exactly one owner. A leaf owns the lines of its spans and the lines it starts
 * and ends on (a fence opener and closer, a thematic break). A line with no leaf must be blank,
 * hold only quote marks, or be a line a container starts or ends on (the opener and the closer
 * of a div). A blank line has an owner only inside an opaque leaf.
 */
function checkOwners(state: BlockState, src: string): string | null {
  const events = state.events
  const owner = new Int32Array(state.lineCount).fill(-1)
  const ownerKind = new Int32Array(state.lineCount).fill(-1)
  const marked = new Uint8Array(state.lineCount)
  let leaf = -1
  let leafKind = -1
  for (let at = 0; at < state.eventLength; at += EVENT_WIDTH) {
    const tag = events[at]!
    const type = eventType(tag)
    if (state.lineCount === 0) continue
    const line = lineAt(state.lineStarts, state.lineCount, events[at + 1]!)
    if (type !== SPAN && !isLeaf(eventKind(tag))) {
      marked[line] = 1
      continue
    }
    if (type === ENTER) {
      leaf = at
      leafKind = eventKind(tag)
    }
    if (owner[line] !== -1 && owner[line] !== leaf) return `line ${line + 1}: two owners`
    owner[line] = leaf
    ownerKind[line] = leafKind
  }
  for (let line = 0; line < state.lineCount; line++) {
    const start = state.lineStarts[line]!
    const end = lineEndAt(src, state.lineStarts, state.lineCount, line)
    let blank = true
    let marksOnly = true
    for (let pos = start; pos < end; pos++) {
      const char = src[pos]
      if (char !== ' ' && char !== '\t') blank = false
      if (char !== ' ' && char !== '\t' && char !== '>') marksOnly = false
    }
    if (owner[line] === -1 && !marksOnly && marked[line] === 0) return `line ${line + 1}: no owner`
    if (owner[line] !== -1 && blank && !isOpaqueLeaf(ownerKind[line]!)) return `line ${line + 1}: a blank line with an owner`
  }
  return null
}
