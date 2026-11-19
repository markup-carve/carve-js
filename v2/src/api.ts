// The public interface of the 0.2 engine: `parse` gives the tree of contract 2.0, `render` gives HTML.
// Both are compositions of three stages: parse (source to tree), resolve (tree to resolved tree) and render.
import { type DocumentNode, forEachSlot } from './ast.ts'
import { buildSource, type ParseFacts, type ParsedTree } from './ast-blocks.ts'
import { expandTree, reportNoResolver } from './expand.ts'
import { type LayoutTrace } from './ast-inline.ts'
import { validateTree } from './ast-validate.ts'
import { renderDocument } from './html.ts'
import { buildLayout, createLayoutTrace, type SourceLayout } from './layout.ts'
import { type Diagnostic, type Findings, locateFindings } from './diagnostics.ts'
import { type ParseOptions, readOptions, type RenderOptions, type Settings } from './options.ts'
import { type Node } from './ast.ts'
import { utf8Length } from './positions.ts'
import { INCLUDE_CAUSES } from './include-tables.ts'
import { admitsType, applyProfile, liveResolution } from './profile.ts'
import { type ProfileRule, PROFILES } from './render-tables.ts'
import { type Resolution, resolve } from './resolve.ts'
import { applyExtensions, declareExtensions } from './extensions/claims.ts'
import { base64, mapPositions, type SourceText, sourceText } from './byte-source.ts'
import { append } from './append.ts'
import { emptyMemo, readAttributeBlock } from './attributes.ts'

export { type ParsedTree } from './ast-blocks.ts'

export interface ParseResult {
  document: DocumentNode
  /** C2-A-172: the diagnostics record, beside the tree. */
  diagnostics: Diagnostic[]
  /** C2-T-024: the include diagnostics past the cap that were counted, not kept. */
  suppressedDiagnostics: number
}

export interface LayoutResult extends ParseResult {
  /** C2-A-003: the source-layout record, beside the tree. */
  layout: SourceLayout
}

/** The output of the resolve stage: the resolved tree and what a render of it needs besides the tree. */
export interface ResolvedTree {
  readonly document: DocumentNode
  /** The options of the render the tree was resolved for. */
  readonly settings: Settings
  readonly resolution: Resolution
  /** C2-H-130: what the profile took out of the tree, in the render-loss channel. */
  readonly losses: Findings
  /** C2-H-172: false where the text nodes are known to hold no bidirectional control. */
  readonly bidi: boolean
  /** C2-H-201: the source of a parsed tree, or its byte length. */
  readonly source?: string | number
}

