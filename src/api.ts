// The public interface of the 0.2 engine: `parse` gives the tree of contract 2.0, `render` gives HTML.
// Both are compositions of three stages: parse (source to tree), resolve (tree to resolved tree) and render.
import { cloneTree, type DocumentNode, forEachSlot, sameTree } from './ast.ts'
import { buildSource, type ParseFacts, type ParsedTree } from './ast-blocks.ts'
import { expandTree, reportNoResolver } from './expand.ts'
import { type LayoutTrace } from './ast-inline.ts'
import { validateTree } from './ast-validate.ts'
import { renderDocument } from './html.ts'
import { buildLayout, createLayoutTrace, type SourceLayout } from './layout.ts'
import { addFinding, type Diagnostic, type Findings, locateFindings } from './diagnostics.ts'
import {
  expandSnippets, markDefinitions, holdsSnippetNode, holdsSnippetUse, refuseTransformSnippets,
} from './snippet-expand.ts'
import { carrySnippetBudget, carrySnippetMarks } from './snippet-marks.ts'
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
import { denseListHtml } from './fast-dense-list.ts'
import { fastCoreHtml } from './fast-core-html.ts'
import { firstAboveSix, HEADING_SHIFT_CODE, headingShiftMessage, shiftHeadings } from './heading-shift.ts'

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
function parseSource(src: string, settings: Settings, positions: boolean, trace: LayoutTrace | null = null,
  byteLength: number | null = null): ParsedTree {
  const names = settings.extensions.length > 0
  const parse = (text: string, outer: ParseFacts['scope'] | null, forced = false, frontmatterOpens = true,
    bytes: number | null = null): ParsedTree => applyExtensions(
    buildSource(text, positions || forced, null, outer === null ? trace : null, names, null, outer, frontmatterOpens, bytes),
    settings.extensions,
  )
  const parsed = parse(src, null, false, true, byteLength)
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
  const bytes = source.bytes
  const parsed = parseSource(source.text, settings, positions, trace, bytes?.length ?? null)
  if (bytes !== null) {
    mapPositions(source, parsed.document)
    parsed.document.srcByteLength = bytes.length
  }
  return { ...parsed, source: bytes?.length ?? source.text }
}

