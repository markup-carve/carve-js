// The program of spec/0.2/tooling.md ("Commands" to "Exit codes"), and the engine's upgrade command (C2-T-003).
import { readFileSync, writeFileSync } from 'node:fs'
import { CarveInputError, CarveLayoutError, CarveOptionError, CarveRenderError, CarveTreeError, CarveWriteError,
  decodeTree, encodeEnvelope, encodeTree, format, parse, parseWithDiagnostics, renderWithDiagnostics, renderWithDocumentTransforms,
  includeDependencies, type Diagnostic,
  type DocumentNode, type FormatOptions, type RenderOptions, write } from '../src/index.ts'
import { writerHasLoss } from '../src/write.ts'
import { forEachSlot, type Node } from '../src/ast.ts'
import { canWriteUpgrade, ENGINE_01_VERSION, formatRecord, needsAttention, type ReportRecord, upgrade } from '../upgrade/src/index.ts'
import { decodeUpgradeBytes } from '../upgrade/src/bytes.ts'
import { importDocument, ImportInputError, type Adapter, type Format } from '../import/src/index.ts'
import { hasUnallowedWriterLoss } from '../import/src/kit.ts'
import { migrateTree, type MigrationResult } from '../migrate/index.ts'
import cli from '../data/cli.json' with { type: 'json' }
import lintRules from '../data/lint-rules.json' with { type: 'json' }
import { FLAGS, type ParsedArgs, UsageError } from './flags.ts'
import { cliIncludes } from './include-fs.ts'
import { extensionNames, extensionOptions, type Registration, registration } from './standard-extensions.ts'
import { DirectoryImportError, importMarkdownDirectory, type DirectoryFormat } from './directory-import.ts'
import { lint } from '../lint/lint.ts'
import { fixSource } from './fix.ts'
import { flatten } from '../src/flatten.ts'
import { migrateCaseOnlyReferences } from '../build/engine-0.1/index.js'
import includeTable from '../data/includes.json' with { type: 'json' }
import {
  EXPORT_LOSS_CODES, exportTo, type ExportOptions, type ExportTarget, type MarkdownExportOptions,
} from '../src/export/index.ts'
import { diffTree, type PatchOperation } from '../src/tree-patch.ts'
import { type IncludeAnswer, type IncludeConfig, type IncludeRequest } from '../src/include-settings.ts'

/** C2-T-040: the failure categories and their status. */
const STATUS: ReadonlyMap<string, number> = new Map(cli.categories.map((row) => [row.name, row.status]))

/** A failure of the program with its category (C2-T-039, C2-T-040). */
export class CliError extends Error {
  readonly category: string
  constructor(category: string, message: string) {
    super(message)
    this.category = category
  }
}

export interface CliFailure { category: string, status: number }

/** C2-W-101, C2-T-006: each public engine error gives the category of its row. */
export function classifyCliError(error: unknown): CliFailure {
  const category = categoryOf(error)
  return { category, status: STATUS.get(category) ?? 2 }
}

function categoryOf(error: unknown): string {
  if (error instanceof CliError) return error.category
  if (error instanceof UsageError || error instanceof CarveOptionError) return 'usage'
  if (error instanceof CarveInputError) return 'input-invalid'
  if (error instanceof CarveTreeError || error instanceof CarveLayoutError) return 'ast-json-invalid'
  if (error instanceof ImportInputError) return 'import-input-invalid'
  if (error instanceof CarveWriteError) return 'writer-refused'
  return error instanceof CarveRenderError ? 'render-loss' : 'usage'
}

/** C2-T-027: the codes of the render-loss channel, which `--allow-loss` takes. */
const LOSS_CODES: ReadonlySet<string> = new Set(lintRules.rules.filter((rule) => rule.channel === 'render-loss').map((rule) => rule.id))

/** C2-T-013: a file by its path as given, standard input as `<stdin>`. */
function nameOf(path: string): string {
  return path === '-' ? '<stdin>' : path
}

function readBytes(path: string): Uint8Array {
  try { return path === '-' ? readFileSync(0) : readFileSync(path) }
  catch (error) { throw new CliError('input-unreadable', `${nameOf(path)}: ${String(error)}`) }
}

/** C2-T-012: Carve source is never refused for its encoding; a tree in JSON is strict UTF-8. */
function strictText(path: string, bytes: Uint8Array): string {
  try { return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes) }
  catch { throw new CliError('input-unreadable', `${nameOf(path)}: a tree in JSON is not UTF-8`) }
}

function lenientText(bytes: Uint8Array): string {
  return new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes)
}

/** The product of the run, held for `--output` (C2-T-003); standard output otherwise (C2-T-014). */
let product: string[] | null = null

function emit(text: string): void {
  if (product === null) process.stdout.write(text)
  else product.push(text)
}

