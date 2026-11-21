/**
 * The public API of Carve 0.2 (`@markup-carve/carve`). Every call of spec/0.2/tooling.md C2-T-005 is here, with the
 * typed errors of C2-T-040; nothing else of the engine is reachable through this entry.
 *
 * Provisional, and free to change in 0.2.x: the extension surface (`ExtensionDefinition`, `ExtensionRenderer`, the
 * `extensions` and `renderers` options, `tabsExtensions`, `tabsRenderer`), as spec/0.2/extensions.md states.
 */
import { decodeTree as decodeTreeImpl } from '../src/ast-json.ts'
import { CarveTreeError, type AnnotationRangeSidecar, validateTree as validateTreeImpl, validateTreeWithAnnotations } from '../src/ast-validate.ts'
import { migrateTree as migrateTreeImpl, type MigrateOptions, type MigrationResult } from '../migrate/index.ts'
import { type DocumentNode } from '../src/ast.ts'
import { type SmartPunctuationNode } from '../src/ast-nodes.ts'
import { SMART_GLYPHS, SMART_KIND_NAMES, SMART_SOURCES } from '../src/inline-tables.ts'
import { type ExtensionDefinition } from '../src/extensions/types.ts'
import { CarveOptionError, type HeadingIds, readOptions } from '../src/options.ts'
import { slugify } from '../src/slug.ts'
import { includeRegion as includeRegionImpl, type RegionResult } from '../src/include-source.ts'
import { FIXABLE_RULES, type FixEdit, fixEditsFor, type FixResult, fixSource } from '../lint/fix.ts'
import { type LintOptions } from '../lint/types.ts'
import { type Diagnostic } from '../src/diagnostics.ts'
import { type ApplyPatchOptions, applyPatch as applyPatchImpl, diffTree as diffTreeImpl, type PatchOperation, sourceFingerprint as
  sourceFingerprintImpl, treeFingerprint as treeFingerprintImpl } from '../src/tree-patch.ts'
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
export { encodeEnvelope, encodeTree, treesEqual } from '../src/ast-json.ts'
export { tryRenderHtmlStreaming, type StreamOutcome } from '../src/stream.ts'
export { createEditorSession, EditorChangeError, type EditorChange, type EditorSession, type EditorSnapshot, type EditorUpdate, type EditorRange, type EditorMappedNode, type EditorToken, type NodeIdentitySidecar } from '../src/editor-session.ts'
export { type AnnotationRangeSidecar, CarveTreeError, MAX_TREE_DEPTH } from '../src/ast-validate.ts'
export { type MigrateOptions, type MigrationResult } from '../migrate/index.ts'
export { LAYOUT_VERSION, type NodeLayout, type SourceLayout, type Wrap } from '../src/layout.ts'
export { CarveLayoutError, validateLayout } from '../src/layout-validate.ts'
export {
  CarveOptionError, type HeadingIds, type Mode, type ParseOptions, type Profile, type RenderOptions, type Social, type SocialRequest,
  type SoftBreak, type UrlPolicy,
} from '../src/options.ts'
export { positionOf, stringOffsetOfByte, utf8Length } from '../src/positions.ts'
export { NODE_TYPES, SPEC_VERSION, VERSION } from '../src/package-info.ts'
export { type RegionResult } from '../src/include-source.ts'
export { type ApplyPatchOptions, CarvePatchError, type PatchOperation } from '../src/tree-patch.ts'
export { format, type FormatOptions, type FormatOutput, formatWithDiagnostics } from '../src/format.ts'
export { CarveWriteError, type LayoutEntry, type WriteOutput } from '../src/write.ts'
export { type Diagnostic } from '../src/diagnostics.ts'
export {
  type IncludeAnswer, type IncludeConfig, type IncludeError, type IncludeRequest, type IncludeResolver,
} from '../src/include-settings.ts'
export { type IncludeDependency, includeDependencies, type IncludeDependencyOptions } from '../src/include-dependencies.ts'
export { flatten, type Flattened } from '../src/flatten.ts'
export { lint, type LintOptions } from '../lint/lint.ts'
export { type FixEdit, type FixResult } from '../lint/fix.ts'
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
  /** Optional annotation-range sidecar checked with the tree (C2-A-203). */
  annotations?: AnnotationRangeSidecar
}

/** The options of `validateTree` (C2-A-188). */
export interface ValidateOptions {
  /** Provisional: the registered standard extensions, read for the tree reader checks (C2-X-038). */
  extensions?: readonly ExtensionDefinition[]
  /** Optional annotation-range sidecar checked with the tree (C2-A-203). */
  annotations?: AnnotationRangeSidecar
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
  checkOptions(options, { extensions: 'extensions', source: 'string', annotations: 'annotations' })
  if (typeof json !== 'string') throw new CarveOptionError('json', 'not a string')
  return decodeTreeImpl(json, options?.source, options?.extensions, options?.annotations)
}

