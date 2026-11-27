// Include expansion (spec/0.2/includes.md): each included file is parsed as a document of its own and its blocks
// become the children of the include node, which stays where the directive stood (C2-N-015 to C2-N-019).
import { DEFINITION_TYPES, type DocumentNode, forEachSlot, type IncludeNode, type Node, type Position } from './ast.ts'
import { type OuterScope, type ParseFacts, type ParsedTree } from './ast-blocks.ts'
import { addFinding, type Findings } from './diagnostics.ts'
import { INCLUDE_KEY_REPEATED, INCLUDE_KEY_UNKNOWN, INCLUDE_VALUE_MISSING, INCLUDE_VALUE_SHAPE, optionProblem } from './include.ts'
import { codeChildren, isTableInclude } from './include-code.ts'
import { type IncludeAnswer, type IncludeError, type IncludeRequest, type IncludeSettings } from './include-settings.ts'
import {
  fileLines, type FileLines, type LineRange, lineRange, RECORD_QUOTED, recordKinds, regionRange,
} from './include-source.ts'
import { applyShifts, selectSection } from './include-select.ts'
import { INCLUDE_CAUSES, INCLUDE_CONFLICTS, INCLUDE_MESSAGES, INCLUDE_OPTION_MESSAGES } from './include-tables.ts'
import { type HeadingIds } from './options.ts'
import { utf8Length } from './positions.ts'
import { leadingIncludedFrontmatter } from './frontmatter-origin.ts'

/** Parses the text of one file with the parse options of the top-level document (C2-N-015). */
/** Parses the text of a file; `positions` asks for positions where the expansion would not keep them. */
export type FileParse = (text: string, outer: OuterScope, positions?: boolean, frontmatterOpens?: boolean) => ParsedTree

interface Expansion {
  settings: IncludeSettings
  parse: FileParse
  headingIds: HeadingIds
  positions: boolean
  /** C2-N-065: the bytes of the texts the resolver returned and the cap accepted. */
  spent: number
  findings: Findings
  facts: ParseFacts[]
  /** The expanded includes in tree order, for the shifts (C2-N-050). */
  expanded: IncludeNode[]
  /** The text of each file the expansion took, by its id, which places the findings in that file. */
  sources: Map<string, string>
}

/** The file whose includes are expanded: its id, its depth (C2-N-064), the files around it (C2-N-066) and its scope. */
interface Frame {
  file: string | undefined
  depth: number
  around: readonly string[]
  scope: OuterScope
}

/** A failure: the name of its cause in `data/includes.json` and the values its message names. */
interface Failure {
  cause: string
  values?: Readonly<Record<string, string>>
}

/** The result of a selection: the children, the parse facts they come with, and the includes among them. */
export interface Selected {
  children: NonNullable<IncludeNode['children']>
  facts: ParseFacts | null
  includes: readonly IncludeNode[]
  scope: OuterScope
}

/** The message of an include code, with the values its template names. */
export function includeMessage(code: string, values: Readonly<Record<string, string>>): string {
  const reason = values['reason']
  const optionIndex = reason === INCLUDE_KEY_UNKNOWN ? 0 : reason === INCLUDE_KEY_REPEATED ? 1
    : reason === INCLUDE_VALUE_MISSING ? 2 : reason === INCLUDE_VALUE_SHAPE ? 3 : 0
  const template = code === 'include-option-invalid' ? INCLUDE_OPTION_MESSAGES[optionIndex] ?? code
    : INCLUDE_MESSAGES.get(code) ?? code
  let out = ''
  let at = 0
  for (let open = template.indexOf('${'); open >= 0; open = template.indexOf('${', at)) {
    const close = template.indexOf('}', open)
    out += template.slice(at, open) + (values[template.slice(open + 2, close)] ?? '')
    at = close + 1
  }
  return out + template.slice(at)
}

/** C2-N-061, C2-N-068: one warning in the parse channel at the include node, naming the path as written. */
function report(findings: Findings, node: Node, code: string, values: Readonly<Record<string, string>>): void {
  addFinding(findings, node, { code, severity: 'warning', channel: 'parse', message: includeMessage(code, values) })
}

function fail(exp: Expansion, node: IncludeNode, failure: Failure): void {
  const code = INCLUDE_CAUSES.get(failure.cause)?.code ?? failure.cause
  report(exp.findings, node, code, { path: node.path, ...failure.values })
}

