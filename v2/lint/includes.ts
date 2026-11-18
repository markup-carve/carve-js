// Lint through includes (C2-N-085 to C2-N-087): every Carve include the expansion accepted is linted over the source it
// parsed, and each finding names its file, a range in that file and a tree path through the includes that reached it.
import { forEachSlot, type DocumentNode, type IncludeNode, type Node } from '../src/ast.ts'
import { parse, parseWithDiagnostics } from '../src/api.ts'
import { type Diagnostic } from '../src/diagnostics.ts'
import { type IncludeConfig, includeSettings, type IncludeResolver, type IncludeSettings } from '../src/include-settings.ts'
import { fileLines, type LineRange, lineRange, regionRange } from '../src/include-source.ts'
import { CarveOptionError } from '../src/options.ts'
import { unitBytes, utf8Length } from '../src/positions.ts'

/** The text the resolver returned for each id, as the expansion read it. */
function recording(config: IncludeSettings, texts: Map<string, string>): IncludeConfig {
  const resolver: IncludeResolver = (request) => {
    const answer = config.resolver(request)
    if ('text' in answer) texts.set(answer.id, typeof answer.text === 'string' ? answer.text : new TextDecoder().decode(answer.text))
    return answer
  }
  const out: IncludeConfig = { resolver, depth: config.depth, bytes: config.bytes }
  if (config.file !== undefined) out.file = config.file
  return out
}

/** C2-N-086: the lines the expansion parsed, or all of them. */
function parsedLines(node: IncludeNode, text: string): LineRange {
  const lines = fileLines(text)
  const all = { from: 0, to: lines.starts.length }
  const options = node.options
  if (options?.lines !== undefined) return lineRange(options.lines, all.to) ?? all
  if (options?.region === undefined) return all
  const range = regionRange(text, lines, options.region, false)
  return typeof range === 'string' ? all : range
}

/** C2-N-086: for a section, the lines from the first selected block through the last one. */
function sectionLines(node: IncludeNode): LineRange | null {
  const blocks = (node.children ?? []).filter((child) => child.pos !== undefined && child.type !== 'link_reference_definition' &&
    child.type !== 'footnote' && child.type !== 'abbreviation_def' && child.type !== 'citation_definition')
  const first = blocks[0]?.pos
  const last = blocks.at(-1)?.pos
  return first === undefined || last === undefined ? null : { from: first.startLine - 1, to: last.endLine }
}

interface Visit {
  texts: ReadonlyMap<string, string>
  lintFile: (source: string) => Diagnostic[]
  lintPayload: (text: string, node: Node, path: string) => Diagnostic[]
  references: ReferenceFindings
  seen: Set<string>
  out: Diagnostic[]
  codePaths: string[]
}

interface ReferenceScope {
  outer: ReferenceScope | null
  links: Map<string, { node: Node, file: string }>
  notes: Map<string, { node: Node, file: string }>
}

interface ReferenceFindings {
  observed: Set<string>
  unresolved: Set<string>
  used: Set<string>
}

function referenceKey(file: string, node: Node, code: string): string | null {
  return node.pos === undefined ? null : `${file}\u0000${node.pos.startOffset}\u0000${code}`
}

function diagnosticKey(entry: Diagnostic): string {
  return `${entry.file ?? ''}\u0000${entry.range?.startOffset ?? 0}\u0000${entry.code}`
}

function scopeOf(children: readonly Node[], file: string, outer: ReferenceScope | null): ReferenceScope {
  const scope: ReferenceScope = { outer, links: new Map(), notes: new Map() }
  for (const node of children) {
    if (node.type === 'link_reference_definition' && !scope.links.has(node.key)) scope.links.set(node.key, { node, file })
    if (node.type === 'footnote' && !scope.notes.has(node.key)) scope.notes.set(node.key, { node, file })
  }
  return scope
}

function definition(scope: ReferenceScope, key: string, kind: 'links' | 'notes'): { node: Node, file: string } | undefined {
  for (let at: ReferenceScope | null = scope; at !== null; at = at.outer) {
    const found = at[kind].get(key)
    if (found !== undefined) return found
  }
  return undefined
}

