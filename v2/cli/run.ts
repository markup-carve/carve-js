// The program of spec/0.2/tooling.md ("Commands" to "Exit codes"), and the engine's upgrade command (C2-T-003).
import { readFileSync, writeFileSync } from 'node:fs'
import { CarveInputError, CarveLayoutError, CarveOptionError, CarveRenderError, CarveTreeError, CarveWriteError,
  decodeTree, encodeEnvelope, encodeTree, format, parse, parseWithDiagnostics, renderWithDiagnostics, includeDependencies, type Diagnostic,
  type DocumentNode, type FormatOptions, type RenderOptions, write } from '../src/index.ts'
import { writerHasLoss } from '../src/write.ts'
import { forEachSlot, type Node } from '../src/ast.ts'
import { canWriteUpgrade, ENGINE_01_VERSION, formatRecord, needsAttention, upgrade } from '../../upgrade/src/index.ts'
import { decodeUpgradeBytes } from '../../upgrade/src/bytes.ts'
import { importDocument, ImportInputError, type Format } from '../../import/src/index.ts'
import { migrateTree, type MigrationResult } from '../migrate/index.ts'
import cli from '../data/cli.json' with { type: 'json' }
import lintRules from '../data/lint-rules.json' with { type: 'json' }
import { FLAGS, type ParsedArgs, UsageError } from './flags.ts'
import { cliIncludes } from './include-fs.ts'
import { lint } from '../lint/lint.ts'
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
}

/** C2-T-019: index line starts once in the original bytes of a file. */
function locationIndex(input: string | Uint8Array): LocationIndex {
  const bytes = typeof input === 'string' ? Buffer.from(input, 'utf8') : input
  const starts = [0]
  for (let at = 0; at < bytes.length; at++) if (bytes[at] === 0x0a) starts.push(at + 1)
  return { bytes, starts }
}

function location(index: LocationIndex, entry: Diagnostic): { line: number, column: number } | null {
  if (entry.range === undefined) return null
  const offset = Math.min(entry.range.startOffset, index.bytes.length)
  let low = 0
  let high = index.starts.length
  while (low + 1 < high) {
    const middle = (low + high) >>> 1
    if (index.starts[middle]! <= offset) low = middle
    else high = middle
  }
  const prefix = new TextDecoder().decode(index.bytes.subarray(index.starts[low], offset))
  return { line: low + 1, column: Array.from(prefix).length + 1 }
}

function indexFor(entry: Diagnostic, own: LocationIndex, included: Map<string, LocationIndex>): LocationIndex {
  if (entry.file === undefined) return own
  let index = included.get(entry.file)
  if (index === undefined) {
    index = locationIndex(includedTexts.get(entry.file) ?? '')
    included.set(entry.file, index)
  }
  return index
}

/** C2-T-019: `FILE:LINE:COLUMN: SEVERITY CODE MESSAGE`, or `FILE: SEVERITY CODE MESSAGE` with no range. */
function diagnosticLine(display: string, entry: Diagnostic, index: LocationIndex): string {
  const place = location(index, entry)
  const head = `${entry.file ?? display}${place === null ? '' : `:${place.line}:${place.column}`}`
  return `${head}: ${entry.severity} ${entry.code} ${entry.message}\n`
}

function lines(display: string, input: string, entries: readonly Diagnostic[], bytes?: Uint8Array): string {
  const own = locationIndex(bytes ?? input)
  const included = new Map<string, LocationIndex>()
  return entries.map((entry) => diagnosticLine(display, entry, indexFor(entry, own, included))).join('')
}

/** C2-T-020: an entry with `line` and `column` added where it has a range. */
function located(input: string, entries: readonly Diagnostic[], bytes?: Uint8Array): object[] {
  const own = locationIndex(bytes ?? input)
  const included = new Map<string, LocationIndex>()
  return entries.map((entry) => {
    const place = location(indexFor(entry, own, included), entry)
    return place === null ? { ...entry } : { ...entry, ...place }
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
  constructor(category: string, message: string, result: FileResult) {
    super(message)
    this.category = category
    this.result = result
  }
}

/** C2-T-010: the options the flags of the command set. */
function options(args: ParsedArgs): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const flag of FLAGS) {
    const value = args.values[flag.name]
    if (flag.option !== undefined && flag.commands.includes(args.command) && value !== undefined) result[flag.option] = value
  }
  return result
}