/** C2-T-040: a file of `--write` or a report that cannot be written is `output-unwritable`. */
function writeOut(path: string, text: string): void {
  try { writeFileSync(path, Buffer.from(text, 'utf8')) }
  catch (error) { throw new CliError('output-unwritable', `${path}: ${String(error)}`) }
}

function tree(text: string): DocumentNode {
  try { return decodeTree(text) }
  catch (error) { throw new CliError('ast-json-invalid', error instanceof Error ? error.message : String(error)) }
}

/** The texts of the included files the run read, by id, so that an entry of one counts its line there (C2-T-019). */
const includedTexts = new Map<string, string>()

/** C2-T-018: the includes of an entry, unless `--no-includes` turns expansion off. */
function includesOf(path: string, args: ParsedArgs): { includes?: IncludeConfig } {
  if (args.values['includes'] === false) return {}
  const root = args.values['include-root']
  let config: ReturnType<typeof cliIncludes>
  try { config = cliIncludes(path, typeof root === 'string' ? root : undefined) }
  catch (error) { throw new CliError('usage', `the include root cannot be read: ${String(error)}`) }
  if (config === null) return {}
  const resolver = config.resolver
  const recorded = (request: IncludeRequest): IncludeAnswer => {
    const answer = resolver(request)
    if ('text' in answer) includedTexts.set(answer.id, typeof answer.text === 'string' ? answer.text : lenientText(answer.text))
    return answer
  }
  return { includes: { ...config, resolver: recorded } }
}

interface LocationIndex {
  bytes: Uint8Array
  starts: number[]
  columns: Map<number, number>
  ascii: boolean
}

function validSecond(first: number, second: number): boolean {
  if (second < 0x80 || second > 0xbf) return false
  if (first === 0xe0) return second >= 0xa0
  if (first === 0xed) return second <= 0x9f
  if (first === 0xf0) return second >= 0x90
  return first !== 0xf4 || second <= 0x8f
}

/** Number of bytes the decoder consumes before it emits one code point or replacement. */
function decodedWidth(bytes: Uint8Array, at: number): number {
  const first = bytes[at]!
  const expected = first >= 0xc2 && first <= 0xdf ? 2 : first >= 0xe0 && first <= 0xef ? 3
    : first >= 0xf0 && first <= 0xf4 ? 4 : 1
  if (expected === 1 || !validSecond(first, bytes[at + 1] ?? 0)) return 1
  let width = 2
  while (width < expected && bytes[at + width]! >= 0x80 && bytes[at + width]! <= 0xbf) width++
  return width
}

function leadingBom(bytes: Uint8Array, at: number, width: number): boolean {
  return at === 0 && width === 3 && bytes[at] === 0xef &&
    bytes[at + 1] === 0xbb && bytes[at + 2] === 0xbf
}

function lineStartsAndAscii(bytes: Uint8Array): { starts: number[], ascii: boolean } {
  const starts = [0]
  let ascii = true
  for (let at = 0; at < bytes.length; at++) {
    if (bytes[at] === 0x0a) starts.push(at + 1)
    if (bytes[at]! >= 0x80) ascii = false
  }
  return { starts, ascii }
}

/** C2-T-019: index line starts and only the columns the reports request. */
export function locationIndex(input: string | Uint8Array, requested: ReadonlySet<number>): LocationIndex {
  const bytes = typeof input === 'string' ? Buffer.from(input, 'utf8') : input
  const { starts, ascii } = lineStartsAndAscii(bytes)
  const columns = new Map<number, number>()
  if (ascii || requested.size === 0) return { bytes, starts, columns, ascii }
  let column = 1
  for (let at = 0; at < bytes.length;) {
    if (requested.has(at)) columns.set(at, column)
    const first = bytes[at]!
    if (first === 0x0a) {
      column = 1
      at++
      continue
    }
    // A decoder replaces one malformed UTF-8 prefix with one code point. An offset inside
    // that prefix includes the replacement, just as decoding a sliced prefix does.
    const width = decodedWidth(bytes, at)
    for (let step = 1; step < width; step++) if (requested.has(at + step)) columns.set(at + step, column + 1)
    if (!leadingBom(bytes, at, width)) column++
    at += width
  }
  // location() clamps a reported offset beyond EOF, so keep EOF available even when no
  // diagnostic asked for that exact offset.
  columns.set(bytes.length, column)
  return { bytes, starts, columns, ascii }
}

export function location(index: LocationIndex, entry: Diagnostic): { line: number, column: number } | null {
  if (entry.range === undefined) return null
  const offset = Math.min(entry.range.startOffset, index.bytes.length)
  let low = 0
  let high = index.starts.length
  while (low + 1 < high) {
    const middle = (low + high) >>> 1
    if (index.starts[middle]! <= offset) low = middle
    else high = middle
  }
  if (index.ascii) return { line: low + 1, column: offset - index.starts[low]! + 1 }
  const column = index.columns.get(offset)
  if (column === undefined) throw new Error(`diagnostic position ${offset} was not indexed`)
  return { line: low + 1, column }
}

