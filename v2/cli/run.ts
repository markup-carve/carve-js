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
import { type ParsedArgs } from './flags.ts'
import { cliIncludes } from './include-fs.ts'
import { lint } from '../lint/lint.ts'
import { CATALOG } from '../lint/catalog.ts'
import { type IncludeConfig } from '../src/include-settings.ts'

export class CliError extends Error {
  readonly category: 'usage' | 'input-unreadable' | 'ast-json-invalid' | 'import-input-invalid' | 'import-tree-invalid'
  constructor(category: 'usage' | 'input-unreadable' | 'ast-json-invalid' | 'import-input-invalid' | 'import-tree-invalid',
    message: string) {
    super(message)
    this.category = category
  }
}

export interface CliFailure { category: string, status: 1 | 2 }

/** C2-W-101, C2-W-134: give each public engine error a command line category. */
export function classifyCliError(error: unknown): CliFailure {
  if (error instanceof CliError) return { category: error.category, status: error.category === 'import-tree-invalid' ? 1 : 2 }
  if (error instanceof CarveOptionError) return { category: 'usage', status: 2 }
  if (error instanceof CarveInputError) return { category: 'input-invalid', status: 2 }
  if (error instanceof CarveTreeError || error instanceof CarveLayoutError) {
    return { category: 'ast-json-invalid', status: 2 }
  }
  if (error instanceof CarveWriteError) return { category: 'writer-refused', status: 1 }
  if (error instanceof CarveRenderError) return { category: 'render-loss', status: 1 }
  return { category: 'usage', status: 2 }
}

function camel(name: string): string { return name.replaceAll(/-([a-z])/g, (_match, letter: string) => letter.toUpperCase()) }

function options(args: ParsedArgs, names: readonly string[]): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const name of names) if (args.values[name] !== undefined) result[camel(name)] = args.values[name]
  return result
}

function readBytes(path: string): Uint8Array {
  try { return path === '-' ? readFileSync(0) : readFileSync(path) }
  catch (error) { throw new CliError('input-unreadable', `${path === '-' ? '<stdin>' : path}: ${String(error)}`) }
}

/** C2-B-218: a Carve source is never refused for its encoding; a tree in JSON is read as strict UTF-8. */
function decode(path: string, bytes: Uint8Array, command: string): string {
  try {
    if (command === 'upgrade') return decodeUpgradeBytes(bytes)
    return new TextDecoder('utf-8', { fatal: command === 'migrate-ast', ignoreBOM: true }).decode(bytes)
  }
  catch (error) { throw new CliError('input-unreadable', `${path === '-' ? '<stdin>' : path}: ${String(error)}`) }
}

function writeFile(path: string, source: string): void {
  if (path === '-') throw new CliError('usage', 'cannot write standard input in place')
  try { writeFileSync(path, Buffer.from(source, 'utf8')) }
  catch (error) { throw new CliError('input-unreadable', `${path}: ${String(error)}`) }
}

function ast(text: string): DocumentNode {
  try { return decodeTree(text) }
  catch (error) { throw new CliError('ast-json-invalid', String(error)) }
}

/** C2-A-012, C2-A-180: an envelope stays an envelope, and each loss the migration reports is printed. */
function migrateAst(text: string): string {
  let result: MigrationResult
  try { result = migrateTree(JSON.parse(text) as unknown) }
  catch (error) { throw new CliError('ast-json-invalid', String(error)) }
  for (const diagnostic of result.diagnostics) {
    process.stderr.write(`carve[${diagnostic.code}]: ${diagnostic.path ?? ''}: ${diagnostic.message}\n`)
  }
  return result.envelope === undefined ? encodeTree(result.document) : JSON.stringify(result.envelope)
}

function importSource(text: string, path: string, args: ParsedArgs): number {
  try {
    const result = importDocument(text, { from: args.values['from'] as Format, rawHtml: args.values['raw-html'] === true })
    if (writerHasLoss(result.diagnostics)) throw new CarveWriteError(result.diagnostics)
    for (const entry of result.diagnostics) process.stderr.write(`carve[${entry.code}]: ${entry.message}\n`)
    if (args.values['report'] !== undefined) report(args.values['report'], {
      file: path, from: args.values['from'], diagnostics: result.diagnostics,
    })
    process.stdout.write(result.source)
    return args.values['check-loss'] === true && result.diagnostics.some((entry) => entry.channel === 'render-loss') ? 1 : 0
  } catch (error) {
    if (error instanceof ImportInputError) throw new CliError('import-input-invalid', error.message)
    if (error instanceof CarveTreeError) throw new CliError('import-tree-invalid', error.message)
    throw error
  }
}