/** The parse stage of a render: source is parsed, and a supplied tree is validated first. */
function inputStage(input: string | Uint8Array | DocumentNode, settings: Settings, diagnostics = false, validated = false): ParsedTree {
  if (typeof input === 'string' || input instanceof Uint8Array) {
    const source = sourceText(input)
    checkLength(source.text, settings)
    // C2-H-016: only the source lines need positions.
    return parseInput(source, settings, settings.sourceLines || diagnostics)
  }
  if (!validated) validateTree(input, undefined, undefined, settings.extensions)
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
function renderStage(resolved: ResolvedTree, reportShift = true): { html: string, losses: Findings } {
  const rendered = renderProfiled(resolved, reportShift)
  const allowed = resolved.settings.allowLosses
  if (allowed.size === 0) return rendered
  // C2-H-204: an allowed code is left out of the record and counts for neither strictLosses nor maxLosses.
  const losses: Findings = { entries: [], nodes: [] }
  rendered.losses.entries.forEach((entry, index) => {
    if (allowed.has(entry.code)) return
    losses.entries.push(entry)
    losses.nodes.push(rendered.losses.nodes[index]!)
  })
  return { html: rendered.html, losses }
}

function renderProfiled(resolved: ResolvedTree, reportShift: boolean): { html: string, losses: Findings } {
  const { document, settings } = resolved
  const losses: Findings = { entries: [...resolved.losses.entries], nodes: [...resolved.losses.nodes] }
  if (reportShift && settings.headingShift !== 0) reportShiftAboveSix(document, settings.headingShift, losses)
  const rule = profileRule(settings)
  if (rule === NO_PROFILE) return renderDocument(document, settings, resolved.resolution, losses, resolved.bidi, resolved.source)
  const run = applyProfile(document, settings.profile, rule, losses, resolved.resolution.xrefText, settings)
  try {
    const resolution = liveResolution(resolved.resolution, run.gone, run.goneTargets)
    return renderDocument(document, settings, resolution, losses, resolved.bidi, resolved.source, run.taskLabels)
  } finally {
    run.restore()
  }
}

/** C2-H-208: one entry, at the first heading the shift raised above level 6. */
function reportShiftAboveSix(document: DocumentNode, shift: number, losses: Findings): void {
  const node = firstAboveSix(document)
  if (node === undefined) return
  losses.entries.push({ code: HEADING_SHIFT_CODE, severity: 'warning', channel: 'render-loss', message: headingShiftMessage(shift) })
  losses.nodes.push(node)
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
  // C2-N-091: the staged path expands on its own copy too; the parse facts name the authored nodes, so the copy has none.
  const document = 'type' in input ? input : input.document
  if (holdsSnippetUse(document)) {
    const authored: ParsedTree = 'type' in input ? inputStage(input, settings) : { ...input, facts: null }
    const expanded = expandStage(document, authored, settings)
    const resolved = shiftedResolve(expanded.parsed, settings, expanded.parsed.document === document, settings.headingShift)
    appendFindings(resolved.losses, expanded.findings)
    return resolved
  }
  if ('type' in input) return shiftedResolve(inputStage(input, settings), settings, true, settings.headingShift)
  // A parsed tree is resolved in place and its facts hold its nodes, so it is not copied: a second call shifts by the difference.
  const applied = PARSED_SHIFT.get(input.document) ?? 0
  const resolved = resolveStage(input, settings)
  if (settings.headingShift !== applied) shiftHeadings(resolved.document, settings.headingShift - applied)
  PARSED_SHIFT.set(input.document, settings.headingShift)
  return resolved
}

/** The heading shift `resolveTree` has applied to each parsed tree it resolved in place. */
const PARSED_SHIFT = new WeakMap<DocumentNode, number>()

/** C2-H-208: resolution, then the heading shift. A supplied tree is the caller's, so it shifts on a copy. */
function shiftedResolve(parsed: ParsedTree, settings: Settings, supplied: boolean, shift: number): ResolvedTree {
  if (shift === 0) return resolveStage(parsed, settings)
  const resolved = resolveStage(supplied ? { ...parsed, document: cloneTree(parsed.document) } : parsed, settings)
  shiftHeadings(resolved.document, shift)
  return resolved
}

function isSupplied(input: string | Uint8Array | DocumentNode): input is DocumentNode {
  return typeof input !== 'string' && !(input instanceof Uint8Array)
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
  // C2-A-218: a metadata key is authored by the attribute line, so point at
  // its opening brace rather than the hash within it.
  const begin = node.type === 'frontmatter' && at > 0 && raw[at - 1] === '{' ? at - 1 : at
  const startOffset = pos.startOffset + utf8Length(raw.slice(0, begin))
  entry.range = { startOffset, endOffset: startOffset + utf8Length(marker) + (at - begin) }
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

/**
 * C2-H-204, C2-H-205: drops the allowed render losses, keeps the first `maxLosses` of the others and counts the rest.
 * Entries of the parse and lint channels are not counted.
 */
export function capLosses(diagnostics: Diagnostic[], settings: Pick<Settings, 'allowLosses' | 'maxLosses'>): {
  diagnostics: Diagnostic[], suppressedDiagnostics: number
} {
  const retained: Diagnostic[] = []
  let suppressedDiagnostics = 0
  let kept = 0
  for (const entry of diagnostics) {
    if (entry.channel !== 'render-loss') retained.push(entry)
    else if (settings.allowLosses.has(entry.code)) continue
    else if (kept++ >= settings.maxLosses) suppressedDiagnostics++
    else retained.push(entry)
  }
  return { diagnostics: retained, suppressedDiagnostics }
}

/** The include cap of C2-T-024, then the loss settings of C2-H-204 and C2-H-205. */
function capDiagnostics(diagnostics: Diagnostic[], settings: Settings): { diagnostics: Diagnostic[], suppressedDiagnostics: number } {
  const included = capIncludeDiagnostics(diagnostics, settings.includes?.maxDiagnostics ?? 100)
  const losses = capLosses(included.diagnostics, settings)
  return { diagnostics: losses.diagnostics, suppressedDiagnostics: included.suppressedDiagnostics + losses.suppressedDiagnostics }
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
  const { document, diagnostics, suppressedDiagnostics, layout } = parseWithLayoutCore(src, options, false)
  return { document, diagnostics, suppressedDiagnostics, layout }
}

/** The lint caller owns this tree and never exposes or mutates its inert table children. */
export function parseWithLayoutForLint(src: string | Uint8Array, options?: ParseOptions):
  LayoutResult & { resolved: ResolvedTree, includes: boolean } {
  return parseWithLayoutCore(src, options, true)
}

/** The HTML of a tree that `parseWithLayoutForLint` resolved, for the lint facts that read the rendered ids (C2-W-150). */
export function renderForLint(resolved: ResolvedTree): string {
  return renderStage(resolved, false).html
}

function parseWithLayoutCore(src: string | Uint8Array, options: ParseOptions | undefined, compactTables: boolean):
  LayoutResult & { resolved: ResolvedTree, includes: boolean } {
  const settings = readOptions(options, 'parse')
  const trace = createLayoutTrace()
  if (compactTables) trace.compactTables = true
  const source = sourceText(src)
  const parsed = parseInput(source, settings, true, trace)
  const resolved = resolveStage(parsed, settings)
  const diagnostics = parseDiagnostics(resolved, parsed)
  return { document: resolved.document,
    ...capIncludeDiagnostics(diagnostics, settings.includes?.maxDiagnostics ?? 100),
    layout: sourceLayout(source, resolved.document, trace), resolved, includes: (parsed.facts?.includes.length ?? 0) > 0 }
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
  const registered = registeredTransforms(settings)
  if (registered.length > 0) return transformedRender(input, registered, settings)
  return plainRender(input, settings)
}

/**
 * C2-N-091: the snippet expansion of a render, on the render's own tree: a supplied tree is copied first. A view a
 * transform returned (`transformed`) is not expanded: its snippet nodes are refused (C2-N-095).
 */
function expandStage(input: string | Uint8Array | DocumentNode, parsed: ParsedTree, settings: Settings,
  transformed = false): { parsed: ParsedTree, findings: Findings } {
  const findings: Findings = { entries: [], nodes: [] }
  if (typeof input === 'string' && !input.includes('{{') && (parsed.facts?.includes.length ?? 0) === 0) return { parsed, findings }
  if (transformed) {
    if (holdsSnippetNode(parsed.document)) refuseTransformSnippets(parsed.document, findings)
    return { parsed, findings }
  }
  if (!holdsSnippetUse(parsed.document)) return { parsed, findings }
  const own = isSupplied(input) ? { ...parsed, document: cloneTree(parsed.document) } : parsed
  const touched = expandSnippets(own.document, findings, { roundtrip: settings.roundtrip, source: parsed.source },
    parsed.document)
  const leaves = own.facts?.resolvableLeaves as Set<Node> | undefined
  if (leaves !== undefined) for (const node of touched) leaves.add(node)
  return { parsed: own, findings }
}

/** `shift`: the heading shift still to apply, 0 for a view that a transform has already shifted. */
function plainRender(input: string | Uint8Array | DocumentNode, settings: Settings, validated = false,
  shift = settings.headingShift, reportShift = true, transformed = false): RenderOutput {
  const expanded = expandStage(input, inputStage(input, settings, true, validated), settings, transformed)
  const parsed = expanded.parsed
  const resolved = shiftedResolve(parsed, settings, isSupplied(input) && parsed.document === input, shift)
  appendFindings(resolved.losses, expanded.findings)
  const rendered = renderStage(resolved, reportShift)
  const diagnostics = [...parseDiagnostics(resolved, parsed), ...locateFindings(resolved.document, rendered.losses)]
  if (settings.strictLosses) for (const entry of diagnostics) {
    if (entry.channel === 'render-loss') entry.severity = 'error'
  }
  return { html: settings.strictLosses && rendered.losses.entries.length > 0 ? '' : rendered.html,
    ...capDiagnostics(diagnostics, settings) }
}

function appendFindings(to: Findings, from: Findings): void {
  for (let at = 0; at < from.entries.length; at++) addFinding(to, from.nodes[at] ?? null, from.entries[at]!)
}

/** C2-X-053: one host transform of a copy of the resolved document view. */
export interface DocumentTransform {
  name: string
  transform: (view: DocumentNode) => DocumentNode
  /** A conservative check; false means this transform cannot change the view. */
  appliesTo?: (view: DocumentNode) => boolean
}

/** C2-X-055: how often each authored id occurs in one render view. */
function viewIdCounts(document: DocumentNode): Map<string, number> {
  const counts = new Map<string, number>()
  const visit = (node: Node): void => {
    const id = node.attrs?.id
    if (id !== undefined) counts.set(id, (counts.get(id) ?? 0) + 1)
    forEachSlot(node, (nodes, step) => {
      if (step === 'fallback') return
      for (const child of nodes) visit(child)
    }, undefined, document.extensions)
  }
  visit(document)
  return counts
}

/** An id the transform used once more than its input did, where that makes it a duplicate. */
function addedDuplicate(before: ReadonlyMap<string, number>, after: ReadonlyMap<string, number>): string | undefined {
  for (const [id, count] of after) if (count > 1 && count > (before.get(id) ?? 0)) return id
  return undefined
}

/** Whether a transform gave back its input as it was; a tree too deep to compare counts as changed. */
function unchanged(next: DocumentNode, view: DocumentNode): boolean {
  try {
    return sameTree(next, view)
  } catch (error) {
    if (error instanceof RangeError) return false
    throw error
  }
}

function applies(entry: DocumentTransform, view: DocumentNode): boolean {
  return entry.appliesTo === undefined || entry.appliesTo(view)
}

/** One transform of a copy of `view`; the copy carries the snippet side tables, and a new root the budget. */
function runTransform(entry: DocumentTransform, view: DocumentNode): DocumentNode {
  const input = cloneTree(view)
  carrySnippetMarks(view, input)
  const next = entry.transform(input)
  if (next !== input) carrySnippetBudget(input, next)
  return next
}

function applyDocumentTransforms(view: DocumentNode, transforms: readonly DocumentTransform[], extensions: Settings['extensions']): {
  view: DocumentNode, failures: Diagnostic[], validated: boolean, changed: boolean
} {
  const failures: Diagnostic[] = []
  // A duplicate the source already holds is reported by the parse; only one a transform adds fails it.
  let counts: Map<string, number> | undefined
  let validated = false
  let changed = false
  for (const entry of transforms) {
    try {
      if (!applies(entry, view)) continue
      const next = runTransform(entry, view)
      // A view the transform left as it was is checked once; its ids are those of its input.
      if (unchanged(next, view)) {
        if (!validated) validateTree(next, undefined, undefined, extensions)
        validated = true
        view = next
        continue
      }
      validateTree(next, undefined, undefined, extensions)
      const after = viewIdCounts(next)
      const added = addedDuplicate(counts ?? viewIdCounts(view), after)
      if (added !== undefined) throw new Error(`duplicate authored id ${added}`)
      counts = after
      view = next
      validated = true
      changed = true
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      failures.push({ code: 'extension-transform-failed', severity: 'warning', channel: 'render-loss',
        message: `The document transform ${entry.name} failed: ${detail}`, path: '' })
    }
  }
  return { view, failures, validated, changed }
}

/** C2-X-053: the document transforms of the registered extensions, in registration order. */
function registeredTransforms(settings: Settings): DocumentTransform[] {
  const transforms: DocumentTransform[] = []
  for (const entry of settings.extensions) {
    if (entry.documentTransform !== undefined) transforms.push({ name: entry.name, transform: entry.documentTransform })
  }
  return transforms
}

/** C2-X-053 to C2-X-055: transforms run in registration order on a copy, leaving the authored tree intact. */
export function renderWithDocumentTransforms(
  input: string | Uint8Array | DocumentNode, transforms: readonly DocumentTransform[], options?: RenderOptions,
): RenderOutput {
  const settings = readOptions(options, 'render')
  const all = [...registeredTransforms(settings), ...transforms]
  // With no transform the shift runs in place, as in renderWithDiagnostics.
  if (all.length === 0 && settings.headingShift !== 0) return plainRender(input, settings)
  return transformedRender(input, all, settings)
}

/** Reuse the resolved view when no transform changed it and its output has no positional loss. */
function unchangedViewRender(resolved: ResolvedTree, sourceDiagnostics: Diagnostic[], failures: Diagnostic[],
  settings: Settings): RenderOutput | undefined {
  const rendered = renderStage(resolved)
  // A loss needs the second resolution's positions, which may differ from the source tree's positions.
  if (rendered.losses.entries.length > 0) return undefined
  const diagnostics = [...sourceDiagnostics, ...failures]
  if (settings.strictLosses) for (const entry of diagnostics) {
    if (entry.channel === 'render-loss') entry.severity = 'error'
  }
  const capped = capDiagnostics(diagnostics, settings)
  const lost = diagnostics.some((entry) => entry.channel === 'render-loss' && !settings.allowLosses.has(entry.code))
  return { html: settings.strictLosses && lost ? '' : rendered.html, ...capped }
}

function expansionDiagnostics(resolved: ResolvedTree, findings: Findings): Diagnostic[] {
  if (findings.entries.length === 0) return []
  const allowed = resolved.settings.allowLosses
  return locateFindings(resolved.document, findings).filter((entry) => !allowed.has(entry.code))
}

/** C2-N-095: the definitions of the resolved view the transforms receive, those with no use among them. */
function markTransformBaseline(input: string | Uint8Array | DocumentNode, view: DocumentNode): void {
  if (typeof input !== 'string' || input.includes('{$')) markDefinitions(view)
}

function transformedRender(
  input: string | Uint8Array | DocumentNode, transforms: readonly DocumentTransform[], settings: Settings, positions = true,
): RenderOutput {
  const authored = typeof input === 'string' || input instanceof Uint8Array ? input : cloneTree(input)
  const expanded = expandStage(authored, inputStage(authored, settings, positions), settings)
  const parsed = expanded.parsed
  const resolved = resolveStage(parsed, settings)
  appendFindings(resolved.losses, expanded.findings)
  // C2-N-093: the findings of the expansion stand for the view the transforms receive, whichever path renders it.
  const sourceDiagnostics = [...parseDiagnostics(resolved, parsed), ...expansionDiagnostics(resolved, expanded.findings)]
  // C2-H-208: capture the shift's own above-six result before any host can change the level.
  const shiftLosses: Findings = { entries: [], nodes: [] }
  if (settings.headingShift !== 0) {
    shiftHeadings(resolved.document, settings.headingShift)
    reportShiftAboveSix(resolved.document, settings.headingShift, shiftLosses)
  }
  const shiftDiagnostics = settings.allowLosses.has(HEADING_SHIFT_CODE) ? [] : locateFindings(resolved.document, shiftLosses)
  markTransformBaseline(input, resolved.document)
  const { view, failures, validated, changed } = applyDocumentTransforms(resolved.document, transforms, settings.extensions)
  if (!changed) {
    const direct = unchangedViewRender(resolved, sourceDiagnostics, failures, settings)
    if (direct !== undefined) return direct
  }
  const rendered = plainRender(view, settings, validated, 0, false, true)
  const sourceKeys = new Set(sourceDiagnostics.map((entry) => JSON.stringify([
    entry.code, entry.channel, entry.message, entry.path,
  ])))
  const viewDiagnostics = rendered.diagnostics.filter((entry) => !sourceKeys.has(JSON.stringify([
    entry.code, entry.channel, entry.message, entry.path,
  ])))
  const diagnostics = [...sourceDiagnostics, ...failures, ...shiftDiagnostics, ...viewDiagnostics]
  if (settings.strictLosses) for (const entry of diagnostics) {
    if (entry.channel === 'render-loss') entry.severity = 'error'
  }
  const capped = capDiagnostics(diagnostics, settings)
  const lost = diagnostics.some((entry) => entry.channel === 'render-loss' && !settings.allowLosses.has(entry.code))
  return { html: settings.strictLosses && lost ? '' : rendered.html,
    diagnostics: capped.diagnostics, suppressedDiagnostics: capped.suppressedDiagnostics + rendered.suppressedDiagnostics }
}

/**
 * The HTML fragment of Carve source or of a tree: the three stages in a row. Under `strictLosses`
 * a render loss throws. The diagnostics are not asked for, so they are given a position only where a loss is thrown.
 */
export function render(input: string | Uint8Array | DocumentNode, options?: RenderOptions): string {
  const settings = readOptions(options, 'render')
  // Stateless tight lists can be written directly without constructing a tree.
  if (typeof input === 'string' && options === undefined) {
    const html = denseListHtml(input)
    if (html !== undefined) return html
    const core = fastCoreHtml(input, settings)
    if (core !== undefined) return core
  }
  const registered = registeredTransforms(settings)
  if (registered.length > 0) {
    const output = transformedRender(input, registered, settings, false)
    const lost = output.diagnostics.filter((entry) => entry.channel === 'render-loss')
    if (settings.strictLosses && lost.length > 0) throw new CarveRenderError(lost)
    return output.html
  }
  const expanded = expandStage(input, inputStage(input, settings), settings)
  const resolved = shiftedResolve(expanded.parsed, settings, isSupplied(input) && expanded.parsed.document === input,
    settings.headingShift)
  appendFindings(resolved.losses, expanded.findings)
  return renderTree(resolved)
}
