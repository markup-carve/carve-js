// The public interface of the 0.2 engine: `parse` gives the tree of contract 2.0, `render` gives HTML.
// Both are compositions of three stages: parse (source to tree), resolve (tree to resolved tree) and render.
import { type AstNode } from './ast.ts'
import { buildSource, type ParsedTree } from './ast-blocks.ts'
import { validateTree } from './ast-validate.ts'
import { renderDocument } from './html.ts'
import { buildLayout, createLayoutTrace, type SourceLayout } from './layout.ts'
import { type Diagnostic, type Findings, locateFindings } from './diagnostics.ts'
import { type ParseOptions, readOptions, type RenderOptions, type Settings } from './options.ts'
import { utf8Length } from './positions.ts'
import { applyProfile } from './profile.ts'
import { type ProfileRule, PROFILES } from './render-tables.ts'
import { type Resolution, resolve } from './resolve.ts'

export { type ParsedTree } from './ast-blocks.ts'

export interface ParseResult {
  document: AstNode
  /** C2-A-172: the diagnostics record, beside the tree. */
  diagnostics: Diagnostic[]
}

export interface LayoutResult extends ParseResult {
  /** C2-L-001: the source-layout record, beside the tree. */
  layout: SourceLayout
}

/** The output of the resolve stage: the resolved tree and what a render of it needs besides the tree. */
export interface ResolvedTree {
  readonly document: AstNode
  /** The options of the render the tree was resolved for. */
  readonly settings: Settings
  readonly resolution: Resolution
  /** C2-H-130: what the profile took out of the tree, in the render-loss channel. */
  readonly losses: Findings
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

function profileRule(settings: Settings): ProfileRule {
  return PROFILES.get(settings.profile) ?? NO_PROFILE
}

/** C2-H-163: refuses a source that is longer than the profile accepts, in UTF-8 bytes. */
function checkLength(src: string, settings: Settings): void {
  const limit = profileRule(settings).maxLength
  if (limit < 0 || src.length * MAX_BYTES_PER_UNIT <= limit) return
  if (src.length > limit || utf8Length(src) > limit) throw new CarveInputError(settings.profile, limit)
}

/** The parse stage of a render: source is parsed, and a supplied tree is validated first. */
function inputStage(input: string | AstNode, settings: Settings): ParsedTree {
  if (typeof input === 'string') {
    checkLength(input, settings)
    // C2-H-016: only the source lines need positions.
    return buildSource(input, settings.sourceLines)
  }
  validateTree(input)
  // A profile replaces nodes, and the tree of the caller keeps its own.
  return { document: profileRule(settings) === NO_PROFILE ? input : structuredClone(input), facts: null }
}

/** The resolve stage: the profile of `settings` is applied, then the tree is resolved in place. */
function resolveStage(parsed: ParsedTree, settings: Settings): ResolvedTree {
  const rule = profileRule(settings)
  const losses: Findings = { entries: [], nodes: [] }
  if (rule !== NO_PROFILE) applyProfile(parsed.document, settings.profile, rule, losses)
  const resolution = resolve(parsed.document, settings.headingIds, parsed.facts, settings.symbols)
  return { document: parsed.document, settings, resolution, losses }
}

/** The render stage. It writes the resolved tree and changes nothing in it, so it can run more than once. */
function renderStage(resolved: ResolvedTree): { html: string, losses: Findings } {
  const losses: Findings = { entries: [...resolved.losses.entries], nodes: [...resolved.losses.nodes] }
  return renderDocument(resolved.document, resolved.settings, resolved.resolution, losses)
}

/** The parse stage: the tree of `src` before resolution (C2-A-106). Positions are on unless `positions` is false. */
export function parseTree(src: string, options?: ParseOptions): ParsedTree {
  readOptions(options, 'parse')
  return buildSource(src, options?.positions !== false)
}

/**
 * The resolve stage: resolves a parsed tree, or a supplied tree after validating it, for a render
 * with `options`. A parsed tree is resolved in place; a supplied tree is copied first where the profile replaces nodes.
 */
export function resolveTree(input: ParsedTree | AstNode, options?: RenderOptions): ResolvedTree {
  const settings = readOptions(options, 'render')
  const parsed = 'type' in input ? inputStage(input, settings) : input
  return resolveStage(parsed, settings)
}

/**
 * The render stage: the HTML fragment of a resolved tree, with the options it was resolved for.
 * Under `strictLosses` a render loss throws.
 */
export function renderTree(resolved: ResolvedTree): string {
  const rendered = renderStage(resolved)
  if (!resolved.settings.strictLosses || rendered.losses.entries.length === 0) return rendered.html
  throw new CarveRenderError(locateFindings(resolved.document, rendered.losses))
}

/** The resolved tree of `src` with its diagnostics. Positions are on unless `positions` is false (C2-A-138). */
export function parseWithDiagnostics(src: string, options?: ParseOptions): ParseResult {
  const settings = readOptions(options, 'parse')
  const resolved = resolveStage(buildSource(src, options?.positions !== false), settings)
  return { document: resolved.document, diagnostics: locateFindings(resolved.document, resolved.resolution.findings) }
}

/** The resolved tree of `src` (spec/0.2/ast.md). The diagnostics are not asked for, so none is given a position. */
export function parse(src: string, options?: ParseOptions): AstNode {
  const settings = readOptions(options, 'parse')
  return resolveStage(buildSource(src, options?.positions !== false), settings).document
}

/**
 * The resolved tree of `src` with its diagnostics and its source-layout record (spec/0.2/source-layout.md).
 * The tree is the one `parse` gives (C2-L-003). Positions are always built, since the record states its ranges in them.
 */
export function parseWithLayout(src: string, options?: ParseOptions): LayoutResult {
  const settings = readOptions(options, 'parse')
  const trace = createLayoutTrace()
  const resolved = resolveStage(buildSource(src, true, null, trace), settings)
  const diagnostics = locateFindings(resolved.document, resolved.resolution.findings)
  return { document: resolved.document, diagnostics, layout: buildLayout(src, resolved.document, trace) }
}

/**
 * The HTML of Carve source or of a tree (spec/0.2/html.md), with the diagnostics of the run, each
 * with its position (C2-A-173). Under `strictLosses` a render that lost something returns no output.
 */
export function renderWithDiagnostics(input: string | AstNode, options?: RenderOptions): RenderOutput {
  const settings = readOptions(options, 'render')
  const resolved = resolveStage(inputStage(input, settings), settings)
  const rendered = renderStage(resolved)
  const found = locateFindings(resolved.document, resolved.resolution.findings)
  const diagnostics = [...found, ...locateFindings(resolved.document, rendered.losses)]
  return { html: settings.strictLosses && rendered.losses.entries.length > 0 ? '' : rendered.html, diagnostics }
}

/**
 * The HTML fragment of Carve source or of a tree: the three stages in a row. Under `strictLosses`
 * a render loss throws. The diagnostics are not asked for, so they are given a position only where a loss is thrown.
 */
export function render(input: string | AstNode, options?: RenderOptions): string {
  const settings = readOptions(options, 'render')
  return renderTree(resolveStage(inputStage(input, settings), settings))
}