/** C2-N-003: without a resolver every include stays unexpanded and is reported. */
export function reportNoResolver(includes: readonly IncludeNode[], findings: Findings): void {
  for (const node of includes) report(findings, node, 'include-no-resolver', { path: node.path })
}

/** C2-N-024: whether `name`, an option or `section`, is set on the node. */
function holds(node: IncludeNode, name: string): boolean {
  if (name === 'section') return node.section !== undefined
  const options = node.options
  return options !== undefined && Object.hasOwn(options, name)
}

/** C2-N-024: the reason the options break a row of `conflicts`, or null. */
function conflictReason(node: IncludeNode): string | null {
  for (const row of INCLUDE_CONFLICTS) {
    const present = row.options.filter((name) => holds(node, name))
    if (row.rule === 'requires_table_code' && present.length > 0 && !isTableInclude(node)) {
      return `@${row.options[0] ?? ''} needs a code include of a csv or tsv table`
    }
    if (row.rule === 'exclusive' && present.length === row.options.length) return 'a section and @code exclude each other'
    if (row.rule === 'at_most_one' && present.length > 1) return 'a directive takes at most one selection'
  }
  return null
}

/** C2-B-206: why the first invalid entry of the node is invalid, as the parse read it. */
function invalidReason(node: IncludeNode, entry: string): string {
  const colon = entry.indexOf(':')
  const key = entry.slice(1, colon < 0 ? entry.length : colon)
  const repeated = node.options !== undefined && Object.hasOwn(node.options, key)
  return optionProblem(key, colon < 0 ? null : entry.slice(colon + 1), repeated) ?? INCLUDE_KEY_REPEATED
}

/** C2-N-062: the causes tested before the resolver is called, in the order of `data/includes.json`. */
function beforeResolver(exp: Expansion, node: IncludeNode, frame: Frame): Failure | null {
  // A bad key is more useful to report than a bad value on an earlier option.
  const invalid = node.invalid?.find((entry) => invalidReason(node, entry) === INCLUDE_KEY_UNKNOWN) ?? node.invalid?.[0]
  if (invalid !== undefined) return { cause: 'option_invalid', values: { option: invalid, reason: invalidReason(node, invalid) } }
  const reason = conflictReason(node)
  if (reason !== null) return { cause: 'conflict', values: { reason } }
  if (frame.depth + 1 > exp.settings.depth) return { cause: 'depth', values: { limit: String(exp.settings.depth) } }
  if (exp.spent >= exp.settings.bytes) return { cause: 'size_spent', values: { limit: String(exp.settings.bytes) } }
  return null
}

const ERRORS: readonly IncludeError[] = ['outside_root', 'not_found', 'unreadable', 'non_text']
const DECODER = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true })

/** C2-N-011: well-formed UTF-8 without U+0000. A string with an unpaired surrogate is no well-formed text either. */
function textOf(content: string | Uint8Array): string | null {
  let text: string
  if (typeof content === 'string') {
    text = content
  } else {
    try {
      text = DECODER.decode(content)
    } catch {
      return null
    }
  }
  return text.includes('\0') || !text.isWellFormed() ? null : text
}

function isAnswer(value: unknown): value is IncludeAnswer {
  if (typeof value !== 'object' || value === null) return false
  if ('error' in value) return ERRORS.includes(value.error as IncludeError)
  return 'id' in value && typeof value.id === 'string' && 'text' in value &&
    (typeof value.text === 'string' || value.text instanceof Uint8Array)
}

function request(node: IncludeNode, frame: Frame): IncludeRequest {
  const out: IncludeRequest = { path: node.path, options: { ...node.options } }
  if (node.section !== undefined) out.section = node.section
  if (frame.file !== undefined) out.from = frame.file
  return out
}

/** C2-N-007, C2-N-013: the text and id the resolver returns, or its cause. A resolver that throws refuses the target. */
function ask(exp: Expansion, node: IncludeNode, frame: Frame): { text: string, id: string } | Failure {
  let answer: unknown
  try {
    answer = exp.settings.resolver(request(node, frame))
  } catch {
    return { cause: 'unreadable' }
  }
  if (!isAnswer(answer)) return { cause: 'unreadable' }
  if ('error' in answer) return { cause: answer.error }
  const text = textOf(answer.text)
  return text === null ? { cause: 'non_text' } : { text, id: answer.id }
}