function report(destination: unknown, value: unknown): void {
  if (typeof destination !== 'string') return
  const json = `${JSON.stringify(value, null, 2)}\n`
  if (destination === '-') { process.stderr.write(json); return }
  try { writeFileSync(destination, json) }
  catch (error) { throw new CliError('input-unreadable', `${destination}: ${String(error)}`) }
}

function reportIncludes(args: ParsedArgs, path: string, document: DocumentNode): void {
  if (args.values['report-includes'] === undefined) return
  return void includeReports.push({ file: path, dependencies: includeDependencies(document) })
}
const includeReports: object[] = []

function lintRules(args: ParsedArgs): Record<string, 'on' | 'off'> {
  const result: Record<string, 'on' | 'off'> = {}
  for (const [flag, state] of [['rule', 'on'], ['ignore', 'off']] as const) {
    for (const id of (args.values[flag] as string[] | undefined) ?? []) {
      if (!Object.hasOwn(CATALOG, id)) throw new CliError('usage', `unknown rule ${id}`)
      result[id] = state
    }
  }
  return result
}

function lintPlatforms(args: ParsedArgs): 'github'[] {
  const names = (args.values['platform'] as string[] | undefined) ?? []
  for (const name of names) if (name !== 'github') throw new CliError('usage', `unknown platform ${name}`)
  return names as 'github'[]
}

const RENDER_LOSS_CODES = new Set([
  'carrier-attribute-dropped', 'destination-denied', 'extension-fallback-rendered', 'extension-renderer-failed',
  'extension-transform-failed', 'include-expanded-roundtrip', 'include-unresolved', 'profile-construct-degraded',
  'raw-format-dropped', 'field-unspellable', 'structure-unspellable', 'writer-refused',
])

function allowedLosses(args: ParsedArgs): ReadonlySet<string> {
  const names = (args.values['allow-loss'] as string[] | undefined) ?? []
  for (const name of names) if (!RENDER_LOSS_CODES.has(name)) throw new CliError('usage', `unknown loss code ${name}`)
  return new Set(names)
}

function lossLimit(args: ParsedArgs): number {
  const raw = args.values['max-render-losses']
  if (raw === undefined) return 100
  const count = Number(raw)
  if (!Number.isSafeInteger(count) || count < 0 || !/^\d+$/.test(String(raw))) {
    throw new CliError('usage', '--max-render-losses must be a non-negative safe integer')
  }
  return count
}

function hasRawHtml(document: DocumentNode): boolean {
  const pending: Node[] = [document]
  while (pending.length > 0) {
    const node = pending.pop()
    if (node === undefined) continue
    if ((node.type === 'raw_block' || node.type === 'raw_inline') && node.format === 'html') return true
    forEachSlot(node, (nodes) => { for (const child of nodes) pending.push(child) })
  }
  return false
}

function firstChange(before: string, after: string): { line: number, oldLine: string, newLine: string } {
  const oldLines = before.split('\n')
  const newLines = after.split('\n')
  let at = 0
  while (at < oldLines.length && oldLines[at] === newLines[at]) at++
  return { line: at + 1, oldLine: oldLines[at] ?? '', newLine: newLines[at] ?? '' }
}

function unified(path: string, before: string, after: string): string {
  const left = before.split('\n')
  const right = after.split('\n')
  if (before.endsWith('\n')) left.pop()
  if (after.endsWith('\n')) right.pop()
  return [`--- a/${path}`, `+++ b/${path}`, `@@ -1,${left.length} +1,${right.length} @@`,
    ...left.map((line) => `-${line}`), ...right.map((line) => `+${line}`), ''].join('\n')
}

/** C2-N-004: the includes of an entry, unless `--no-includes` turns expansion off. */
function includesOf(path: string, args: ParsedArgs): { includes?: IncludeConfig } {
  if (args.values['includes'] === false) return {}
  const root = args.values['include-root']
  let config: IncludeConfig | null
  try { config = cliIncludes(path, typeof root === 'string' ? root : undefined) }
  catch (error) { throw new CliError('usage', `the include root cannot be read: ${String(error)}`) }
  return config === null ? {} : { includes: config }
}