function recordReference(node: Node, file: string, inclusion: string, scope: ReferenceScope,
  found: ReferenceFindings): void {
  if (node.type !== 'link' && node.type !== 'image' && node.type !== 'footnote_ref') return
  const note = node.type === 'footnote_ref'
  const location = referenceKey(file, node, note ? 'unresolved-footnote' : 'unresolved-reference-link')
  if (location === null) return
  const occurrence = `${location}\u0000${inclusion}`
  found.observed.add(occurrence)
  const resolved = note ? node.number !== undefined : node.type === 'link' ? node.href !== undefined : node.src !== undefined
  if (!resolved) {
    found.unresolved.add(occurrence)
    return
  }
  if (node.key === undefined) return
  const target = definition(scope, node.key, note ? 'notes' : 'links')
  if (target === undefined) return
  const used = referenceKey(target.file, target.node,
    note ? 'unused-footnote-definition' : 'unused-link-reference-definition')
  if (used !== null) found.used.add(used)
}

function walkReferences(node: Node, path: string, file: string, inclusion: string, scope: ReferenceScope,
  found: ReferenceFindings): void {
  recordReference(node, file, inclusion, scope, found)
  if (node.type === 'include' && node.children !== undefined) {
    const innerFile = node.file ?? file
    const inner = scopeOf(node.children, innerFile, scope)
    forEachSlot(node, (nodes, step, single) => {
      nodes.forEach((child, index) => walkReferences(child, `${path}/${step}${single ? '' : `/${index}`}`,
        step === 'children' ? innerFile : file, step === 'children' ? path : inclusion,
        step === 'children' ? inner : scope, found))
    })
    return
  }
  forEachSlot(node, (nodes, step, single) => {
    nodes.forEach((child, index) => walkReferences(child, `${path}/${step}${single ? '' : `/${index}`}`,
      file, inclusion, scope, found))
  })
}

/** The resolved expansion decides which file's definition a reference actually uses (C2-N-054, C2-N-055). */
function referenceFindings(document: DocumentNode): ReferenceFindings {
  const found: ReferenceFindings = { observed: new Set(), unresolved: new Set(), used: new Set() }
  walkReferences(document, '', '', '', scopeOf(document.children, '', null), found)
  return found
}

function reconciled(entry: Diagnostic, found: ReferenceFindings, inclusion = ''): boolean {
  const key = diagnosticKey(entry)
  if (entry.code === 'unresolved-reference-link' || entry.code === 'unresolved-footnote') {
    const occurrence = `${key}\u0000${inclusion}`
    return !found.observed.has(occurrence) || found.unresolved.has(occurrence)
  }
  if (entry.code === 'unused-link-reference-definition' || entry.code === 'unused-footnote-definition') {
    return !found.used.has(key)
  }
  return true
}

function lineOfByte(text: string, byte: number): number {
  let line = 1
  let bytes = 0
  for (let at = 0; at < text.length && bytes < byte; at++) {
    bytes += unitBytes(text, at)
    if (text.charCodeAt(at) === 0x0a) line++
  }
  return line
}

/** The part of the file that is linted, and the bytes before it. */
interface Linted {
  source: string
  shift: number
  /** C2-N-086: for a section, the lines whose findings are kept. */
  kept: LineRange | null
  /** C2-N-087: for a section, the path of each selected block in the file's own tree, to its path under the include. */
  paths: ReadonlyMap<string, string> | null
}

function placeKey(node: Node): string | null {
  const pos = node.pos
  return pos === undefined ? null : `${node.type}\u0000${pos.startOffset}\u0000${pos.endOffset}`
}

function eachPath(node: Node, path: string, visit: (node: Node, path: string) => void): void {
  visit(node, path)
  forEachSlot(node, (nodes, step, single) => {
    if (single) eachPath(nodes[0]!, `${path}/${step}`, visit)
    else nodes.forEach((child, index) => eachPath(child, `${path}/${step}/${index}`, visit))
  })
}

/** C2-N-087: a selected block keeps its place in the file, so its path in the file's tree is found by that place. */
function sectionPaths(node: IncludeNode, text: string): Map<string, string> {
  const places = new Map<string, string>()
  eachPath(parse(text), '', (block, path) => {
    const key = placeKey(block)
    if (key !== null && !places.has(key)) places.set(key, path)
  })
  const paths = new Map<string, string>()
  ;(node.children ?? []).forEach((child, index) => {
    const key = placeKey(child)
    const path = key === null ? undefined : places.get(key)
    if (path !== undefined) paths.set(path, `/children/${index}`)
  })
  return paths
}

/** The path under the include of a finding at `path` in the file's own tree, by the longest selected block around it. */
function pathUnder(paths: ReadonlyMap<string, string>, path: string): string | null {
  for (let end = path.length; end > 0; end = path.lastIndexOf('/', end - 1)) {
    const under = paths.get(path.slice(0, end))
    if (under !== undefined) return under + path.slice(end)
  }
  return null
}

