// The commands and flags of spec/0.2/tooling.md, read from data/cli.json, and the engine's own (C2-T-003).
import cli from '../data/cli.json' with { type: 'json' }
import { resolve } from 'node:path'

export type Command = 'render' | 'ast' | 'fmt' | 'diagnostics' | 'upgrade' | 'migrate-ast' | 'import' | 'lint' | 'flatten' | 'diff'
export type ValueKind = 'switch' | 'enum' | 'json' | 'path' | 'code' | 'count'
export interface Flag {
  name: string
  commands: readonly Command[]
  kind: ValueKind
  values?: readonly string[]
  /** The option of the library the flag sets (C2-T-010). */
  option?: string
  /** Every value is collected, as for `--allow-loss` (C2-T-009). */
  repeatable?: boolean
}

export const COMMANDS: readonly (Command | 'fix')[] = ['render', 'ast', 'fmt', 'diagnostics', 'upgrade', 'migrate-ast', 'import', 'lint', 'flatten', 'fix']
/** `diff` is the engine command beyond the pinned CLI catalog. */
const ENGINE_COMMANDS: readonly Command[] = ['diff']

// C2-T-003: the reference engine also imports Markdown, GFM, Djot and BBCode, and offers the upgrade and diff commands.
const EXTRA_FROM = ['markdown', 'gfm', 'djot', 'bbcode']
// The engine's export targets of `render` (`@markup-carve/carve/export`).
const RENDER_FLAGS: readonly Flag[] = [{ name: 'to', commands: ['render'], kind: 'enum', values: ['html', 'markdown', 'plain', 'ansi'] }]
const UPGRADE_FLAGS: readonly Flag[] = [
  { name: 'check', commands: ['upgrade'], kind: 'switch' },
  { name: 'write', commands: ['upgrade'], kind: 'switch' },
  { name: 'json', commands: ['upgrade'], kind: 'switch' },
  { name: 'force', commands: ['upgrade'], kind: 'switch' },
  { name: 'migrate', commands: ['upgrade'], kind: 'switch' },
  { name: 'registered-extension', commands: ['upgrade'], kind: 'enum', values: ['wikilinks', 'samp'], repeatable: true },
  { name: 'json', commands: ['diff'], kind: 'switch' },
]
// C2-T-003: the commands and flags of the 0.1 command line that the reference engine keeps.
const ENGINE_FLAGS: readonly Flag[] = [
  { name: 'include-root', commands: ['flatten'], kind: 'path' },
  { name: 'fix', commands: ['lint'], kind: 'switch' },
  { name: 'write', commands: ['lint'], kind: 'switch' },
  { name: 'ignore', commands: ['lint'], kind: 'code', repeatable: true },
  { name: 'strict', commands: ['render', 'lint'], kind: 'switch' },
  { name: 'output', commands: ['render', 'fmt', 'import'], kind: 'path' },
  { name: 'directory', commands: ['import'], kind: 'path' },
]

function specified(row: (typeof cli.flags)[number]): Flag {
  const flag: Flag = { name: row.name, commands: row.commands as Command[], kind: row.kind as ValueKind }
  if ('values' in row) flag.values = row.name === 'from' ? [...row.values, ...EXTRA_FROM] : row.values
  if ('option' in row) flag.option = row.option
  if ('repeatable' in row && row.repeatable === true) flag.repeatable = true
  return flag
}

/** C2-T-007 to C2-T-010: every flag of every command; `help` and `version` are read before the others. */
export const FLAGS: readonly Flag[] = [
  ...cli.flags.filter((row) => row.name !== 'help' && row.name !== 'version').map(specified),
  ...RENDER_FLAGS,
  ...UPGRADE_FLAGS,
  ...ENGINE_FLAGS,
]

export interface ParsedArgs {
  command: Command
  files: string[]
  values: Record<string, unknown>
  help: boolean
  version: boolean
}

/** A command line the specification refuses: the category `usage` (C2-T-040). */
export class UsageError extends Error {}

function flagFor(command: Command, spelling: string): Flag | undefined {
  return FLAGS.find((flag) => flag.name === spelling && flag.commands.includes(command))
}