function indexFor(entry: Diagnostic, own: LocationIndex, included: Map<string, LocationIndex>,
  requested: Map<string | undefined, Set<number>>): LocationIndex {
  if (entry.file === undefined) return own
  let index = included.get(entry.file)
  if (index === undefined) {
    index = locationIndex(includedTexts.get(entry.file) ?? '', requested.get(entry.file) ?? new Set())
    included.set(entry.file, index)
  }
  return index
}

/** C2-T-019: `FILE:LINE:COLUMN: SEVERITY CODE MESSAGE`, or `FILE: SEVERITY CODE MESSAGE` with no range. */
function diagnosticLine(display: string, entry: Diagnostic, own: LocationIndex,
  included: Map<string, LocationIndex>, requested: Map<string | undefined, Set<number>>): string {
  const index = indexFor(entry, own, included, requested)
  const place = location(index, entry)
  const head = `${entry.file ?? display}${place === null ? '' : `:${place.line}:${place.column}`}`
  const chain = entry.includedBy?.map((part) => {
    const siteIndex = part.file === undefined ? own : indexFor({ ...entry, file: part.file }, own, included, requested)
    const site = location(siteIndex, { ...entry, range: part.range })
    return `${part.file ?? display}${site === null ? '' : `:${site.line}:${site.column}`}`
  }).join(' > ')
  return `${head}: ${entry.severity} ${entry.code} ${entry.message}${chain ? ` (included from ${chain})` : ''}\n`
}

function requestedOffsets(entries: readonly Diagnostic[]): Map<string | undefined, Set<number>> {
  const requested = new Map<string | undefined, Set<number>>()
  const add = (file: string | undefined, range: Diagnostic['range']): void => {
    if (range === undefined) return
    let offsets = requested.get(file)
    if (offsets === undefined) { offsets = new Set(); requested.set(file, offsets) }
    offsets.add(range.startOffset)
  }
  for (const entry of entries) {
    add(entry.file, entry.range)
    for (const part of entry.includedBy ?? []) add(part.file, part.range)
  }
  return requested
}

function lines(display: string, input: string, entries: readonly Diagnostic[], bytes?: Uint8Array): string {
  if (entries.length === 0) return ''
  const requested = requestedOffsets(entries)
  const own = locationIndex(bytes ?? input, requested.get(undefined) ?? new Set())
  const included = new Map<string, LocationIndex>()
  return entries.map((entry) => diagnosticLine(display, entry, own, included, requested)).join('')
}

/** C2-T-020: an entry with `line` and `column` added where it has a range. */
function located(input: string, entries: readonly Diagnostic[], bytes?: Uint8Array): object[] {
  if (entries.length === 0) return []
  const requested = requestedOffsets(entries)
  const own = locationIndex(bytes ?? input, requested.get(undefined) ?? new Set())
  const included = new Map<string, LocationIndex>()
  return entries.map((entry) => {
    const place = location(indexFor(entry, own, included, requested), entry)
    const includedBy = entry.includedBy?.map((part) => {
      const index = part.file === undefined ? own : indexFor({ ...entry, file: part.file }, own, included, requested)
      const site = location(index, { ...entry, range: part.range })
      return { ...part, ...(site ?? {}) }
    })
    return { ...entry, ...(place ?? {}), ...(includedBy === undefined ? {} : { includedBy }) }
  })
}

/** What one file adds to the reports of the run (C2-T-021, C2-T-022). */
interface FileResult {
  status: number
  diagnostics?: object
  losses?: object
  includes?: object
}

/** A failure of status 1 ends its file and the run goes on (C2-T-017). */
class FileFailure extends Error {
  readonly category: string
  readonly result: FileResult
  readonly details: string
  constructor(category: string, message: string, result: FileResult, details = '') {
    super(message)
    this.category = category
    this.result = result
    this.details = details
  }
}

const NO_EXTENSIONS: Registration = { extensions: [], renderers: {}, transforms: [] }

/** The standard extensions of `--extensions` for the run (C2-T-010). */
let standard = NO_EXTENSIONS

/** C2-T-010: the options the flags of the command set; `--extensions` gives the registrations of the standard extensions. */
function options(args: ParsedArgs): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const flag of FLAGS) {
    const value = args.values[flag.name]
    if (flag.option !== undefined && flag.option !== 'extensions' && flag.commands.includes(args.command) && value !== undefined) {
      result[flag.option] = value
    }
  }
  if (standard.extensions.length > 0) result['extensions'] = standard.extensions
  if (Object.keys(standard.renderers).length > 0) result['renderers'] = standard.renderers
  return result
}

/** The `extensions` option of a parse, where `--extensions` registers any. */
function registered(): { extensions?: Registration['extensions'] } {
  return standard.extensions.length > 0 ? { extensions: standard.extensions } : {}
}