function lintedPart(node: IncludeNode, text: string): Linted {
  const lines = fileLines(text)
  if (node.section !== undefined) return { source: text, shift: 0, kept: sectionLines(node), paths: sectionPaths(node, text) }
  const range = parsedLines(node, text)
  if (range.from === 0 && range.to === lines.starts.length) return { source: text, shift: 0, kept: null, paths: null }
  if (range.from >= range.to) return { source: '', shift: 0, kept: null, paths: null }
  const start = lines.starts[range.from]!
  return { source: text.slice(start, lines.nexts[range.to - 1]), shift: utf8Length(text.slice(0, start)), kept: null, paths: null }
}

/** C2-N-087: one finding of an included file, or null where it is outside a section or reported already. */
function located(visit: Visit, node: IncludeNode, text: string, part: Linted, entry: Diagnostic, path: string): Diagnostic | null {
  const startOffset = (entry.range?.startOffset ?? 0) + part.shift
  const kept = part.kept
  if (kept !== null) {
    const line = lineOfByte(text, startOffset)
    if (line <= kept.from || line > kept.to) return null
  }
  const file = node.file ?? ''
  const key = `${file}\u0000${startOffset}\u0000${entry.code}`
  if (visit.seen.has(key)) return null
  const range = { startOffset, endOffset: (entry.range?.endOffset ?? 0) + part.shift }
  // A finding of a section outside every selected block, such as one on the file as a whole, points at the include.
  const own = entry.path ?? ''
  const under = part.paths === null ? own : pathUnder(part.paths, own) ?? ''
  return { ...entry, path: `${path}${under}`, range, file }
}

function keepLocated(visit: Visit, entry: Diagnostic | null, inclusion: string): void {
  if (entry === null || !reconciled(entry, visit.references, inclusion)) return
  visit.seen.add(diagnosticKey(entry))
  visit.out.push(entry)
}

/** C2-N-086, C2-N-087: lints the source of one expanded Carve include and keeps each distinct finding once. */
function lintInclude(visit: Visit, node: IncludeNode, path: string): void {
  const text = node.file === undefined ? undefined : visit.texts.get(node.file)
  if (text === undefined) return
  if (node.options?.code !== undefined) {
    lintCodeChild(visit, node, text, path)
    return
  }
  const part = lintedPart(node, text)
  for (const entry of visit.lintFile(part.source)) {
    keepLocated(visit, located(visit, node, text, part, entry, path), path)
  }
}

/** C2-N-086: a rule that reads the payload of a block also runs on the child of a code include, in its file. */
function lintCodeChild(visit: Visit, node: IncludeNode, text: string, path: string): void {
  const whole: Linted = { source: text, shift: 0, kept: null, paths: null }
  ;(node.children ?? []).forEach((child, index) => {
    for (const entry of visit.lintPayload(text, child, `/children/${index}`)) {
      keepLocated(visit, located(visit, node, text, whole, entry, path), path)
    }
  })
}

function walk(visit: Visit, node: Node, path: string): void {
  if (node.type === 'include' && node.children !== undefined) {
    if (node.options?.code !== undefined) visit.codePaths.push(`${path}/children/`)
    lintInclude(visit, node, path)
  }
  forEachSlot(node, (nodes, step, single) => {
    if (single) walk(visit, nodes[0]!, `${path}/${step}`)
    else nodes.forEach((child, index) => walk(visit, child, `${path}/${step}/${index}`))
  })
}

/** C2-N-085: the findings in the included files of `source`, after an expansion with the caller's resolver. */
export function lintIncludes(source: string, value: unknown, own: Diagnostic[], lintFile: (source: string) => Diagnostic[],
  lintPayload: Visit['lintPayload']): Diagnostic[] {
  const config = includeSettings(value, (reason) => new CarveOptionError('includes', reason))
  if (config === null) return own
  const texts = new Map<string, string>()
  const expanded = parseWithDiagnostics(source, { includes: recording(config, texts) })
  const references = referenceFindings(expanded.document)
  const visit: Visit = { texts, lintFile, lintPayload, references, seen: new Set(), out: [], codePaths: [] }
  walk(visit, expanded.document, '')
  // The file lint pass selects source lines and sections. Keep only expansion findings that it cannot produce.
  const expansion = expanded.diagnostics.filter((entry) => entry.code.startsWith('include-') ||
    visit.codePaths.some((path) => entry.path?.startsWith(path) === true))
  return [...own.filter((entry) => reconciled(entry, references)), ...expansion, ...visit.out]
}