/** C2-T-010, C2-T-029: the value of a flag, refused with `usage` where it is not one the flag takes. */
function readValue(flag: Flag, input: string): unknown {
  if (flag.kind === 'path' || flag.kind === 'code') return input
  if (flag.kind === 'count') {
    if (!/^\d+$/.test(input) || !Number.isSafeInteger(Number(input))) throw new UsageError(`--${flag.name} takes a count, not ${input}`)
    return Number(input)
  }
  if (flag.kind === 'enum') {
    if (!flag.values?.includes(input)) throw new UsageError(`bad value for --${flag.name}: ${input}`)
    return input
  }
  try { return JSON.parse(input) as unknown } catch { throw new UsageError(`bad JSON for --${flag.name}`) }
}

function switchOption(flag: Flag, negated: boolean, equals: number, parsed: ParsedArgs): boolean {
  if (flag.kind !== 'switch') return false
  if (equals >= 0) throw new UsageError(`--${flag.name} takes no value`)
  parsed.values[flag.name] = !negated
  return true
}

/** C2-T-009: a flag given twice takes its last value, and `--allow-loss` collects every value. */
function setValue(parsed: ParsedArgs, flag: Flag, value: string): void {
  if (flag.repeatable === true) {
    const collected = parsed.values[flag.name] as string[] | undefined
    parsed.values[flag.name] = [...(collected ?? []), value]
  } else parsed.values[flag.name] = readValue(flag, value)
}

function option(args: readonly string[], index: number, parsed: ParsedArgs): number {
  const arg = args[index] ?? ''
  const short = shortFlag(args, index, parsed)
  if (short !== null) return short
  if (!arg.startsWith('--')) throw new UsageError(`unknown flag ${arg}`)
  const equals = arg.indexOf('=')
  const name = arg.slice(2, equals < 0 ? undefined : equals)
  const negated = name.startsWith('no-')
  const flag = flagFor(parsed.command, negated ? name.slice(3) : name) ?? flagFor(parsed.command, name)
  if (flag === undefined) throw new UsageError(`unknown flag --${name} for ${parsed.command}`)
  const turnedOff = negated && flag.name !== name
  if (switchOption(flag, turnedOff, equals, parsed)) return index
  if (turnedOff) throw new UsageError(`unknown flag --${name} for ${parsed.command}`)
  const value = equals >= 0 ? arg.slice(equals + 1) : args[index + 1]
  if (value === undefined) throw new UsageError(`missing value for --${name}`)
  setValue(parsed, flag, value)
  return equals >= 0 ? index : index + 1
}

/** C2-T-030: `-w` is `--write`; `-o FILE` is `--output FILE`. */
function shortFlag(args: readonly string[], index: number, parsed: ParsedArgs): number | null {
  const arg = args[index]
  if (arg === '-w' && flagFor(parsed.command, 'write') !== undefined) {
    parsed.values['write'] = true
    return index
  }
  if (arg !== '-o' || flagFor(parsed.command, 'output') === undefined) return null
  const value = args[index + 1]
  if (value === undefined) throw new UsageError('missing value for -o')
  parsed.values['output'] = value
  return index + 1
}

function commandAt(arg: string | undefined): Command | undefined {
  return [...COMMANDS, ...ENGINE_COMMANDS].find((command): command is Command => command !== 'fix' && command === arg)
}

/** C2-T-016, C2-T-030, C2-T-033: the combinations a command refuses. */
function checkFormatCombinations(parsed: ParsedArgs): void {
  const values = parsed.values
  if (parsed.command === 'fmt' && values['check'] === true && values['diff'] === true) {
    throw new UsageError('--check cannot be combined with --diff')
  }
  if (values['write'] === true && (values['check'] === true || values['diff'] === true) && parsed.command === 'fmt') {
    throw new UsageError('--write cannot be combined with --check or --diff')
  }
}

/** The engine flags (C2-T-003): `--write` of `lint` needs `--fix`, and `--output` takes the place of standard output. */
function checkFixCombinations(parsed: ParsedArgs): void {
  const values = parsed.values
  if (parsed.command !== 'lint') return
  if (values['write'] === true && values['fix'] !== true) throw new UsageError('--write needs --fix')
  if (values['fix'] === true && values['json'] === true && values['write'] !== true) {
    throw new UsageError('--fix writes the source on standard output; --json needs --write')
  }
}