function renderOne(source: string, path: string, args: ParsedArgs): {
  html: string, escapedRawHtml: boolean, status: number, losses: Diagnostic[], suppressed: number
} {
  const names = ['heading-ids', 'mode', 'profile', 'raw-html', 'roundtrip', 'sections', 'smart-typography',
    'source-lines', 'strict-losses', 'labels', 'symbols', 'social', 'url-policy', 'renderers', 'extensions']
  const fromAst = args.values['from-ast'] === true
  const settings = { ...options(args, names), ...(fromAst ? {} : includesOf(path, args)) } as RenderOptions
  const input = fromAst ? ast(source) : source
  const escapedRawHtml = args.values['raw-html'] !== true && hasRawHtml(typeof input === 'string' ? parse(input) : input)
  // The gate of --strict-losses is applied here, so that --allow-loss can exempt codes from it, as in 0.1.
  const result = renderWithDiagnostics(input, { ...settings, strictLosses: false })
  const losses = result.diagnostics.filter((entry) => entry.channel === 'render-loss')
  const allowed = allowedLosses(args)
  lossLimit(args)
  if (args.values['report-includes'] !== undefined) {
    const document = fromAst ? input as DocumentNode : parseWithDiagnostics(source, includesOf(path, args)).document
    reportIncludes(args, path === '-' ? '<stdin>' : path, document)
  }
  const refused = losses.filter((entry) => !allowed.has(entry.code))
  if (settings.strictLosses === true && refused.length > 0) throw new CarveRenderError(refused)
  return { html: result.html, escapedRawHtml, status: 0, losses, suppressed: result.suppressedIncludeDiagnostics ?? 0 }
}

function formatOne(source: string, args: ParsedArgs): string {
  const settings = options(args, ['normalize', 'align-tables']) as FormatOptions
  return args.values['from-ast'] === true ? write(ast(source), { alignTables: settings.alignTables === true }) : format(source, settings)
}

function location(source: string, diagnostic: Diagnostic): { line: number, column: number } {
  const offset = diagnostic.range?.startOffset ?? 0
  const prefix = Buffer.from(source, 'utf8').subarray(0, offset).toString('utf8')
  const lines = prefix.split('\n')
  return { line: lines.length, column: Array.from(lines[lines.length - 1] ?? '').length + 1 }
}

function diagnosticLines(path: string, source: string, diagnostics: readonly Diagnostic[]): string {
  return diagnostics.map((entry) => {
    const place = location(source, entry)
    return `${entry.file ?? path}:${place.line}:${place.column}: ${entry.severity} ${entry.code} ${entry.message}\n`
  }).join('')
}

function upgradeOne(path: string, source: string, args: ParsedArgs): { status: number, record: object } {
  const result = upgrade(source)
  const blocked = !canWriteUpgrade(result)
  if (blocked && args.values['force'] === true && args.values['check'] !== true) {
    process.stderr.write('carve[upgrade-force-ignored]: --force cannot override the HTML check\n')
  }
  if (args.values['write'] === true && result.changed && !blocked) writeFile(path, result.output)
  else if (args.values['write'] !== true && args.values['check'] !== true && args.values['json'] !== true) process.stdout.write(result.output)
  if (args.values['json'] !== true) for (const entry of result.records) process.stderr.write(`${formatRecord(path, entry)}\n`)
  return { status: needsAttention(result) || (args.values['check'] === true && result.changed) ? 1 : 0,
    record: { file: path, changed: result.changed, check: result.check, records: result.records } }
}

function formatFile(path: string, display: string, source: string, args: ParsedArgs): number {
  const output = formatOne(source, args)
  const changed = source !== output
  if (args.values['check'] === true && changed && args.values['diff'] !== true) {
    const change = firstChange(source, output)
    process.stdout.write(`${display}:${change.line}\n- ${change.oldLine}\n+ ${change.newLine}\n`)
  }
  if (args.values['diff'] === true && changed) process.stdout.write(unified(display, source, output))
  if (args.values['write'] === true && changed) writeFile(path, output)
  if (args.values['check'] !== true && args.values['diff'] !== true && args.values['write'] !== true) process.stdout.write(output)
  return (args.values['check'] === true || args.values['diff'] === true) && changed ? 1 : 0
}

interface FileResult {
  status: number
  record?: object
  escapedRawHtml?: boolean
  suppressed?: number
  losses?: Diagnostic[]
}

function located(display: string, source: string, entries: readonly Diagnostic[]): object[] {
  return entries.map((entry) => ({ ...entry, file: entry.file ?? display, ...location(source, entry) }))
}

function diagnosticsFile(path: string, display: string, source: string, bytes: Uint8Array, args: ParsedArgs): FileResult {
  const result = parseWithDiagnostics(bytes, includesOf(path, args))
  const entries = result.diagnostics.filter((entry) => entry.channel === 'parse')
  const suppressed = result.suppressedIncludeDiagnostics ?? 0
  reportIncludes(args, display, result.document)
  if (args.values['json'] === true) {
    const diagnostics = located(display, source, entries)
    return { status: 0, suppressed, record: { file: display, suppressedIncludeDiagnostics: suppressed, diagnostics } }
  }
  process.stdout.write(diagnosticLines(display, source, entries))
  return { status: 0, suppressed }
}

