import { buildTreeFromEvents, EventSink } from './events.ts'
import { BlockScanner } from './scanner.ts'
import { type BlockNode, TreeBuilder } from './tree.ts'

/** Variant A, first half: the block pass writes events only. */
export function scanToEvents(src: string, events: EventSink = new EventSink(src.length)): EventSink {
  new BlockScanner(src, events).scan()
  return events
}

/** Variant A with a fresh event array per parse, as an exported stream needs it. */
export function parseViaEvents(src: string): BlockNode {
  return buildTreeFromEvents(scanToEvents(src))
}

let reusedEvents: EventSink | null = null

/** Variant A with one event array kept across parses, as an engine-internal stream can do it. */
export function parseViaReusedEvents(src: string): BlockNode {
  const events = (reusedEvents ??= new EventSink(src.length))
  events.reset()
  return buildTreeFromEvents(scanToEvents(src, events))
}

/** Variant B: the block pass builds the tree directly. */
export function parseDirect(src: string): BlockNode {
  const builder = new TreeBuilder()
  new BlockScanner(src, builder).scan()
  return builder.root!
}

export { buildTreeFromEvents, EventSink } from './events.ts'
export { KIND_NAMES } from './kinds.ts'
export type { BlockNode } from './tree.ts'
