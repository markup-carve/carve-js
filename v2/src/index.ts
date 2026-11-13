import { scanBlocks } from './blocks.ts'
import { acquireState, releaseState } from './state.ts'
import { acquireInlineState, releaseInlineState } from './inline-state.ts'
import { type BlockNode, buildTree, readInlines } from './tree.ts'

export { scanBlocks } from './blocks.ts'
export { ENTER, EVENT_WIDTH, eventFlags, eventKind, eventType, EXIT, SPAN } from './events.ts'
export * from './kinds.ts'
export * from './dispatch.ts'
export { definitionLabel, type OpenerInfo, readOpenerInfo } from './opener.ts'
export { columnAt, lineAt, lineEndAt } from './source.ts'
export { acquireState, type BlockState, MAX_DEPTH, releaseState } from './state.ts'
export { type BlockNode, buildTree, FACT_MASK, FACT_SHIFT, readInlines } from './tree.ts'
export * from './inline-kinds.ts'
export { scanInline } from './inline-scan.ts'
export { acquireInlineState, type InlineState, releaseInlineState } from './inline-state.ts'
export { type Attributes, buildInlineTree, foldLabel, type InlineNode, LINE, TEXT } from './inline-tree.ts'
export { SMART_GLYPHS, SMART_KIND_NAMES } from './inline-tables.ts'
export { type DelimitedTable, readDelimitedTable } from './delimited.ts'

export {
  CarveInputError, CarveRenderError, type LayoutResult, parse, type ParseResult, parseWithDiagnostics, parseWithLayout, render,
  type RenderOutput, renderWithDiagnostics,
} from './api.ts'
export {
  AST_VERSION, type AstNode, type Attrs, type Envelope, type ExtensionDeclaration, type Marker, type Position,
  type Resource, type RubyPair, type Task,
} from './ast.ts'
export { decodeTree, encodeEnvelope, encodeTree, treesEqual } from './ast-json.ts'
export { CarveTreeError, MAX_TREE_DEPTH, validateTree } from './ast-validate.ts'
export { LAYOUT_VERSION, type NodeLayout, type SourceLayout, type Wrap } from './layout.ts'
export { CarveLayoutError, validateLayout } from './layout-validate.ts'
export {
  CarveOptionError, type HeadingIds, type Mode, type Options, type ParseOptions, type Profile, type RenderOptions,
  type Social, type UrlPolicy,
} from './options.ts'
export { stringOffsetOfByte, utf8Length } from './positions.ts'
export { type Diagnostic } from './diagnostics.ts'

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

/** Tree of `src`: the block tree with the inline content of every text leaf and cell. */
export function parseTree(src: string): BlockNode {
  const root = parseBlockTree(src)
  const state = acquireInlineState()
  try {
    readInlines(state, src, root, 0)
    return root
  } finally {
    releaseInlineState(state)
  }
}