function standardExtensions(args: ParsedArgs): Registration {
  if (args.values['extensions'] === undefined && args.values['extension-options'] === undefined) return NO_EXTENSIONS
  const names = args.values['extensions'] === undefined ? [] : extensionNames(args.values['extensions'])
  return registration(names, extensionOptions(args.values['extension-options'], names), args.command === 'render')
}

function allowedLosses(args: ParsedArgs): ReadonlySet<string> {
  const names = (args.values['allow-loss'] as string[] | undefined) ?? []
  const exporting = args.values['to'] !== undefined && args.values['to'] !== 'html'
  for (const name of names) {
    if (!LOSS_CODES.has(name) && !(exporting && EXPORT_LOSS_CODES.includes(name))) {
      throw new UsageError(`${name} is no code of the render-loss channel`)
    }
  }
  return new Set(names)
}

/** C2-T-025, C2-T-027, C2-T-029: the losses of a file, its retained ones and the number held back. */
function lossesOf(args: ParsedArgs, entries: readonly Diagnostic[]): { losses: Diagnostic[], retained: Diagnostic[], suppressed: number } {
  const allowed = allowedLosses(args)
  const losses = entries.filter((entry) => entry.channel === 'render-loss' && !allowed.has(entry.code))
  const limit = (args.values['max-render-losses'] as number | undefined) ?? 100
  return { losses, retained: losses.slice(0, limit), suppressed: Math.max(0, losses.length - limit) }
}

function hasRawHtml(document: DocumentNode): boolean {
  const pending: Node[] = [document]
  for (let node = pending.pop(); node !== undefined; node = pending.pop()) {
    if ((node.type === 'raw_block' || node.type === 'raw_inline') && node.format === 'html') return true
    forEachSlot(node, (nodes) => { for (const child of nodes) pending.push(child) })
  }
  return false
}

const RAW_HTML_FORMAT = Buffer.from('=html')

// A raw format is the name right behind `=` (C2-I-021, C2-B-116), so bytes without `=html` hold no raw HTML.
function holdsRawHtml(input: DocumentNode | Uint8Array): boolean {
  if (!(input instanceof Uint8Array)) return hasRawHtml(input)
  return Buffer.from(input.buffer, input.byteOffset, input.byteLength).includes(RAW_HTML_FORMAT) && hasRawHtml(parse(input))
}

let rawHtmlEscaped = false

function includeEntry(display: string, document: DocumentNode): object {
  return { file: display, dependencies: includeDependencies(document) }
}

/** `render --to markdown|plain|ansi`: the export of the file, with the loss gate of `render`. */
function exportFile(path: string, display: string, bytes: Uint8Array, args: ParsedArgs, target: ExportTarget): FileResult {
  const fromAst = args.values['from-ast'] === true
  const document = fromAst ? tree(strictText(path, bytes)) : parse(bytes, { ...includesOf(path, args), ...registered() })
  const source = fromAst ? '' : lenientText(bytes)
  const settings: MarkdownExportOptions = {}
  if (args.values['smart-typography'] !== undefined) settings.smartTypography = args.values['smart-typography'] as boolean
  // C2-H-209: the Markdown export reads it, and the plain-text and ANSI exports refuse it with the category usage.
  if (args.values['heading-shift'] !== undefined) settings.headingShift = args.values['heading-shift'] as number
  if (args.values['url-policy'] !== undefined) settings.urlPolicy = args.values['url-policy'] as NonNullable<ExportOptions['urlPolicy']>
  const result = exportTo(target, document, settings)
  const { losses, retained, suppressed } = lossesOf(args, result.diagnostics)
  const file: FileResult = { status: 0, losses: { file: display,
    diagnostics: located(source, retained, fromAst ? undefined : bytes), suppressed } }
  if (args.values['report-includes'] !== undefined) file.includes = includeEntry(display, document)
  const strict = args.values['strict-losses'] === true && losses.length > 0
  if (strict) process.stderr.write(`carve[render-loss]: ${display}: ${losses.length} render losses under --strict-losses\n`)
  process.stderr.write(lines(display, source, retained, fromAst ? undefined : bytes))
  if (strict) return { ...file, status: 1 }
  file.status = strictStatus(args, retained)
  emit(result.output)
  return file
}