/** C2-N-019: every positioned node of a file carries the id of that file. */
export function stampFile(nodes: readonly Node[], file: string): void {
  const pending: Node[] = [...nodes]
  for (let node = pending.pop(); node !== undefined; node = pending.pop()) {
    if (node.pos !== undefined) node.pos.file = file
    for (const segment of node.segments ?? []) segment.file = file
    forEachSlot(node, (list) => { for (const child of list) pending.push(child) })
  }
}

function shift(pos: Position, lines: number, bytes: number): void {
  pos.startLine += lines
  pos.endLine += lines
  pos.startOffset += bytes
  pos.endOffset += bytes
}

/** C2-N-020: a selection parsed on its own keeps the coordinates of its file. */
function movePositions(nodes: readonly Node[], lines: number, bytes: number): void {
  const pending: Node[] = [...nodes]
  for (let node = pending.pop(); node !== undefined; node = pending.pop()) {
    if (node.pos !== undefined) shift(node.pos, lines, bytes)
    for (const segment of node.segments ?? []) shift(segment, lines, bytes)
    forEachSlot(node, (list) => { for (const child of list) pending.push(child) })
  }
}

/** C2-N-036: the lines of `range` parsed as a document, positioned in the file. */
function parseLines(exp: Expansion, text: string, lines: FileLines, range: LineRange, scope: OuterScope): ParsedTree {
  if (range.from >= range.to) return exp.parse('', scope)
  const start = lines.starts[range.from]!
  const slice = text.slice(start, lines.nexts[range.to - 1])
  // C2-N-020: frontmatter belongs to the file, so only a selection from its line 1 opens it.
  const parsed = exp.parse(slice, scope, false, range.from === 0)
  const first = parsed.document.children[0]
  const startOfFile = slice.charCodeAt(0) === 0xfeff ? slice.slice(1) : slice
  if (range.from === 0 && first?.type === 'frontmatter' &&
    (startOfFile.startsWith('---') || startOfFile.startsWith('{'))) leadingIncludedFrontmatter.add(first)
  // A slice from line 1 holds the U+FEFF too, and stands where the file starts.
  const from = range.from === 0 ? 0 : start
  if (exp.positions && from > 0) movePositions(parsed.document.children, range.from, utf8Length(text.slice(0, from)))
  return parsed
}

/** C2-N-026, C2-N-034, C2-N-037: the lines a directive reads, all of them without a selection, or its failure. */
function selectedLines(node: IncludeNode, text: string, lines: FileLines): LineRange | Failure {
  const options = node.options
  const count = lines.starts.length
  if (options?.lines !== undefined) return lineRange(options.lines, count) ?? { cause: 'lines_past_end' }
  if (options?.region === undefined) return { from: 0, to: count }
  const kinds = isTableInclude(node) ? recordKinds(text, lines, options.code === 'tsv') : []
  const range = regionRange(text, lines, options.region, options.code !== undefined, (index) => kinds[index] === RECORD_QUOTED)
  return typeof range === 'string' ? { cause: 'region_invalid', values: { name: options.region, reason: range } } : range
}

function fromParse(parsed: ParsedTree): Selected {
  const facts = parsed.facts
  return { children: parsed.document.children, facts, includes: facts?.includes ?? [], scope: facts?.scope ?? EMPTY_SCOPE }
}

const EMPTY_SCOPE: OuterScope = { abbreviations: new Map(), linkKeys: null }

/** C2-N-027 to C2-N-047: the children of the include, read from the text the resolver returned, or the failure. */
function select(exp: Expansion, node: IncludeNode, text: string, frame: Frame): Selected | Failure {
  const lines = fileLines(text)
  if (node.section !== undefined) {
    const parsed = exp.parse(text, frame.scope)
    const selected = selectSection(parsed, node.section, exp.headingIds)
    return selected ?? { cause: 'section_missing', values: { name: node.section } }
  }
  const range = selectedLines(node, text, lines)
  if ('cause' in range) return range
  if (node.options?.code !== undefined) {
    const code = codeChildren(node, text, lines, range, exp.positions)
    return 'cause' in code ? code : { children: code.children, facts: code.facts, includes: [], scope: frame.scope }
  }
  if (range.from === 0 && range.to === lines.starts.length) return fromParse(parseLines(exp, text, lines, range, frame.scope))
  return selectionWithDefinitions(exp, text, lines, range, frame.scope)
}

