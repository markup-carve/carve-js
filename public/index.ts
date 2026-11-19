/**
 * The public API of Carve 0.2 (`@markup-carve/carve`). Every call of spec/0.2/tooling.md C2-T-005 is here, with the
 * typed errors of C2-T-040; nothing else of the engine is reachable through this entry.
 *
 * Provisional, and free to change in 0.2.x: the extension surface (`ExtensionDefinition`, `ExtensionRenderer`, the
 * `extensions` and `renderers` options, `tabsExtensions`, `tabsRenderer`), as spec/0.2/extensions.md states.
 */
import { decodeTree as decodeTreeImpl } from '../src/ast-json.ts'
import { CarveTreeError, validateTree as validateTreeImpl } from '../src/ast-validate.ts'
import { migrateTree as migrateTreeImpl, type MigrateOptions, type MigrationResult } from '../migrate/index.ts'
import { type DocumentNode } from '../src/ast.ts'
import { type ExtensionDefinition } from '../src/extensions/types.ts'
import { CarveOptionError } from '../src/options.ts'
import { type LayoutEntry, write as writeImpl, writeWithDiagnostics as writeWithDiagnosticsImpl, type WriteOutput } from '../src/write.ts'
import { checkOptions } from './check.ts'

export {
  CarveInputError, CarveRenderError, type LayoutResult, parse, type ParseResult, parseWithDiagnostics, parseWithLayout, render,
  type RenderOutput, renderWithDiagnostics, renderWithDocumentTransforms, type DocumentTransform,
} from '../src/api.ts'
export {
  AST_VERSION, type Attrs, type BibliographyMetadata, type CitationLocator, type Envelope, type ExtensionDeclaration,
  type IncludeOptions, type Marker, type Metadata, type MetadataValue, type Position, type Resource, type Task,
} from '../src/ast.ts'
export type * from '../src/ast-nodes.ts'
export { encodeEnvelope, encodeTree } from '../src/ast-json.ts'
export { type AnnotationRangeSidecar, CarveTreeError, MAX_TREE_DEPTH } from '../src/ast-validate.ts'
export { type MigrateOptions, type MigrationResult } from '../migrate/index.ts'
export { LAYOUT_VERSION, type NodeLayout, type SourceLayout, type Wrap } from '../src/layout.ts'
export { CarveLayoutError, validateLayout } from '../src/layout-validate.ts'
export {
  CarveOptionError, type HeadingIds, type Mode, type ParseOptions, type Profile, type RenderOptions, type Social, type SocialRequest,
  type UrlPolicy,
} from '../src/options.ts'
export { stringOffsetOfByte, utf8Length } from '../src/positions.ts'
export { format, type FormatOptions, type FormatOutput, formatWithDiagnostics } from '../src/format.ts'
export { CarveWriteError, type LayoutEntry, type WriteOutput } from '../src/write.ts'
export { type Diagnostic } from '../src/diagnostics.ts'
export {
  type IncludeAnswer, type IncludeConfig, type IncludeError, type IncludeRequest, type IncludeResolver,
} from '../src/include-settings.ts'
export { type IncludeDependency, includeDependencies } from '../src/include-dependencies.ts'
export { lint, type LintOptions } from '../lint/lint.ts'
export { isUrlAllowed, urlScheme } from '../src/html-attributes.ts'
export { DEFAULT_DENIED_SCHEMES } from '../src/option-tables.ts'
/** Provisional (spec/0.2/extensions.md): may change in 0.2.x. */
export {
  type ExtensionClaim, type ExtensionDefinition, type ExtensionRenderer, type ExtensionRenderHost, type ExtensionSlot,
  type ExtensionSource,
} from '../src/extensions/types.ts'
/** Provisional (spec/0.2/extensions.md): the standard tabs extension and its renderer. */
export { tabsExtensions, tabsRenderer } from '../src/extensions/tabs.ts'
export { importDocument, ImportInputError, type ImportDiagnostic, type ImportOptions, type ImportResult } from './import.ts'
export {
  createWriterRegistry, RESERVED_WRITER_TARGETS, type Writer, type WriterOptions, type WriterRegistry, type WriterResult,
  writeDocument,
} from './writers.ts'

/** The options of `write` and `writeWithDiagnostics` (C2-W-001, C2-W-102). */
export interface WriteOptions {
  /** Provisional: the extensions whose nodes the writer spells (C2-X-038). */
  extensions?: readonly ExtensionDefinition[]
  /** The sidecar of the tree (C2-L-004). Only its node entries are read. */
  layout?: { nodes: readonly LayoutEntry[] }
  /** C2-W-068: pads the cells of each column of a pipe table to one display width. */
  alignTables?: boolean
  /** C2-W-002: reads each written group of blocks back and compares it with the tree. On unless `false`. */
  check?: boolean
}

/** The options of `decodeTree` (C2-A-188). */
export interface DecodeOptions {
  /** Provisional: the registered standard extensions, read for the tree reader checks (C2-X-038). */
  extensions?: readonly ExtensionDefinition[]
  /** The source the tree was parsed from, for the checks of its positions. */
  source?: string
}

/** The options of `validateTree` (C2-A-188). */
export interface ValidateOptions {
  /** Provisional: the registered standard extensions, read for the tree reader checks (C2-X-038). */
  extensions?: readonly ExtensionDefinition[]
}

const WRITE_OPTIONS = { extensions: 'extensions', layout: 'layout', alignTables: 'boolean', check: 'boolean' } as const

/** The canonical Carve source of a tree (C2-W-001). Throws `CarveWriteError` where the writer loses something. */
export function write(document: DocumentNode, options?: WriteOptions): string {
  checkOptions(options, WRITE_OPTIONS)
  return writeImpl(document, options)
}

/** The canonical Carve source of a tree with the diagnostics of the writer (C2-W-134). */
export function writeWithDiagnostics(document: DocumentNode, options?: WriteOptions): WriteOutput {
  checkOptions(options, WRITE_OPTIONS)
  return writeWithDiagnosticsImpl(document, options)
}

/** Reads a tree of contract 2.0, bare or in an envelope, from JSON text (C2-A-188). Refuses with `CarveTreeError`. */
export function decodeTree(json: string, options?: DecodeOptions): DocumentNode {
  checkOptions(options, { extensions: 'extensions', source: 'string' })
  if (typeof json !== 'string') throw new CarveOptionError('json', 'not a string')
  return decodeTreeImpl(json, options?.source, options?.extensions)
}

/** Refuses `document` with `CarveTreeError` unless it is a tree of contract 2.0 (C2-A-188). */
export function validateTree(document: unknown, options?: ValidateOptions): asserts document is DocumentNode {
  checkOptions(options, { extensions: 'extensions' })
  validateTreeImpl(document, undefined, undefined, options?.extensions ?? [])
}

/**
 * Upgrades the JSON value of a 1.x or draft tree, bare or in an envelope, to contract 2.0 (C2-A-178, C2-A-180).
 * Refuses a value it cannot read as a tree with `CarveTreeError`.
 */
export function migrateTree(json: unknown, options?: MigrateOptions): MigrationResult {
  checkOptions(options, { source: 'string' })
  try {
    return migrateTreeImpl(json, options)
  } catch (error) {
    if (error instanceof CarveTreeError || !(error instanceof Error)) throw error
    throw new CarveTreeError('', error.message)
  }
}