function renderFile(path: string, display: string, bytes: Uint8Array, args: ParsedArgs): FileResult {
  const fromAst = args.values['from-ast'] === true
  const settings = { ...options(args), ...(fromAst ? {} : includesOf(path, args)) } as RenderOptions
  const input = fromAst ? tree(strictText(path, bytes)) : bytes
  const source = fromAst ? '' : lenientText(bytes)
  // C2-T-026: the allow list is applied before strictLosses, so the gate is the command's.
  const unlimited = { ...settings, strictLosses: false, maxLosses: Number.MAX_SAFE_INTEGER }
  const result = standard.transforms.length > 0 ? renderWithDocumentTransforms(input, standard.transforms, unlimited)
    : renderWithDiagnostics(input, unlimited)
  const { losses, retained, suppressed } = lossesOf(args, result.diagnostics)
  const file: FileResult = { status: 0, losses: { file: display,
    diagnostics: located(source, retained, fromAst ? undefined : bytes), suppressed } }
  if (args.values['report-includes'] !== undefined) {
    const document = fromAst ? input as DocumentNode : parseWithDiagnostics(bytes, includesOf(path, args)).document
    file.includes = includeEntry(display, document)
  }
  const strict = settings.strictLosses === true && losses.length > 0
  if (strict) process.stderr.write(`carve[render-loss]: ${display}: ${losses.length} render losses under --strict-losses\n`)
  process.stderr.write(lines(display, source, retained, fromAst ? undefined : bytes))
  if (strict) return { ...file, status: 1 }
  file.status = strictStatus(args, retained)
  rawHtmlEscaped ||= settings.rawHtml !== true && holdsRawHtml(fromAst ? input as DocumentNode : bytes)
  emit(`${result.html}\n`)
  return file
}

/** C2-T-003: `--strict` fails a file that wrote an entry, and still writes its output. */
function strictStatus(args: ParsedArgs, written: readonly Diagnostic[]): number {
  return args.values['strict'] === true && written.length > 0 ? 1 : 0
}

function astFile(path: string, display: string, bytes: Uint8Array, args: ParsedArgs): FileResult {
  const document = parse(bytes, { positions: args.values['positions'] !== false, ...includesOf(path, args), ...registered() })
  emit(`${args.values['envelope'] === true ? encodeEnvelope(document) : encodeTree(document)}\n`)
  return { status: 0, includes: includeEntry(display, document) }
}

/** C2-W-100: the first line that changes, and its old and new text; a missing line is its prefix alone. */
function firstChange(display: string, before: string, after: string): string {
  const oldLines = linesWithEndings(before)
  const newLines = linesWithEndings(after)
  let at = 0
  while (at < oldLines.length && oldLines[at]?.raw === newLines[at]?.raw) at++
  const side = (prefix: string, line: string | undefined): string => (line === undefined ? prefix : `${prefix} ${line}`)
  return `${display}:${at + 1}\n${side('-', oldLines[at]?.body)}\n${side('+', newLines[at]?.body)}\n`
}

function linesWithEndings(text: string): { raw: string, body: string }[] {
  const lines = text.match(/[^\n]*\n|[^\n]+$/g) ?? []
  return lines.map((raw) => ({ raw, body: raw.replace(/\r?\n$/, '') }))
}

function unified(display: string, before: string, after: string): string {
  const left = before.split('\n')
  const right = after.split('\n')
  if (before.endsWith('\n')) left.pop()
  if (after.endsWith('\n')) right.pop()
  return [`--- a/${display}`, `+++ b/${display}`, `@@ -1,${left.length} +1,${right.length} @@`,
    ...left.map((line) => `-${line}`), ...right.map((line) => `+${line}`), ''].join('\n')
}

function formatted(path: string, bytes: Uint8Array, args: ParsedArgs): { before: string, after: string } {
  const settings = options(args) as FormatOptions
  if (args.values['from-ast'] === true) {
    const text = strictText(path, bytes)
    return { before: text, after: write(tree(text), { alignTables: settings.alignTables === true }) }
  }
  const before = lenientText(bytes)
  return { before, after: format(before, settings) }
}

function fmtFile(path: string, display: string, bytes: Uint8Array, args: ParsedArgs): FileResult {
  let result: { before: string, after: string }
  try { result = formatted(path, bytes, args) }
  catch (error) {
    if (!(error instanceof CarveWriteError)) throw error
    const losses = error.diagnostics.filter((entry) => writerHasLoss([entry])).map((entry) => `${entry.code} at ${entry.path || '/'}`)
    throw new FileFailure('writer-refused', `${display}: ${losses.join(', ')}`, { status: 1 })
  }
  return { status: fmtOutput(path, display, result.before, result.after, args) }
}

function fmtOutput(path: string, display: string, before: string, after: string, args: ParsedArgs): number {
  const changed = before !== after
  const check = args.values['check'] === true
  const diff = args.values['diff'] === true
  if (check && changed && !diff) emit(firstChange(display, before, after))
  if (diff && changed) emit(unified(display, before, after))
  if (args.values['write'] === true && changed) writeOut(path, after)
  if (!check && !diff && args.values['write'] !== true) emit(after)
  return (check || diff) && changed ? 1 : 0
}

/** C2-T-031: status 1 for an entry of severity warning or error; with `--strict`, for any entry (C2-T-003). */
function lintStatus(entries: readonly Diagnostic[], args: ParsedArgs): number {
  if (args.values['strict'] === true) return strictStatus(args, entries)
  return entries.some((entry) => entry.severity === 'warning' || entry.severity === 'error') ? 1 : 0
}

