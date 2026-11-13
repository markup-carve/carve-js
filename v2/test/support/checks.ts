// Properties that hold for every document, checked on the events of one block pass.
// `checkDocument` returns the first violation as text, or null.
import {
  acquireState, type BlockState, buildTree, CELL, ENTER, EVENT_WIDTH, eventKind, eventType, EXIT, isLeaf, isOpaqueLeaf,
  lineAt, lineEndAt, releaseState, ROW, scanBlocks, SPAN,
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

/** What is wrong with the event at `at`, given the kinds of the open blocks, or null. Takes the event into `open`. */
function eventFailure(tag: number, at: number, open: number[]): string | null {
  const type = eventType(tag)
  const top = open.length > 0 ? open[open.length - 1]! : -1
  if (type === SPAN) return top < 0 || !isLeaf(top) ? `event ${at}: a span outside a leaf` : null
  if (type === EXIT) return open.pop() === eventKind(tag) ? null : `event ${at}: an exit that does not match its enter`
  if (type !== ENTER) return `event ${at}: unknown event type`
  if (top >= 0 && isLeaf(top)) return `event ${at}: a block inside a leaf`
  if (top < 0 && at > 0) return `event ${at}: a block after the document`
  open.push(eventKind(tag))
  return null
}

/** Every exit closes the block entered last, spans stand in leaves only, and a leaf holds no block. */
function checkBalance(state: BlockState): string | null {
  const open: number[] = []
  for (let at = 0; at < state.eventLength; at += EVENT_WIDTH) {
    const failure = eventFailure(state.events[at]!, at, open)
    if (failure !== null) return failure
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
  const owner = new Int32Array(state.lineCount).fill(-1)
  const ownerKind = new Int32Array(state.lineCount).fill(-1)
  const marked = new Uint8Array(state.lineCount)
  const failure = state.lineCount === 0 ? null : claimLines(state, owner, ownerKind, marked)
  if (failure !== null) return failure
  for (let line = 0; line < state.lineCount; line++) {
    const text = src.slice(state.lineStarts[line], lineEndAt(src, state.lineStarts, state.lineCount, line))
    const blank = text.trim() === ''
    if (owner[line] === -1 && marked[line] === 0 && text.replaceAll('>', '').trim() !== '') return `line ${line + 1}: no owner`
    if (owner[line] !== -1 && blank && !isOpaqueLeaf(ownerKind[line]!)) return `line ${line + 1}: a blank line with an owner`
  }
  return null
}

/** Records the owner of every line an event touches. A row owns its line and its cells share it. */
function claimLines(state: BlockState, owner: Int32Array, ownerKind: Int32Array, marked: Uint8Array): string | null {
  const events = state.events
  let leaf = -1
  let leafKind = -1
  for (let at = 0; at < state.eventLength; at += EVENT_WIDTH) {
    const tag = events[at]!
    const type = eventType(tag)
    const kind = eventKind(tag)
    const line = lineAt(state.lineStarts, state.lineCount, events[at + 1]!)
    if (type !== SPAN && kind === CELL) continue
    if (type !== SPAN && !isLeaf(kind) && kind !== ROW) {
      marked[line] = 1
      continue
    }
    if (type === ENTER) {
      leaf = at
      leafKind = kind
    }
    if (owner[line] !== -1 && owner[line] !== leaf) return `line ${line + 1}: two owners`
    owner[line] = leaf
    ownerKind[line] = leafKind
  }
  return null
}
