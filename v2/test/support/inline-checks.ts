// Properties that hold for the inline pass over every content of a document.
// `checkInlines` returns the first violation as text, or null.
import {
  acquireInlineState, type BlockNode, CAPTION, CELL, DIV, DOCUMENT, ENTER, EVENT_WIDTH, eventKind, eventType, EXIT,
  HEADING, type InlineState, LINE_BLOCK, PARAGRAPH, parseBlockTree, releaseInlineState, scanInline, SPAN, TERM,
} from '../../src/index.ts'

// A content that leaves openers of every kind on the stacks and every memo set.
const LEFTOVER_SOURCE = '*a /b {*c {=d [e ![f ^[g :h[i {% j {# k </#l [m](n "o [p][q `r'
const LEFTOVER = [0, LEFTOVER_SOURCE.length]

function hasInlineContent(kind: number): boolean {
  return kind === PARAGRAPH || kind === HEADING || kind === TERM || kind === CAPTION || kind === CELL
}

/** Every exit closes the node entered last, and offsets never go back and stay inside the content. */
function checkEvents(state: InlineState, start: number, end: number): string | null {
  const events = state.events
  const open: number[] = []
  let last = start
  for (let at = 0; at < state.eventLength; at += EVENT_WIDTH) {
    const tag = events[at]!
    const type = eventType(tag)
    const a = events[at + 1]!
    const to = type === SPAN ? events[at + 2]! : a
    if (a < last || to < a || to > end) return `event ${at}: offsets out of order`
    last = to
    if (type === ENTER) open.push(eventKind(tag))
    else if (type === EXIT && open.pop() !== eventKind(tag)) return `event ${at}: an exit that does not match its enter`
  }
  return open.length === 0 ? null : 'unclosed nodes at the end'
}

/**
 * Every character of the content lies in exactly one text span or node of the top level: the
 * ranges follow each other with no gap from the start of the content to its end, where only
 * trailing spaces and tabs are left out.
 */
function checkCoverage(state: InlineState, src: string, start: number, end: number): string | null {
  const events = state.events
  let depth = 0
  let cursor = start
  for (let at = 0; at < state.eventLength; at += EVENT_WIDTH) {
    const type = eventType(events[at]!)
    const a = events[at + 1]!
    if (depth === 0 && type !== EXIT && a !== cursor) return `offset ${cursor}: a gap or an overlap before ${a}`
    if (type === ENTER) depth++
    else if (type === EXIT) depth--
    if (depth === 0) cursor = type === SPAN ? events[at + 2]! : a
  }
  return src.slice(cursor, end).trim() === '' ? null : `offset ${cursor}: the end of the content is not covered`
}

function checkContent(state: InlineState, src: string, spans: number[], from: number, to: number, depth: number, lineComments: boolean): string | null {
  if (to === from) return null
  scanInline(state, src, spans, from, to, depth, lineComments)
  const failure = checkEvents(state, spans[from]!, spans[to - 1]!) ?? checkCoverage(state, src, spans[from]!, spans[to - 1]!)
  if (failure !== null) return failure
  const first = state.events.slice(0, state.eventLength)
  // The same state again, after another content: nothing may leak from one pass into the next.
  scanInline(state, LEFTOVER_SOURCE, LEFTOVER, 0, 2, 0, true)
  scanInline(state, src, spans, from, to, depth, lineComments)
  if (state.eventLength !== first.length) return 'a second pass differs'
  for (let at = 0; at < first.length; at++) if (state.events[at] !== first[at]) return 'a second pass differs'
  return null
}

function checkNode(state: InlineState, src: string, node: BlockNode, depth: number): string | null {
  if (node.children !== null) {
    const inner = node.kind > DOCUMENT && node.kind <= DIV ? depth + 1 : depth
    for (const child of node.children) {
      const failure = checkNode(state, src, child, inner)
      if (failure !== null) return failure
    }
    return null
  }
  const spans = node.spans!
  if (hasInlineContent(node.kind)) return checkContent(state, src, spans, 0, spans.length, depth, true)
  if (node.kind !== LINE_BLOCK) return null
  for (let at = 0; at < spans.length; at += 2) {
    const failure = checkContent(state, src, spans, at, at + 2, depth, false)
    if (failure !== null) return failure
  }
  return null
}

export function checkInlines(src: string): string | null {
  const state = acquireInlineState()
  try {
    return checkNode(state, src, parseBlockTree(src), 0)
  } finally {
    releaseInlineState(state)
  }
}