/** `--ignore`: the entries of a file whose id, or for the entry file its name, is listed (C2-T-003). */
function notIgnored(display: string, entries: readonly Diagnostic[], args: ParsedArgs): Diagnostic[] {
  const ignored = new Set((args.values['ignore'] as string[] | undefined) ?? [])
  return ignored.size === 0 ? [...entries] : entries.filter((entry) => !ignored.has(entry.file ?? display))
}

type LintSettings = { rules?: Record<string, 'on' | 'off'>, platforms?: string[] }

/** `--fix`: the source with each documented replacement (cli/fix.ts), written back or to the product. */
function fixed(path: string, display: string, source: string, settings: LintSettings, args: ParsedArgs): string {
  const result = fixSource(source, settings as Parameters<typeof fixSource>[1])
  if (result.applied.size > 0) {
    const counts = [...result.applied].map(([rule, count]) => `${rule} ${count}`).join(', ')
    process.stderr.write(`${display}: fixed ${counts}\n`)
  }
  if (args.values['write'] !== true) emit(result.output)
  else if (result.output !== source) writeOut(path, result.output)
  return result.output
}

function lintFile(path: string, display: string, bytes: Uint8Array, args: ParsedArgs): FileResult {
  const settings = options(args) as LintSettings
  const fix = args.values['fix'] === true
  const source = fix ? fixed(path, display, lenientText(bytes), settings, args) : lenientText(bytes)
  const all = lint(source, { ...settings, ...includesOf(path, args) } as Parameters<typeof lint>[1])
  const entries = notIgnored(display, all, args)
  const text = lines(display, source, entries)
  // With `--fix` and no `--write` the product is the source, so the entries go to standard error.
  if (fix && args.values['write'] !== true) process.stderr.write(text)
  else if (args.values['json'] !== true) emit(text)
  return { status: lintStatus(entries, args), diagnostics: { file: display, diagnostics: located(source, entries), suppressed: 0 } }
}

/** The codes of the causes that leave an include unexpanded (C2-N-061). */
const INCLUDE_CAUSES: ReadonlySet<string> = new Set(includeTable.causes.map((cause) => cause.code))

/** `flatten` (C2-T-003): the expanded tree as one Carve file; an include that did not expand refuses the file. */
function flattenFile(path: string, display: string, bytes: Uint8Array, args: ParsedArgs): FileResult {
  const source = lenientText(bytes)
  const result = parseWithDiagnostics(bytes, includesOf(path, args))
  const failures = result.diagnostics.filter((entry) => INCLUDE_CAUSES.has(entry.code))
  if (failures.length > 0) {
    throw new FileFailure('include-unresolved', `${display}: ${failures.length} includes did not expand`,
      { status: 1 }, lines(display, source, failures, bytes))
  }
  let flat: ReturnType<typeof flatten>
  try { flat = flatten(result.document) }
  catch (error) {
    if (!(error instanceof CarveWriteError)) throw error
    const losses = error.diagnostics.filter((entry) => writerHasLoss([entry])).map((entry) => `${entry.code} at ${entry.path || '/'}`)
    throw new FileFailure('writer-refused', `${display}: ${losses.join(', ')}`, { status: 1 })
  }
  if (!flat.same) {
    throw new FileFailure('flatten-changed', `${display}: one file would render differently; a footnote, reference or abbreviation key is defined in more than one file`, { status: 1 })
  }
  emit(flat.source)
  return { status: 0 }
}

/** C2-T-032: the entries of the parse channel, status 0 whatever they report. */
function diagnosticsFile(path: string, display: string, bytes: Uint8Array, args: ParsedArgs): FileResult {
  const source = lenientText(bytes)
  const result = parseWithDiagnostics(bytes, includesOf(path, args))
  const entries = result.diagnostics.filter((entry) => entry.channel === 'parse')
  if (args.values['json'] !== true) emit(lines(display, source, entries, bytes))
  const report = { file: display, diagnostics: located(source, entries, bytes), suppressed: result.suppressedDiagnostics }
  return { status: 0, diagnostics: report, includes: includeEntry(display, result.document) }
}

/** C2-T-033 to C2-T-035: the importer, with the loss gate of `render`. */
function importFile(display: string, bytes: Uint8Array, args: ParsedArgs): FileResult {
  const html = lenientText(bytes)
  const strict = args.values['strict-losses'] === true
  const allowed = allowedLosses(args)
  let result: ReturnType<typeof importDocument>
  try {
    result = importDocument(html, { from: args.values['from'] as Format, rawHtml: args.values['raw-html'] === true, strictLosses: strict,
      listTable: args.values['list-table'] === true,
      allowLosses: [...allowed], maxLosses: (args.values['max-render-losses'] as number | undefined) ?? 100,
      ...(args.values['adapter'] !== undefined ? { adapter: args.values['adapter'] as Adapter } : {}) })
  } catch (error) {
    if (error instanceof CarveTreeError) throw new FileFailure('import-tree-invalid', `${display}: ${error.message}`, { status: 1 })
    throw error
  }
  const { losses, retained, suppressed } = lossesOf(args, result.diagnostics)
  const totalSuppressed = suppressed + (result.suppressedDiagnostics ?? 0)
  const file: FileResult = { status: 0, losses: { file: display, diagnostics: located(html, retained), suppressed: totalSuppressed } }
  const others = result.diagnostics.filter((entry) => entry.channel !== 'render-loss')
  // An allowed code is no loss (C2-T-025), so only the writer entries left after --allow-loss refuse the file.
  const failure = strict && losses.length + totalSuppressed > 0 ? 'render-loss' : hasUnallowedWriterLoss(result) ? 'writer-refused' : null
  if (failure !== null) process.stderr.write(`carve[${failure}]: ${display}: the import lost content\n`)
  process.stderr.write(lines(display, html, [...others, ...retained]))
  if (failure !== null) return { ...file, status: 1 }
  emit(result.source)
  return file
}