function allowedLosses(args: ParsedArgs): ReadonlySet<string> {
  const names = (args.values['allow-loss'] as string[] | undefined) ?? []
  for (const name of names) if (!LOSS_CODES.has(name)) throw new UsageError(`${name} is no code of the render-loss channel`)
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

let rawHtmlEscaped = false

function includeEntry(display: string, document: DocumentNode): object {
  return { file: display, dependencies: includeDependencies(document) }
}

function renderFile(path: string, display: string, bytes: Uint8Array, args: ParsedArgs): FileResult {
  const fromAst = args.values['from-ast'] === true
  const settings = { ...options(args), ...(fromAst ? {} : includesOf(path, args)) } as RenderOptions
  const input = fromAst ? tree(strictText(path, bytes)) : bytes
  const source = fromAst ? '' : lenientText(bytes)
  // C2-T-026: the allow list is applied before strictLosses, so the gate is the command's.
  const result = renderWithDiagnostics(input, { ...settings, strictLosses: false })
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
  rawHtmlEscaped ||= settings.rawHtml !== true && hasRawHtml(fromAst ? input as DocumentNode : parse(bytes))
  process.stdout.write(`${result.html}\n`)
  return file
}

function astFile(path: string, display: string, bytes: Uint8Array, args: ParsedArgs): FileResult {
  const document = parse(bytes, { positions: args.values['positions'] !== false, ...includesOf(path, args) })
  process.stdout.write(`${args.values['envelope'] === true ? encodeEnvelope(document) : encodeTree(document)}\n`)
  return { status: 0, includes: includeEntry(display, document) }
}

/** C2-W-100: the first line that changes, and its old and new text; a missing line is its prefix alone. */
function firstChange(display: string, before: string, after: string): string {
  const oldLines = linesOf(before)
  const newLines = linesOf(after)
  let at = 0
  while (at < oldLines.length && oldLines[at] === newLines[at]) at++
  const side = (prefix: string, line: string | undefined): string => (line === undefined ? prefix : `${prefix} ${line}`)
  return `${display}:${at + 1}\n${side('-', oldLines[at])}\n${side('+', newLines[at])}\n`
}

function linesOf(text: string): string[] {
  const out = text.split('\n')
  if (text.endsWith('\n')) out.pop()
  return out
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
  if (check && changed && !diff) process.stdout.write(firstChange(display, before, after))
  if (diff && changed) process.stdout.write(unified(display, before, after))
  if (args.values['write'] === true && changed) writeOut(path, after)
  if (!check && !diff && args.values['write'] !== true) process.stdout.write(after)
  return (check || diff) && changed ? 1 : 0
}

/** C2-T-031: status 1 for an entry of severity warning or error. */
function lintFile(path: string, display: string, bytes: Uint8Array, args: ParsedArgs): FileResult {
  const source = lenientText(bytes)
  const settings = options(args) as { rules?: Record<string, 'on' | 'off'>, platforms?: string[] }
  const entries = lint(source, { ...settings, ...includesOf(path, args) } as Parameters<typeof lint>[1])
  const status = entries.some((entry) => entry.severity === 'warning' || entry.severity === 'error') ? 1 : 0
  if (args.values['json'] !== true) process.stdout.write(lines(display, source, entries))
  return { status, diagnostics: { file: display, diagnostics: located(source, entries), suppressed: 0 } }
}

/** C2-T-032: the entries of the parse channel, status 0 whatever they report. */
function diagnosticsFile(path: string, display: string, bytes: Uint8Array, args: ParsedArgs): FileResult {
  const source = lenientText(bytes)
  const result = parseWithDiagnostics(bytes, includesOf(path, args))
  const entries = result.diagnostics.filter((entry) => entry.channel === 'parse')
  if (args.values['json'] !== true) process.stdout.write(lines(display, source, entries, bytes))
  const report = { file: display, diagnostics: located(source, entries, bytes), suppressed: result.suppressedDiagnostics }
  return { status: 0, diagnostics: report, includes: includeEntry(display, result.document) }
}

/** C2-T-033 to C2-T-035: the importer, with the loss gate of `render`. */
function importFile(display: string, bytes: Uint8Array, args: ParsedArgs): FileResult {
  const html = lenientText(bytes)
  const strict = args.values['strict-losses'] === true
  let result: ReturnType<typeof importDocument>
  try {
    result = importDocument(html, { from: args.values['from'] as Format, rawHtml: args.values['raw-html'] === true, strictLosses: strict })
  } catch (error) {
    if (error instanceof CarveTreeError) throw new FileFailure('import-tree-invalid', `${display}: ${error.message}`, { status: 1 })
    throw error
  }
  const { losses, retained, suppressed } = lossesOf(args, result.diagnostics)
  const file: FileResult = { status: 0, losses: { file: display, diagnostics: located(html, retained), suppressed } }
  const others = result.diagnostics.filter((entry) => entry.channel !== 'render-loss')
  const failure = strict && losses.length > 0 ? 'render-loss' : writerHasLoss(result.diagnostics) ? 'writer-refused' : null
  if (failure !== null) process.stderr.write(`carve[${failure}]: ${display}: the import lost content\n`)
  process.stderr.write(lines(display, html, [...others, ...retained]))
  if (failure !== null) return { ...file, status: 1 }
  process.stdout.write(result.source)
  return file
}

/** C2-T-036: the migrated tree, and each entry of the record as a line on standard error. */
function migrateFile(path: string, display: string, bytes: Uint8Array): FileResult {
  const text = strictText(path, bytes)
  let result: MigrationResult
  try { result = migrateTree(JSON.parse(text) as unknown) }
  catch (error) { throw new CliError('ast-json-invalid', error instanceof Error ? error.message : String(error)) }
  process.stderr.write(lines(display, text, result.diagnostics))
  process.stdout.write(`${result.envelope === undefined ? encodeTree(result.document) : JSON.stringify(result.envelope)}\n`)
  return { status: 0 }
}

function upgradeSource(display: string, bytes: Uint8Array): string {
  try { return decodeUpgradeBytes(bytes) }
  catch (error) { throw new CliError('input-unreadable', `${display}: ${error instanceof Error ? error.message : String(error)}`) }
}

/** The upgrade command of the reference engine (C2-T-003, UPGRADING.md). */
function upgradeFile(path: string, display: string, bytes: Uint8Array, args: ParsedArgs): FileResult {
  const result = upgrade(upgradeSource(display, bytes))
  const blocked = !canWriteUpgrade(result)
  if (blocked && args.values['force'] === true && args.values['check'] !== true) {
    process.stderr.write('carve[upgrade-force-ignored]: --force cannot override the HTML check\n')
  }
  if (args.values['write'] === true && result.changed && !blocked) writeOut(path, result.output)
  else if (args.values['write'] !== true && args.values['check'] !== true && args.values['json'] !== true) process.stdout.write(result.output)
  if (args.values['json'] !== true) for (const entry of result.records) process.stderr.write(`${formatRecord(display, entry)}\n`)
  return { status: needsAttention(result) || (args.values['check'] === true && result.changed) ? 1 : 0,
    diagnostics: { file: display, changed: result.changed, check: result.check, records: result.records } }
}

function executeFile(path: string, args: ParsedArgs): FileResult {
  const bytes = readBytes(path)
  const display = nameOf(path)
  switch (args.command) {
    case 'render': return renderFile(path, display, bytes, args)
    case 'ast': return astFile(path, display, bytes, args)
    case 'fmt': return fmtFile(path, display, bytes, args)
    case 'diagnostics': return diagnosticsFile(path, display, bytes, args)
    case 'lint': return lintFile(path, display, bytes, args)
    case 'upgrade': return upgradeFile(path, display, bytes, args)
    case 'migrate-ast': return migrateFile(path, display, bytes)
    case 'import': return importFile(display, bytes, args)
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
  if (rawHtmlEscaped) process.stderr.write('carve2: raw HTML escaped; pass --raw-html to allow it\n')
  if (args.command === 'upgrade') {
    process.stderr.write('U-079 report: review host render options; rawHtml is off by default (pass --raw-html to keep raw HTML).\n')
    process.stderr.write(`read with the 0.1 engine ${ENGINE_01_VERSION}\n`)
  }
  if (args.values['json'] !== true) return
  const output = args.command === 'upgrade' ? { engine01: ENGINE_01_VERSION, files: collected.diagnostics } : { files: collected.diagnostics }
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`)
}

/** C2-T-011, C2-T-017: the files in order; a failure of status 2 stops the run, one of status 1 ends its file. */
export function run(args: ParsedArgs): number {
  const files = args.files.length === 0 ? ['-'] : args.files
  includedTexts.clear()
  rawHtmlEscaped = false
  const collected: Collected = { diagnostics: [], losses: [], includes: [] }
  let status = 0
  for (const file of files) {
    let result: FileResult
    try { result = executeFile(file, args) }
    catch (error) {
      if (!(error instanceof FileFailure)) throw error
      process.stderr.write(`carve[${error.category}]: ${error.message}\n`)
      result = error.result
    }
    collect(collected, result)
    status = Math.max(status, result.status)
  }
  finishRun(args, collected)
  return status
}