/**
 * C2-N-020, C2-N-054: a selection by lines or by region resolves against the definitions of its whole file. Its
 * children are its blocks, then every definition of the file parsed whole whose first line it did not take.
 */
function selectionWithDefinitions(exp: Expansion, text: string, lines: FileLines, range: LineRange, scope: OuterScope): Selected {
  const whole = exp.parse(text, scope, true)
  const selected = fromParse(parseLines(exp, text, lines, range, whole.facts?.scope ?? scope))
  const outside = whole.document.children.filter((node) => {
    const line = (node.pos?.startLine ?? 0) - 1
    return DEFINITION_TYPES.includes(node.type) && (line < range.from || line >= range.to)
  })
  if (!exp.positions) dropPositions(outside)
  return { ...selected, children: [...selected.children, ...outside], facts: withOutsideSnippets(selected.facts, whole.facts, outside) }
}

/** The appended definitions may hold snippet definitions and uses the selected lines do not. */
function withOutsideSnippets(facts: ParseFacts | null, whole: ParseFacts | null, outside: readonly Node[]): ParseFacts | null {
  if (facts === null || whole === null || !outside.some((node) => node.type === 'snippet_definition')) return facts
  return { ...facts, snippets: true, snippetUses: facts.snippetUses || whole.snippetUses }
}

function dropPositions(nodes: readonly Node[]): void {
  const pending: Node[] = [...nodes]
  for (let node = pending.pop(); node !== undefined; node = pending.pop()) {
    delete node.pos
    delete node.segments
    forEachSlot(node, (list) => { for (const child of list) pending.push(child) })
  }
}

/** C2-N-061 to C2-N-066, C2-N-018: expands one include, then the includes of its file, a node before those inside it. */
function expandOne(exp: Expansion, node: IncludeNode, frame: Frame): void {
  const early = beforeResolver(exp, node, frame)
  if (early !== null) return fail(exp, node, early)
  const answer = ask(exp, node, frame)
  if ('cause' in answer) return fail(exp, node, answer)
  node.file = answer.id
  if (answer.id === exp.settings.file || frame.around.includes(answer.id)) return fail(exp, node, { cause: 'cycle' })
  const bytes = utf8Length(answer.text)
  const limit = String(exp.settings.bytes)
  if (exp.spent + bytes > exp.settings.bytes) return fail(exp, node, { cause: 'size_exceeded', values: { limit } })
  exp.spent += bytes
  const selected = select(exp, node, answer.text, frame)
  if ('cause' in selected) return fail(exp, node, selected)
  if (exp.positions) stampFile(selected.children, answer.id)
  exp.sources.set(answer.id, answer.text)
  node.children = selected.children
  if (selected.facts !== null) exp.facts.push(selected.facts)
  exp.expanded.push(node)
  const inner: Frame = { file: answer.id, depth: frame.depth + 1, around: [...frame.around, answer.id], scope: selected.scope }
  for (const child of selected.includes) expandOne(exp, child, inner)
}

/** What the expansion leaves for the resolution: the facts of every file, and the findings of the expansion. */
export interface Expanded {
  facts: readonly ParseFacts[]
  findings: Findings
  sources: ReadonlyMap<string, string>
}

/**
 * C2-N-006: expands the includes of a parsed top-level document in place, in tree order. The document lists
 * `includeExpansion` in its stages, and every failure is reported in `findings`.
 */
export function expandTree(
  parsed: ParsedTree, settings: IncludeSettings, parse: FileParse, headingIds: HeadingIds, positions: boolean,
): Expanded {
  const findings: Findings = { entries: [], nodes: [] }
  const exp: Expansion = { settings, parse, headingIds, positions, spent: 0, findings, facts: [], expanded: [],
    sources: new Map() }
  const facts = parsed.facts
  const document: DocumentNode = parsed.document
  document.stages = ['includeExpansion']
  const frame: Frame = { file: settings.file, depth: 0, around: [], scope: facts?.scope ?? EMPTY_SCOPE }
  for (const node of facts?.includes ?? []) expandOne(exp, node, frame)
  if (exp.expanded.some((node) => node.options?.shift !== undefined)) applyShifts(document, findings)
  return { facts: exp.facts, findings, sources: exp.sources }
}