/** C2-T-036: the migrated tree, and each entry of the record as a line on standard error. */
function migrateFile(path: string, display: string, bytes: Uint8Array): FileResult {
  const text = strictText(path, bytes)
  let result: MigrationResult
  try { result = migrateTree(JSON.parse(text) as unknown) }
  catch (error) { throw new CliError('ast-json-invalid', error instanceof Error ? error.message : String(error)) }
  process.stderr.write(lines(display, text, result.diagnostics))
  emit(`${result.envelope === undefined ? encodeTree(result.document) : JSON.stringify(result.envelope)}\n`)
  return { status: 0 }
}

function upgradeSource(display: string, bytes: Uint8Array): string {
  try { return decodeUpgradeBytes(bytes) }
  catch (error) { throw new CliError('input-unreadable', `${display}: ${error instanceof Error ? error.message : String(error)}`) }
}

/**
 * `--migrate`, the `fmt --migrate` of 0.1: a cross-reference or reference label that misses its target only by
 * case is respelled in the 0.1 source when exactly one target matches it, before the upgrade reads it.
 */
function caseReferences(source: string): { source: string, records: ReportRecord[] } {
  const respelled: string = migrateCaseOnlyReferences(source)
  if (respelled === source) return { source, records: [] }
  const before = source.split('\n')
  const after = respelled.split('\n')
  const records: ReportRecord[] = []
  for (let line = 0; line < before.length; line++) {
    if (before[line] === after[line]) continue
    records.push({ entry: 'case-reference', class: 'rewrite', line: line + 1,
      message: 'a reference that missed its target only by case is respelled to that target' })
  }
  return { source: respelled, records }
}

function upgraded(original: string, args: ParsedArgs): ReturnType<typeof upgrade> {
  const migrated = args.values['migrate'] === true ? caseReferences(original) : { source: original, records: [] }
  const result = upgrade(migrated.source, (args.values['registered-extension'] as ('wikilinks' | 'samp')[] | undefined) ?? [])
  return { ...result, changed: result.output !== original, records: [...migrated.records, ...result.records] }
}

/** The upgrade command of the reference engine (C2-T-003, UPGRADING.md). */
function upgradeFile(path: string, display: string, bytes: Uint8Array, args: ParsedArgs): FileResult {
  const result = upgraded(upgradeSource(display, bytes), args)
  const blocked = !canWriteUpgrade(result)
  if (blocked && args.values['force'] === true && args.values['check'] !== true) {
    process.stderr.write('carve[upgrade-force-ignored]: --force cannot override the HTML check\n')
  }
  if (args.values['write'] === true && result.changed && !blocked) writeOut(path, result.output)
  else if (args.values['write'] !== true && args.values['check'] !== true && args.values['json'] !== true) emit(result.output)
  if (args.values['json'] !== true) for (const entry of result.records) process.stderr.write(`${formatRecord(display, entry)}\n`)
  return { status: needsAttention(result) || (args.values['check'] === true && result.changed) ? 1 : 0,
    diagnostics: { file: display, changed: result.changed, check: result.check, records: result.records } }
}

function executeFile(path: string, args: ParsedArgs): FileResult {
  const bytes = readBytes(path)
  const display = nameOf(path)
  switch (args.command) {
    case 'render': {
      const target = args.values['to'] as ExportTarget | 'html' | undefined
      return target === undefined || target === 'html' ? renderFile(path, display, bytes, args) : exportFile(path, display, bytes, args, target)
    }
    case 'ast': return astFile(path, display, bytes, args)
    case 'fmt': return fmtFile(path, display, bytes, args)
    case 'diagnostics': return diagnosticsFile(path, display, bytes, args)
    case 'lint': return lintFile(path, display, bytes, args)
    case 'upgrade': return upgradeFile(path, display, bytes, args)
    case 'migrate-ast': return migrateFile(path, display, bytes)
    case 'import': return importFile(display, bytes, args)
    case 'flatten': return flattenFile(path, display, bytes, args)
    case 'diff': throw new UsageError('diff takes two files')
  }
}