function checkEngineCombinations(parsed: ParsedArgs): void {
  checkFixCombinations(parsed)
  const values = parsed.values
  const output = values['output']
  if (typeof output !== 'string') return
  if (parsed.command === 'fmt' && (values['write'] === true || values['check'] === true || values['diff'] === true)) {
    throw new UsageError('--output cannot be combined with --write, --check or --diff')
  }
  for (const report of ['report-losses', 'report-includes']) {
    const path = values[report]
    if (typeof path === 'string' && path !== '-' && resolve(path) === resolve(output)) throw new UsageError('--output and a report cannot write the same path')
  }
}

/** The directory import of 0.1 `migrate --from markdown --directory` (C2-T-003): a source and an output directory, no files. */
function checkDirectoryCombinations(parsed: ParsedArgs): void {
  const values = parsed.values
  if (parsed.command !== 'import' || values['directory'] === undefined) return
  if (typeof values['output'] !== 'string') throw new UsageError('--directory needs --output DIR')
  if (values['from'] !== 'gfm' && values['from'] !== 'markdown') throw new UsageError('--directory imports --from gfm or markdown')
  if (parsed.files.length > 0) throw new UsageError('--directory takes no file')
  for (const name of ['adapter', 'raw-html', 'report-losses', 'allow-loss', 'max-render-losses']) {
    if (values[name] !== undefined) throw new UsageError(`--directory cannot be combined with --${name}`)
  }
}

function checkCombinations(parsed: ParsedArgs, files: readonly string[]): void {
  checkFormatCombinations(parsed)
  checkEngineCombinations(parsed)
  checkDirectoryCombinations(parsed)
  const values = parsed.values
  if (values['from-ast'] === true && values['normalize'] === true) throw new UsageError('--normalize needs source input')
  const losses = values['report-losses']
  const includes = values['report-includes']
  if (typeof losses === 'string' && typeof includes === 'string' && losses !== '-' && includes !== '-' &&
    resolve(losses) === resolve(includes)) throw new UsageError('two reports cannot write the same path')
  if (values['write'] === true && files.includes('-')) throw new UsageError('--write cannot replace standard input')
  if (parsed.command === 'import' && values['from'] === undefined) throw new UsageError('import requires --from')
}

/** C2-T-007, C2-T-008: `carve [COMMAND] [FLAG...] [FILE...]`, `render` without a command, `--` before files only. */
/** The command of the first argument; `carve fix` is `carve lint --fix` (C2-T-003). */
function commandOf(args: readonly string[]): ParsedArgs {
  if (args[0] === 'fix') return { command: 'lint', files: [], values: { fix: true }, help: false, version: false }
  return { command: commandAt(args[0]) ?? 'render', files: [], values: {}, help: false, version: false }
}

export function parseArgs(args: readonly string[]): ParsedArgs {
  const parsed = commandOf(args)
  const start = args[0] === 'fix' || commandAt(args[0]) !== undefined ? 1 : 0
  for (let index = start; index < args.length; index++) {
    const arg = args[index] ?? ''
    if (arg === '--help') parsed.help = true
    else if (arg === '--version') parsed.version = true
    else if (arg === '--') {
      parsed.files.push(...args.slice(index + 1))
      break
    } else if (arg !== '-' && arg.startsWith('-')) index = option(args, index, parsed)
    else parsed.files.push(arg)
  }
  if (!parsed.help && !parsed.version) checkCombinations(parsed, parsed.files.length === 0 ? ['-'] : parsed.files)
  return parsed
}

function usageOf(flag: Flag): string {
  if (flag.kind === 'switch') return ''
  return flag.kind === 'enum' ? ` <${flag.values?.join('|')}>` : ` <${flag.kind}>`
}

export function help(command: Command): string {
  const lines = [`Usage: carve ${command} [FLAG...] [FILE...]`, '', 'Use - or omit FILE to read standard input.', '', 'Flags:']
  for (const flag of FLAGS.filter((entry) => entry.commands.includes(command))) lines.push(`  --${flag.name}${usageOf(flag)}`)
  lines.push('  --help', '  --version', '', `Commands: ${[...COMMANDS, ...ENGINE_COMMANDS].join(', ')}`)
  return `${lines.join('\n')}\n`
}
