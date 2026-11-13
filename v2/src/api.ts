// The public interface of the 0.2 engine: `parse` gives the tree of contract 2.0, `render` gives HTML.
import { type AstNode } from './ast.ts'
import { buildDocument, type BuiltTree } from './ast-blocks.ts'
import { type LayoutTrace } from './ast-inline.ts'
import { validateTree } from './ast-validate.ts'
import { renderDocument } from './html.ts'
import { buildLayout, createLayoutTrace, type SourceLayout } from './layout.ts'
import { scanBlocks } from './blocks.ts'
import { acquireInlineState, releaseInlineState } from './inline-state.ts'
import { type Diagnostic, type Findings, locateFindings } from './diagnostics.ts'
import { type ParseOptions, readOptions, type RenderOptions, type Settings } from './options.ts'
import { utf8Length } from './positions.ts'
import { applyProfile } from './profile.ts'
import { type ProfileRule, PROFILES } from './render-tables.ts'
import { type Resolution, resolve } from './resolve.ts'
import { acquireState, releaseState } from './state.ts'
import { buildTree, readInlines } from './tree.ts'

export interface ParseResult {
  document: AstNode
  /** C2-A-172: the diagnostics record, beside the tree. */
  diagnostics: Diagnostic[]
}

export interface LayoutResult extends ParseResult {
  /** C2-L-001: the source-layout record, beside the tree. */
  layout: SourceLayout
}

export interface RenderOutput {
  html: string
  diagnostics: Diagnostic[]
}

/** C2-H-130: a render under `strictLosses` that lost something returns no output. */
export class CarveRenderError extends Error {
  diagnostics: Diagnostic[]

  constructor(diagnostics: Diagnostic[]) {
    super(`the render lost content: ${diagnostics.map((entry) => entry.code).join(', ')}`)
    this.name = 'CarveRenderError'
    this.diagnostics = diagnostics
  }
}

/** C2-H-163: an input longer than the profile accepts. It is refused before it is parsed. */
export class CarveInputError extends Error {
  constructor(profile: string, limit: number) {
    super(`the input is longer than the ${limit} bytes the profile ${profile} accepts`)
    this.name = 'CarveInputError'
  }
}

const NO_PROFILE: ProfileRule = PROFILES.get('full')!
const MAX_BYTES_PER_UNIT = 3

/** The tree of `src` before resolution, with the folded sources of its headings. */
function buildSource(src: string, positions: boolean, trace: LayoutTrace | null = null): BuiltTree {
  const blocks = acquireState()
  const inlines = acquireInlineState()
  try {
    scanBlocks(blocks, src)
    const root = buildTree(blocks.events, blocks.eventLength)
    readInlines(inlines, src, root, 0)
    return buildDocument(src, root, positions, undefined, trace)
  } finally {
    releaseInlineState(inlines)
    releaseState(blocks)
  }
}

/** The resolved tree of `src` with its diagnostics. Positions are on unless `positions` is false (C2-A-138). */
export function parseWithDiagnostics(src: string, options?: ParseOptions): ParseResult {
  const settings = readOptions(options, 'parse')
  const built = buildSource(src, options?.positions !== false)
  const resolution = resolve(built.document, settings.headingIds, built.facts)
  return { document: built.document, diagnostics: locateFindings(built.document, resolution.findings) }
}

/** The resolved tree of `src` (spec/0.2/ast.md). The diagnostics are not asked for, so none is given a position. */
export function parse(src: string, options?: ParseOptions): AstNode {
  const settings = readOptions(options, 'parse')
  const built = buildSource(src, options?.positions !== false)
  resolve(built.document, settings.headingIds, built.facts)
  return built.document
}

/**
 * The resolved tree of `src` with its diagnostics and its source-layout record (spec/0.2/source-layout.md).
 * The tree is the one `parse` gives (C2-L-003). Positions are always built, since the record states its ranges in them.
 */
export function parseWithLayout(src: string, options?: ParseOptions): LayoutResult {
  const settings = readOptions(options, 'parse')
  const trace = createLayoutTrace()
  const built = buildSource(src, true, trace)
  const resolution = resolve(built.document, settings.headingIds, built.facts)
  const diagnostics = locateFindings(built.document, resolution.findings)
  return { document: built.document, diagnostics, layout: buildLayout(src, built.document, trace) }
}

/** C2-H-163: refuses a source that is longer than the profile accepts, in UTF-8 bytes. */
function checkLength(src: string, settings: Settings, rule: ProfileRule): void {
  const limit = rule.maxLength
  if (limit < 0 || src.length * MAX_BYTES_PER_UNIT <= limit) return
  if (src.length > limit || utf8Length(src) > limit) throw new CarveInputError(settings.profile, limit)
}

/** The tree a render writes: built from source, or the supplied tree, which is validated first. */
function renderTree(input: string | AstNode, settings: Settings, rule: ProfileRule): BuiltTree {
  if (typeof input === 'string') {
    checkLength(input, settings, rule)
    // C2-H-016: only the source lines need positions.
    return buildSource(input, settings.sourceLines)
  }
  validateTree(input)
  // A profile replaces nodes, and the tree of the caller keeps its own.
  return { document: rule === NO_PROFILE ? input : structuredClone(input), facts: null }
}

interface Rendered {
  document: AstNode
  html: string
  resolution: Resolution
  losses: Findings
}

/** Resolves and writes the tree of `input`. A supplied tree is validated and resolved in place. */
function renderInput(input: string | AstNode, settings: Settings): Rendered {
  const rule = PROFILES.get(settings.profile) ?? NO_PROFILE
  const built = renderTree(input, settings, rule)
  const losses: Findings = { entries: [], nodes: [] }
  if (rule !== NO_PROFILE) applyProfile(built.document, settings.profile, rule, losses)
  const resolution = resolve(built.document, settings.headingIds, built.facts, settings.symbols)
  const result = renderDocument(built.document, settings, resolution, losses)
  return { document: built.document, html: result.html, resolution, losses }
}

/**
 * The HTML of Carve source or of a tree (spec/0.2/html.md), with the diagnostics of the run, each
 * with its position (C2-A-173). Under `strictLosses` a render that lost something returns no output.
 */
export function renderWithDiagnostics(input: string | AstNode, options?: RenderOptions): RenderOutput {
  const settings = readOptions(options, 'render')
  const rendered = renderInput(input, settings)
  const diagnostics = [...locateFindings(rendered.document, rendered.resolution.findings), ...locateFindings(rendered.document, rendered.losses)]
  return { html: settings.strictLosses && rendered.losses.entries.length > 0 ? '' : rendered.html, diagnostics }
}

/**
 * The HTML fragment of Carve source or of a tree. Under `strictLosses` a render loss throws. The
 * diagnostics are not asked for, so they are given a position only where a loss is thrown.
 */
export function render(input: string | AstNode, options?: RenderOptions): string {
  const settings = readOptions(options, 'render')
  const rendered = renderInput(input, settings)
  if (settings.strictLosses && rendered.losses.entries.length > 0) throw new CarveRenderError(locateFindings(rendered.document, rendered.losses))
  return rendered.html
}
