import { readFileSync, writeFileSync } from 'node:fs'
import { decodeTree, encodeEnvelope, encodeTree, format, parse, parseWithDiagnostics, render, type Diagnostic,
  type DocumentNode, type FormatOptions, type RenderOptions, write } from '../src/index.ts'
import { ENGINE_01_VERSION, formatRecord, needsAttention, upgrade } from '../../upgrade/src/index.ts'
import { type ParsedArgs } from './flags.ts'

export class CliError extends Error {
  readonly category: 'usage' | 'input-unreadable' | 'ast-json-invalid'
  constructor(category: 'usage' | 'input-unreadable' | 'ast-json-invalid', message: string) {
    super(message)
    this.category = category
  }
}

function camel(name: string): string { return name.replaceAll(/-([a-z])/g, (_match, letter: string) => letter.toUpperCase()) }

function options(args: ParsedArgs, names: readonly string[]): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const name of names) if (args.values[name] !== undefined) result[camel(name)] = args.values[name]
  return result
}

function read(path: string): string {
  try {
    const bytes = path === '-' ? readFileSync(0) : readFileSync(path)
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch (error) { throw new CliError('input-unreadable', `${path === '-' ? '<stdin>' : path}: ${String(error)}`) }
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

function hasRawHtml(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false
  if (Array.isArray(value)) return value.some(hasRawHtml)
  const record: Record<string, unknown> = Object.fromEntries(Object.entries(value))
  if ((record['type'] === 'raw_block' || record['type'] === 'raw_inline') && record['format'] === 'html') return true
  return Object.values(record).some(hasRawHtml)
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

function renderOne(source: string, args: ParsedArgs): { html: string, escapedRawHtml: boolean } {
  const names = ['heading-ids', 'mode', 'profile', 'raw-html', 'roundtrip', 'sections', 'smart-typography',
    'source-lines', 'strict-losses', 'labels', 'symbols', 'social', 'url-policy', 'renderers', 'extensions', 'includes']
  const settings = options(args, names) as RenderOptions
  const input = args.values['from-ast'] === true ? ast(source) : source
  const escapedRawHtml = args.values['raw-html'] !== true && hasRawHtml(typeof input === 'string' ? parse(input) : input)
  return { html: render(input, settings), escapedRawHtml }
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
  return diagnostics.filter((entry) => entry.channel === 'parse').map((entry) => {
    const place = location(source, entry)
    return `${path}:${place.line}:${place.column}: ${entry.severity} ${entry.code} ${entry.message}\n`
  }).join('')
}

function upgradeOne(path: string, source: string, args: ParsedArgs): { status: number, record: object } {
  const result = upgrade(source)
  const blocked = result.check === 'mismatch' && args.values['force'] !== true
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

function executeFile(path: string, args: ParsedArgs): { status: number, record?: object, escapedRawHtml?: boolean } {
  const source = read(path)
  const display = path === '-' ? '<stdin>' : path
  switch (args.command) {
    case 'render': {
      const result = renderOne(source, args)
      process.stdout.write(`${result.html}\n`)
      return { status: 0, escapedRawHtml: result.escapedRawHtml }
    }
    case 'ast': {
      const tree = parse(source, { positions: args.values['positions'] !== false })
      process.stdout.write(`${args.values['envelope'] === true ? encodeEnvelope(tree) : encodeTree(tree)}\n`)
      return { status: 0 }
    }
    case 'fmt': return { status: formatFile(path, display, source, args) }
    case 'diagnostics': {
      const entries = parseWithDiagnostics(source).diagnostics.filter((entry) => entry.channel === 'parse')
      if (args.values['json'] === true) return { status: 0, record: { file: display, diagnostics: entries.map((entry) => ({
        ...entry, file: display, ...location(source, entry),
      })) } }
      process.stdout.write(diagnosticLines(display, source, entries))
      return { status: 0 }
    }
    case 'upgrade': {
      const result = upgradeOne(display, source, args)
      return { status: result.status, record: result.record }
    }
  }
}

export function run(args: ParsedArgs): number {
  const files = args.files.length === 0 ? ['-'] : args.files
  if (args.values['write'] === true && files.includes('-')) throw new CliError('usage', 'cannot write standard input in place')
  const records: object[] = []
  let status = 0
  let escapedRawHtml = false
  for (const file of files) {
    const result = executeFile(file, args)
    status = Math.max(status, result.status)
    escapedRawHtml ||= result.escapedRawHtml === true
    if (result.record !== undefined) records.push(result.record)
  }
  if (escapedRawHtml) process.stderr.write('carve2: raw HTML escaped; pass --raw-html to allow it\n')
  if (args.command === 'upgrade') {
    process.stderr.write('U-079 report: review host render options; rawHtml is off by default (pass --raw-html to keep raw HTML).\n')
    process.stderr.write(`read with the 0.1 engine ${ENGINE_01_VERSION}\n`)
  }
  if (args.values['json'] === true) {
    const result = args.command === 'upgrade' ? { engine01: ENGINE_01_VERSION, files: records } : { files: records }
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
  }
  return status
}