/** C2-T-015, C2-T-023: one JSON document for the run, on standard error for `-`. */
function report(destination: unknown, value: unknown): void {
  if (typeof destination !== 'string') return
  const json = `${JSON.stringify(value, null, 2)}\n`
  if (destination === '-') process.stderr.write(json)
  else writeOut(destination, json)
}

interface Collected {
  diagnostics: object[]
  losses: object[]
  includes: object[]
}

function collect(into: Collected, result: FileResult): void {
  if (result.diagnostics !== undefined) into.diagnostics.push(result.diagnostics)
  if (result.losses !== undefined) into.losses.push(result.losses)
  if (result.includes !== undefined) into.includes.push(result.includes)
}

function finishRun(args: ParsedArgs, collected: Collected): void {
  report(args.values['report-includes'], { files: collected.includes })
  report(args.values['report-losses'], { files: collected.losses })
  if (rawHtmlEscaped) process.stderr.write('carve: raw HTML escaped; pass --raw-html to allow it\n')
  if (args.command === 'upgrade') {
    process.stderr.write('U-079 report: review host render options; rawHtml is off by default (pass --raw-html to keep raw HTML).\n')
    process.stderr.write(`read with the 0.1 engine ${ENGINE_01_VERSION}\n`)
  }
  if (args.values['json'] !== true) return
  const output = args.command === 'upgrade' ? { engine01: ENGINE_01_VERSION, files: collected.diagnostics } : { files: collected.diagnostics }
  emit(`${JSON.stringify(output, null, 2)}\n`)
}

/**
 * The diff command of the reference engine: the JSON Patch from the tree of the first file to that of the second,
 * without positions. Status 0 when the trees are equal, 1 when they differ.
 */
function diffFiles(args: ParsedArgs): number {
  if (args.files.length !== 2) throw new UsageError('diff takes two files')
  const [before, after] = args.files.map((path) => parse(readBytes(path), { positions: false }))
  const patch = diffTree(before!, after!)
  process.stdout.write(args.values['json'] === true ? `${JSON.stringify(patch, null, 2)}\n` : patch.map(operationLine).join(''))
  return patch.length === 0 ? 0 : 1
}

function operationLine(operation: PatchOperation): string {
  const value = 'value' in operation ? ` ${JSON.stringify(operation.value)}` : 'from' in operation ? ` from ${operation.from}` : ''
  return `${operation.op} ${operation.path === '' ? '/' : operation.path}${value}\n`
}

/**
 * `import --directory SOURCE --output TARGET` (C2-T-003): the tree of Markdown files as a new tree of Carve files.
 * Status 1 with `--strict-losses` when a file needs review or an entry was skipped.
 */
function importDirectory(args: ParsedArgs): number {
  let summary: ReturnType<typeof importMarkdownDirectory>
  try { summary = importMarkdownDirectory(args.values['directory'] as string, args.values['output'] as string, args.values['from'] as DirectoryFormat) }
  catch (error) {
    if (error instanceof DirectoryImportError) throw new CliError(error.unreadable ? 'input-unreadable' : 'usage', error.message)
    throw error
  }
  process.stdout.write(`${summary.files} file(s) converted; ${summary.assets} asset(s) copied; ${summary.review} file(s) need review; ${summary.skipped} entry(s) skipped. Report: ${summary.report}\n`)
  return args.values['strict-losses'] === true && (summary.review > 0 || summary.skipped > 0) ? 1 : 0
}

/** C2-T-011, C2-T-017: the files in order; a failure of status 2 stops the run, one of status 1 ends its file. */
export function run(args: ParsedArgs): number {
  if (args.command === 'diff') return diffFiles(args)
  if (args.command === 'import' && typeof args.values['directory'] === 'string') return importDirectory(args)
  const files = args.files.length === 0 ? ['-'] : args.files
  includedTexts.clear()
  rawHtmlEscaped = false
  standard = standardExtensions(args)
  const collected: Collected = { diagnostics: [], losses: [], includes: [] }
  const output = args.values['output']
  product = typeof output === 'string' ? [] : null
  let finished = false
  try {
    const status = runFiles(files, args, collected)
    finished = true
    return status
  } finally {
    // C2-T-017: what the files before a failure produced stays written; a run that produced nothing keeps the file.
    const held = product
    product = null
    if (held !== null && (finished || held.length > 0)) writeOut(output as string, held.join(''))
  }
}

function runFiles(files: readonly string[], args: ParsedArgs, collected: Collected): number {
  let status = 0
  for (const file of files) {
    let result: FileResult
    try { result = executeFile(file, args) }
    catch (error) {
      if (!(error instanceof FileFailure)) throw error
      process.stderr.write(`carve[${error.category}]: ${error.message}\n`)
      if (error.details !== '') process.stderr.write(error.details)
      result = error.result
    }
    collect(collected, result)
    status = Math.max(status, result.status)
  }
  finishRun(args, collected)
  return status
}
