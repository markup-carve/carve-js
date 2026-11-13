import { scanBlocks } from './blocks.ts'
import { acquireState, releaseState } from './state.ts'
import { type BlockNode, buildTree } from './tree.ts'

export { scanBlocks } from './blocks.ts'
export { ENTER, EVENT_WIDTH, eventFlags, eventKind, eventType, EXIT, SPAN } from './events.ts'
export * from './kinds.ts'
export { columnAt, lineAt, lineEndAt } from './source.ts'
export { acquireState, type BlockState, MAX_DEPTH, releaseState } from './state.ts'
export { type BlockNode, buildTree } from './tree.ts'

/** Block tree of `src`. Leaves keep their source spans; inline content is not parsed. */
export function parseBlockTree(src: string): BlockNode {
  const state = acquireState()
  try {
    scanBlocks(state, src)
    return buildTree(state.events, state.eventLength)
  } finally {
    releaseState(state)
  }
}