/** Refuses `document` with `CarveTreeError` unless it is a tree of contract 2.0 (C2-A-188). */
export function validateTree(document: unknown, options?: ValidateOptions): asserts document is DocumentNode {
  checkOptions(options, { extensions: 'extensions', annotations: 'annotations' })
  if (options?.annotations !== undefined) {
    validateTreeWithAnnotations(document, options.annotations, undefined, undefined, options?.extensions ?? [])
  }
  else validateTreeImpl(document, undefined, undefined, options?.extensions ?? [])
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

/** The options of `headingId`. */
export interface HeadingIdOptions {
  /** The value of the `headingIds` option (C2-H-022); `keep-case` unless given. */
  headingIds?: HeadingIds
}

/**
 * The id the `headingIds` option generates for a heading with the plain text `text` (C2-H-022, C2-H-143 to C2-H-148),
 * or null under `off`. Each call stands alone: the suffixes `-2`, `-3` that a document gives a repeated id (C2-H-024)
 * and the ids it already holds are not applied.
 */
export function headingId(text: string, options?: HeadingIdOptions): string | null {
  checkOptions(options, { headingIds: 'string' })
  if (typeof text !== 'string') throw new CarveOptionError('text', 'not a string')
  const mode = readOptions({ headingIds: options?.headingIds }, 'parse').headingIds
  return mode === 'off' ? null : slugify(text, mode)
}

/** The options of `includeRegion`. */
export interface IncludeRegionOptions {
  /** Selects as a code include does (`@code`): the markers are those of C2-N-039, and the text is the payload. */
  code?: boolean
}

/**
 * The region `name` of the file text `text`, as an include directive with `@region:name` selects it (C2-N-037 to
 * C2-N-043): its text and its first and last line, from 1. Where the directive reports `region_invalid`, `ok` is false
 * and `reason` says why.
 */
export function includeRegion(text: string, name: string, options?: IncludeRegionOptions): RegionResult {
  checkOptions(options, { code: 'boolean' })
  if (typeof text !== 'string') throw new CarveOptionError('text', 'not a string')
  if (typeof name !== 'string') throw new CarveOptionError('name', 'not a string')
  return includeRegionImpl(text, name, options?.code === true)
}

/** The JSON Patch (RFC 6902) that turns the encoded tree `a` into the encoded tree `b` (`encodeTree`). */
export function diffTree(a: DocumentNode, b: DocumentNode): PatchOperation[] {
  validateTreeImpl(a)
  validateTreeImpl(b)
  return diffTreeImpl(a, b)
}

/**
 * Applies a JSON Patch to the encoded tree and returns the decoded result. Refuses with one `CarvePatchError` (`path`,
 * `reason`) when `fingerprint` is not that of `document`, an operation fails, or the result does not decode.
 */
export function applyPatch(document: DocumentNode, patch: readonly PatchOperation[], options?: ApplyPatchOptions): DocumentNode {
  checkOptions(options, { fingerprint: 'string', extensions: 'extensions' })
  validateTreeImpl(document, undefined, undefined, options?.extensions ?? [])
  return applyPatchImpl(document, patch, options)
}

/** The fingerprint of a source, text or UTF-8 bytes: `sha256:` and the hex hash of its bytes. */
export function sourceFingerprint(source: string | Uint8Array): string {
  if (typeof source !== 'string' && !(source instanceof Uint8Array)) throw new CarveOptionError('source', 'not text or bytes')
  return sourceFingerprintImpl(source)
}

/** The fingerprint of a tree: the source fingerprint of `encodeTree(document)`. */
export function treeFingerprint(document: DocumentNode): string {
  validateTreeImpl(document)
  return treeFingerprintImpl(document)
}

/** The options of `fix`: those of `lint` without `includes`, since a fix rewrites only the source it is given. */
export type FixOptions = Omit<LintOptions, 'includes'>

/** The rules that `fix` and `fixEdits` rewrite, each to the one replacement its lint message names. */
export const fixableRules: readonly string[] = FIXABLE_RULES

function checkFixOptions(options: unknown): void {
  if (options === undefined) return
  if (typeof options !== 'object' || options === null || Array.isArray(options)) throw new CarveOptionError('fix', 'not an object')
  if ('includes' in options) throw new CarveOptionError('includes', 'unknown option')
}

/**
 * The source with every fix applied that holds, as `carve lint --fix` writes it, and the number of fixes by rule. Every
 * fixable rule is on unless `rules` turns it off. A fix whose node does not stand where its finding started is dropped.
 */
export function fix(source: string, options?: FixOptions): FixResult {
  if (typeof source !== 'string') throw new CarveOptionError('source', 'not a string')
  checkFixOptions(options)
  return fixSource(source, options ?? {})
}

/**
 * The edits that fix one finding `lint` reported for `source` (an editor quick fix), or null where its rule has no fix
 * or the fix would not hold. Ranges are UTF-8 byte offsets, as in the diagnostic. Unlike `fix`, a finding whose range
 * another rule reports with a different replacement still gets its edits, so an editor can offer each choice.
 */
export function fixEdits(source: string, diagnostic: Diagnostic): FixEdit[] | null {
  if (typeof source !== 'string') throw new CarveOptionError('source', 'not a string')
  if (typeof diagnostic !== 'object' || diagnostic === null) throw new CarveOptionError('diagnostic', 'not a diagnostic')
  return fixEditsFor(source, diagnostic)
}

/** One kind of `smart_punctuation` (C2-A-098): its `kind`, the `glyph` it renders and the `source` it is written as. */
export interface SmartPunctuationKind {
  kind: SmartPunctuationNode['kind']
  glyph: string
  source: string
}

/** C2-A-098: every kind of `smart_punctuation`, in the order of the schema. */
export const SMART_PUNCTUATION: readonly Readonly<SmartPunctuationKind>[] = Object.freeze(SMART_KIND_NAMES.map((kind, at) =>
  Object.freeze({ kind, glyph: SMART_GLYPHS[at]!, source: SMART_SOURCES[at]! })))