export interface RenderOutput {
  html: string
  diagnostics: Diagnostic[]
  /** C2-T-024: the include diagnostics past the cap that were counted, not kept. */
  suppressedDiagnostics: number
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

/** The facts of the top-level parse with those of every included file and the findings of the expansion. */
function combinedFacts(top: ParseFacts, files: readonly ParseFacts[], found: Findings): ParseFacts {
  const all = [top, ...files]
  const leaves = new Set(top.resolvableLeaves)
  for (const facts of files) for (const leaf of facts.resolvableLeaves) leaves.add(leaf)
  let names: Map<Node, string> | null = null
  if (top.sourceNames !== null) names = new Map(all.flatMap((facts) => [...facts.sourceNames ?? []]))
  return {
    ...top,
    sourceNames: names,
    resolvableLeaves: leaves,
    bidi: all.some((facts) => facts.bidi),
    addFindings: (findings) => {
      for (const facts of all) facts.addFindings(findings)
      append(findings.entries, found.entries)
      append(findings.nodes, found.nodes)
    },
    footnoteLines: (node) => all.reduce((lines, facts) => lines || facts.footnoteLines(node), 0),
    markupLine: (node) => {
      for (const facts of all) {
        const line = facts.markupLine(node)
        if (line !== undefined) return line
      }
      return undefined
    },
  }
}

/**
 * C2-N-003, C2-N-006: the parse of a top-level source, with its includes expanded when the options give a resolver.
 * Without one every include is reported, and a source without includes is returned as it was parsed.
 */
function parseSource(src: string, settings: Settings, positions: boolean, trace: LayoutTrace | null = null): ParsedTree {
  const names = settings.extensions.length > 0
  const parse = (text: string, outer: ParseFacts['scope'] | null, forced = false, frontmatterOpens = true): ParsedTree => applyExtensions(
    buildSource(text, positions || forced, null, outer === null ? trace : null, names, null, outer, frontmatterOpens), settings.extensions,
  )
  const parsed = parse(src, null)
  const facts = parsed.facts
  const includes = settings.includes
  // C2-N-006: expansion runs where a resolver is given, also over a document that holds no include.
  if (includes !== null) parsed.document.stages = ['includeExpansion']
  if (facts === null || facts.includes.length === 0) return parsed
  if (includes === null) {
    const found: Findings = { entries: [], nodes: [] }
    reportNoResolver(facts.includes, found)
    return { document: parsed.document, facts: combinedFacts(facts, [], found) }
  }
  const expanded = expandTree(parsed, includes, parse, settings.headingIds, positions)
  if (settings.extensions.length > 0) declareExtensions(parsed.document, settings.extensions)
  return { document: parsed.document, facts: combinedFacts(facts, expanded.facts, expanded.findings) }
}

/** C2-B-218: the parse of a string or of bytes; the positions of bytes count the source bytes. */
function parseInput(source: SourceText, settings: Settings, positions: boolean, trace: LayoutTrace | null = null): ParsedTree {
  const parsed = parseSource(source.text, settings, positions, trace)
  const bytes = source.bytes
  if (bytes !== null) {
    mapPositions(source, parsed.document)
    parsed.document.srcByteLength = bytes.length
  }
  return { ...parsed, source: bytes?.length ?? source.text }
}

/** The parse stage of a render: source is parsed, and a supplied tree is validated first. */
function inputStage(input: string | Uint8Array | DocumentNode, settings: Settings, diagnostics = false): ParsedTree {
  if (typeof input === 'string' || input instanceof Uint8Array) {
    const source = sourceText(input)
    checkLength(source.text, settings)
    // C2-H-016: only the source lines need positions.
    return parseInput(source, settings, settings.sourceLines || diagnostics)
  }
  validateTree(input, undefined, undefined, settings.extensions)
  return { document: input, facts: null }
}

/** The resolve stage: the tree is resolved in place. C2-H-121: the profile waits for the render. */
function resolveStage(parsed: ParsedTree, settings: Settings): ResolvedTree {
  const rule = profileRule(settings)
  const losses: Findings = { entries: [], nodes: [] }
  const admitted = { block: admitsType(rule, 'block_extension', true), inline: admitsType(rule, 'inline_extension', false) }
  const selectedRenderers = Object.fromEntries(Object.entries(settings.renderers).filter(([, renderer]) =>
    settings.mode === 'static' ? renderer.buildTime !== undefined : renderer.render !== undefined))
  const resolution = resolve(parsed.document, settings.headingIds, parsed.facts, settings.symbols, selectedRenderers, admitted)
  // A degraded node turns source that the inline scan did not read into text.
  const bidi = parsed.facts === null || rule !== NO_PROFILE || parsed.facts.bidi
  const source = parsed.source
  return { document: parsed.document, settings, resolution, losses, bidi, ...(source === undefined ? {} : { source }) }
}

/**
 * The render stage. The profile degrades nodes for this render only, and every list it changed is put
 * back, so the resolved tree is the same afterwards and the stage can run more than once.
 */
function renderStage(resolved: ResolvedTree): { html: string, losses: Findings } {
  const { document, settings } = resolved
  const losses: Findings = { entries: [...resolved.losses.entries], nodes: [...resolved.losses.nodes] }
  const rule = profileRule(settings)
  if (rule === NO_PROFILE) return renderDocument(document, settings, resolved.resolution, losses, resolved.bidi, resolved.source)
  const run = applyProfile(document, settings.profile, rule, losses, resolved.resolution.xrefText)
  try {
    const resolution = liveResolution(resolved.resolution, run.gone, run.goneTargets)
    return renderDocument(document, settings, resolution, losses, resolved.bidi, resolved.source)
  } finally {
    run.restore()
  }
}

/** The parse stage: the tree of `src` before resolution (C2-A-106). Positions are on unless `positions` is false. */
export function parseTree(src: string | Uint8Array, options?: ParseOptions): ParsedTree {
  const settings = readOptions(options, 'parse')
  return parseInput(sourceText(src), settings, options?.positions !== false)
}

/**
 * The resolve stage: resolves a parsed tree, or a supplied tree after validating it, for a render
 * with `options`. A parsed tree is resolved in place; a supplied tree is copied first where the profile replaces nodes.
 */
export function resolveTree(input: ParsedTree | DocumentNode, options?: RenderOptions): ResolvedTree {
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

/**
 * C2-A-172: the findings of the parse channel, each with its position: those the tree builder noted, in document
 * order, then those of resolution. The notes get their messages here, so a parse that asks for none writes none.
 */
/** The authored id part of one parsed attribute block, excluding quoted values that resemble an id. */
function idPartInBlock(raw: string, open: number, end: number, id: string): number {
  let quote = ''
  for (let at = open + 1; at < end - 1; at++) {
    const ch = raw[at]
    if (quote !== '') {
      if (ch === '\\') at++
      else if (ch === quote) quote = ''
      continue
    }
    if (ch === '"' || ch === "'") { quote = ch; continue }
    if (ch === '#' && raw.slice(at + 1, at + 1 + id.length) === id
      && (raw[at - 1] === '{' || raw[at - 1] === ' ')
      && (raw[at + 1 + id.length] === '}' || raw[at + 1 + id.length] === ' ')) return at
  }
  return -1
}

/** Find the id in parsed attribute blocks, not an earlier marker-shaped piece of text. */
function authoredIdAt(raw: string, id: string, limit: number, leading: boolean): number {
  let found = -1
  for (let open = raw.indexOf('{'); open >= 0 && open < limit; open = raw.indexOf('{', open + 1)) {
    const end = readAttributeBlock(raw, open, limit, emptyMemo(), null)
    if (end < 0) continue
    const at = idPartInBlock(raw, open, end, id)
    if (at >= 0) {
      if (leading) return at
      found = at
    }
    open = end - 1
  }
  return found
}

function attributeLimit(raw: string, startLine: number, markupLine: number | undefined): number {
  if (markupLine === undefined || markupLine <= startLine) return raw.length
  let at = 0
  for (let remaining = markupLine - startLine; remaining > 0; remaining--) {
    const next = raw.indexOf('\n', at)
    if (next < 0) return raw.length
    at = next + 1
  }
  return at
}

function locateAuthoredId(entry: Diagnostic, node: Node, parsed: ParsedTree, source: Uint8Array): void {
  const id = node.attrs?.id
  const pos = node.pos
  if (id === undefined || pos === undefined) return
  const raw = new TextDecoder().decode(source.subarray(pos.startOffset, pos.endOffset))
  const marker = `#${id}`
  const markupLine = parsed.facts?.markupLine(node)
  const limit = attributeLimit(raw, pos.startLine, markupLine)
  const at = authoredIdAt(raw, id, limit, limit < raw.length)
  if (at < 0) return
  const startOffset = pos.startOffset + utf8Length(raw.slice(0, at))
  entry.range = { startOffset, endOffset: startOffset + utf8Length(marker) }
}

/** C2-B-085: the definition marker follows any attached attribute lines. */
function footnoteMarkerRange(source: Uint8Array, start: number, limit: number): { startOffset: number, endOffset: number } {
  let marker = start
  while (marker + 1 < limit && (source[marker] !== 91 || source[marker + 1] !== 94)) {
    while (marker < limit && source[marker] !== 10) marker++
    marker++
  }
  if (marker + 1 >= limit) return { startOffset: start, endOffset: limit }
  for (let at = marker + 2; at + 1 < limit; at++) {
    if (source[at] === 92) { at++; continue }
    if (source[at] === 93 && source[at + 1] === 58) return { startOffset: marker, endOffset: at + 2 }
    if (source[at] === 10 || source[at] === 13) break
  }
  return { startOffset: marker, endOffset: limit }
}

function parseDiagnostics(resolved: ResolvedTree, parsed: ParsedTree): Diagnostic[] {
  const found = resolved.resolution.findings
  const noted: Findings = { entries: [], nodes: [] }
  parsed.facts?.addFindings(noted)
  const findings = noted.entries.length === 0 ? found
    : { entries: [...noted.entries, ...found.entries], nodes: [...noted.nodes, ...found.nodes] }
  const diagnostics = locateFindings(resolved.document, findings)
  if (typeof parsed.source !== 'string') return diagnostics
  const encoder = new TextEncoder()
  const source = encoder.encode(parsed.source)
  diagnostics.forEach((entry, index) => {
    if (entry.file !== undefined) return
    const node = findings.nodes[index]
    const pos = node?.pos
    if (node === undefined || node === null || pos === undefined) return
    if (entry.code === 'duplicate-footnote-definition') {
      entry.range = footnoteMarkerRange(source, pos.startOffset, pos.endOffset)
      return
    }
    if (entry.code === 'duplicate-id') locateAuthoredId(entry, node, parsed, source)
  })
  return diagnostics
}

const CAUSE_CODES: ReadonlySet<string> = new Set([...INCLUDE_CAUSES.values()].map((cause) => cause.code))

/** C2-T-024: the first `max` entries whose code is that of an include cause are kept, and the others counted. */
function capIncludeDiagnostics(diagnostics: Diagnostic[], max: number): { diagnostics: Diagnostic[], suppressedDiagnostics: number } {
  const retained: Diagnostic[] = []
  let suppressedDiagnostics = 0
  let kept = 0
  for (const entry of diagnostics) {
    if (CAUSE_CODES.has(entry.code) && kept++ >= max) suppressedDiagnostics++
    else retained.push(entry)
  }
  return { diagnostics: retained, suppressedDiagnostics }
}

/** The resolved tree of `src` with its diagnostics. Positions are on unless `positions` is false (C2-A-138). */
export function parseWithDiagnostics(src: string | Uint8Array, options?: ParseOptions): ParseResult {
  const settings = readOptions(options, 'parse')
  const parsed = parseInput(sourceText(src), settings, options?.positions !== false)
  const resolved = resolveStage(parsed, settings)
  return { document: resolved.document, ...capIncludeDiagnostics(parseDiagnostics(resolved, parsed),
    settings.includes?.maxDiagnostics ?? 100) }
}

/** The resolved tree of `src` (spec/0.2/ast.md). The diagnostics are not asked for, so none is given a position. */
export function parse(src: string | Uint8Array, options?: ParseOptions): DocumentNode {
  const settings = readOptions(options, 'parse')
  return resolveStage(parseInput(sourceText(src), settings, options?.positions !== false), settings).document
}

/**
 * The resolved tree of `src` with its diagnostics and its source-layout record (spec/0.2/source-layout.md).
 * The tree is the one `parse` gives (C2-L-003). Positions are always built, since the record states its ranges in them.
 */
export function parseWithLayout(src: string | Uint8Array, options?: ParseOptions): LayoutResult {
  const settings = readOptions(options, 'parse')
  const trace = createLayoutTrace()
  const source = sourceText(src)
  const parsed = parseInput(source, settings, true, trace)
  const resolved = resolveStage(parsed, settings)
  const diagnostics = parseDiagnostics(resolved, parsed)
  return { document: resolved.document,
    ...capIncludeDiagnostics(diagnostics, settings.includes?.maxDiagnostics ?? 100),
    layout: sourceLayout(source, resolved.document, trace) }
}

/** C2-L-056: the layout of bytes that are not well-formed UTF-8 keeps them in base64, and its ranges count them. */
function sourceLayout(source: SourceText, document: DocumentNode, trace: LayoutTrace): SourceLayout {
  // The ranges are those of the positions, which count the source bytes already.
  const layout = buildLayout(source.text, document, trace)
  const bytes = source.bytes
  return bytes === null ? layout : { ...layout, encoding: 'base64', source: base64(bytes) }
}

/**
 * The HTML of Carve source or of a tree (spec/0.2/html.md), with the diagnostics of the run, each
 * with its position (C2-A-173). Under `strictLosses` a render that lost something returns no output.
 */
export function renderWithDiagnostics(input: string | Uint8Array | DocumentNode, options?: RenderOptions): RenderOutput {
  const settings = readOptions(options, 'render')
  const parsed = inputStage(input, settings, true)
  const resolved = resolveStage(parsed, settings)
  const rendered = renderStage(resolved)
  const diagnostics = [...parseDiagnostics(resolved, parsed), ...locateFindings(resolved.document, rendered.losses)]
  if (settings.strictLosses) for (const entry of diagnostics) {
    if (entry.channel === 'render-loss') entry.severity = 'error'
  }
  return { html: settings.strictLosses && rendered.losses.entries.length > 0 ? '' : rendered.html,
    ...capIncludeDiagnostics(diagnostics, settings.includes?.maxDiagnostics ?? 100) }
}

/** C2-X-053: one host transform of a copy of the resolved document view. */
export interface DocumentTransform {
  name: string
  transform: (view: DocumentNode) => DocumentNode
}

/** C2-X-055: authored ids in one render view must be unique in document order. */
function duplicateViewId(document: DocumentNode): string | null {
  const seen = new Set<string>()
  const visit = (node: Node): string | null => {
    const id = node.attrs?.id
    if (id !== undefined) {
      if (seen.has(id)) return id
      seen.add(id)
    }
    let duplicate: string | null = null
    forEachSlot(node, (nodes, step) => {
      if (step === 'fallback' || duplicate !== null) return
      for (const child of nodes) {
        duplicate = visit(child)
        if (duplicate !== null) break
      }
    }, undefined, document.extensions)
    return duplicate
  }
  return visit(document)
}

/** C2-X-053 to C2-X-055: transforms run in registration order on a copy, leaving the authored tree intact. */
export function renderWithDocumentTransforms(
  input: string | Uint8Array | DocumentNode, transforms: readonly DocumentTransform[], options?: RenderOptions,
): RenderOutput {
  const settings = readOptions(options, 'render')
  const authored = typeof input === 'string' || input instanceof Uint8Array ? input : structuredClone(input)
  let view = structuredClone(resolveStage(inputStage(authored, settings), settings).document)
  const failures: Diagnostic[] = []
  for (const entry of transforms) {
    try {
      const next = entry.transform(structuredClone(view))
      validateTree(next)
      const duplicate = duplicateViewId(next)
      if (duplicate !== null) throw new Error(`duplicate authored id ${duplicate}`)
      view = next
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      failures.push({ code: 'extension-transform-failed', severity: 'warning', channel: 'render-loss',
        message: `The document transform ${entry.name} failed: ${detail}`, path: '' })
    }
  }
  const rendered = renderWithDiagnostics(view, options)
  return { ...rendered, diagnostics: [...failures, ...rendered.diagnostics] }
}

/**
 * The HTML fragment of Carve source or of a tree: the three stages in a row. Under `strictLosses`
 * a render loss throws. The diagnostics are not asked for, so they are given a position only where a loss is thrown.
 */
export function render(input: string | Uint8Array | DocumentNode, options?: RenderOptions): string {
  const settings = readOptions(options, 'render')
  return renderTree(resolveStage(inputStage(input, settings), settings))
}