/** As in 0.1, any finding makes lint exit 1. */
function lintFile(path: string, display: string, source: string, args: ParsedArgs): FileResult {
  const entries = lint(source, { rules: lintRules(args), platforms: lintPlatforms(args), ...includesOf(path, args) })
  const status = entries.length > 0 ? 1 : 0
  if (args.values['json'] === true) return { status, record: { file: display, diagnostics: located(display, source, entries) } }
  process.stdout.write(diagnosticLines(display, source, entries))
  return { status }
}

function executeFile(path: string, args: ParsedArgs): FileResult {
  const bytes = readBytes(path)
  const source = decode(path, bytes, args.command)
  const display = path === '-' ? '<stdin>' : path
  switch (args.command) {
    case 'render': {
      const result = renderOne(source, path, args)
      process.stdout.write(`${result.html}\n`)
      return { status: result.status, escapedRawHtml: result.escapedRawHtml, suppressed: result.suppressed, losses: result.losses }
    }
    case 'ast': {
      const tree = parse(bytes, { positions: args.values['positions'] !== false, ...includesOf(path, args) })
      reportIncludes(args, display, tree)
      process.stdout.write(`${args.values['envelope'] === true ? encodeEnvelope(tree) : encodeTree(tree)}\n`)
      return { status: 0 }
    }
    case 'fmt': return { status: formatFile(path, display, source, args) }
    case 'diagnostics': return diagnosticsFile(path, display, source, bytes, args)
    case 'lint': return lintFile(path, display, source, args)
    case 'upgrade': {
      const result = upgradeOne(display, source, args)
      return { status: result.status, record: result.record }
    }
    case 'migrate-ast': {
      process.stdout.write(`${migrateAst(source)}\n`)
      return { status: 0 }
    }
    case 'import': {
      return { status: importSource(source, display, args) }
    }
  }
}

function processFiles(files: string[], args: ParsedArgs): {
  status: number, records: object[], escapedRawHtml: boolean, suppressed: number,
  losses: { file: string, diagnostics: Diagnostic[] }[]
} {
  const records: object[] = []
  const losses: { file: string, diagnostics: Diagnostic[] }[] = []
  let status = 0
  let escapedRawHtml = false
  let suppressed = 0
  for (const file of files) {
    const result = executeFile(file, args)
    status = Math.max(status, result.status)
    escapedRawHtml ||= result.escapedRawHtml === true
    suppressed += result.suppressed ?? 0
    if (result.losses !== undefined) losses.push({ file: file === '-' ? '<stdin>' : file, diagnostics: result.losses })
    if (result.record !== undefined) records.push(result.record)
  }
  return { status, records, escapedRawHtml, suppressed, losses }
}

/** As in 0.1, the report keeps at most `--max-render-losses` rows of each file and still carries the whole total. */
function lossReport(args: ParsedArgs, files: readonly { file: string, diagnostics: Diagnostic[] }[]): object[] {
  const limit = lossLimit(args)
  return files.map((entry) => ({ file: entry.file, total: entry.diagnostics.length, diagnostics: entry.diagnostics.slice(0, limit) }))
}

function finishRun(args: ParsedArgs, result: ReturnType<typeof processFiles>): void {
  if (result.suppressed > 0 && (args.command === 'render' || args.command === 'diagnostics')) {
    process.stderr.write(`carve2: ${result.suppressed} include diagnostics suppressed\n`)
  }
  if (args.values['report-includes'] !== undefined) report(args.values['report-includes'], includeReports)
  if (args.values['report-losses'] !== undefined) report(args.values['report-losses'], lossReport(args, result.losses))
  if (result.escapedRawHtml) process.stderr.write('carve2: raw HTML escaped; pass --raw-html to allow it\n')
  if (args.command === 'upgrade') {
    process.stderr.write('U-079 report: review host render options; rawHtml is off by default (pass --raw-html to keep raw HTML).\n')
    process.stderr.write(`read with the 0.1 engine ${ENGINE_01_VERSION}\n`)
  }
  if (args.values['json'] === true) {
    const output = args.command === 'upgrade' ? { engine01: ENGINE_01_VERSION, files: result.records } : { files: result.records }
    process.stdout.write(`${JSON.stringify(output, null, 2)}\n`)
  }
}

export function run(args: ParsedArgs): number {
  const files = args.files.length === 0 ? ['-'] : args.files
  if (args.values['write'] === true && files.includes('-')) throw new CliError('usage', 'cannot write standard input in place')
  includeReports.length = 0
  const result = processFiles(files, args)
  finishRun(args, result)
  return result.status
}
