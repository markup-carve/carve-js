/**
 * The 0.2 engine. Source becomes HTML in three stages, each callable on its own with typed input and output:
 *
 * - `parseTree(src)` gives a `ParsedTree`: the tree before resolution (C2-A-106) and what the parse knows of it.
 *   It does no resolution.
 *   `const parsed = parseTree('# Title\n\nSee [Title][].')`
 * - `resolveTree(parsed, options)` gives a `ResolvedTree`: the tree resolved in place for a render with
 *   `options`, and the results a renderer needs besides the tree. It also takes a supplied tree, which it validates.
 *   `const resolved = resolveTree(parsed, { headingIds: 'lower' })`, then read `resolved.document`.
 * - `renderTree(resolved)` gives the HTML. It changes nothing in the tree, so it can run again.
 *   `const html = renderTree(resolved)`
 *
 * `render(src, options)` is `renderTree(resolveTree(parseTree(src), options))`, and `parse(src)` is the
 * document of `resolveTree(parseTree(src))`. `write(tree)` turns a tree back into source. Positions,
 * the source-layout record (`parseWithLayout`) and diagnostics (`...WithDiagnostics`) are built only where asked for.
 */
import { scanBlocks } from './blocks.ts'
import { acquireState, releaseState } from './state.ts'
import { type BlockNode, buildTree } from './tree.ts'

export { scanBlocks } from './blocks.ts'
export { ENTER, EVENT_WIDTH, eventFlags, eventKind, eventType, EXIT, SPAN } from './events.ts'
export * from './kinds.ts'
export * from './dispatch.ts'
export { definitionLabel, type OpenerInfo, readOpenerInfo } from './opener.ts'
export { columnAt, lineAt, lineEndAt } from './source.ts'
export { acquireState, type BlockState, MAX_DEPTH, releaseState } from './state.ts'
export { type BlockNode, buildTree } from './tree.ts'
export * from './inline-kinds.ts'
export { scanInline } from './inline-scan.ts'
export { acquireInlineState, type InlineState, releaseInlineState } from './inline-state.ts'
export { type Attributes, foldLabel } from './ast-attributes.ts'
export { SMART_GLYPHS, SMART_KIND_NAMES } from './inline-tables.ts'
export { type DelimitedTable, readDelimitedTable } from './delimited.ts'

export {
  CarveInputError, CarveRenderError, type LayoutResult, parse, type ParsedTree, type ParseResult, parseTree, parseWithDiagnostics,
  parseWithLayout, render, type RenderOutput, renderTree, renderWithDiagnostics, type ResolvedTree, resolveTree,
} from './api.ts'
export {
  AST_VERSION, type Attrs, type Envelope, type ExtensionDeclaration, type Marker, type Position,
  type Resource, type RubyPair, type Task,
} from './ast.ts'
export type * from './ast-nodes.ts'
export { decodeTree, encodeEnvelope, encodeTree, treesEqual } from './ast-json.ts'
export { CarveTreeError, MAX_TREE_DEPTH, validateTree } from './ast-validate.ts'
export { LAYOUT_VERSION, type NodeLayout, type SourceLayout, type Wrap } from './layout.ts'
export { CarveLayoutError, validateLayout } from './layout-validate.ts'
export {
  CarveOptionError, type HeadingIds, type Mode, type Options, type ParseOptions, type Profile, type RenderOptions,
  type Social, type UrlPolicy,
} from './options.ts'
export { stringOffsetOfByte, utf8Length } from './positions.ts'
export { format, type FormatOptions, type FormatOutput, formatWithDiagnostics } from './format.ts'
export { type LayoutEntry, write, type WriteOptions, type WriteOutput, writeWithDiagnostics } from './write.ts'
export { displayWidth } from './width.ts'
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
