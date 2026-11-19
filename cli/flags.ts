// The commands and flags of spec/0.2/tooling.md, read from data/cli.json, and the engine's own (C2-T-003).
import cli from '../data/cli.json' with { type: 'json' }
import { resolve } from 'node:path'

export type Command = 'render' | 'ast' | 'fmt' | 'diagnostics' | 'upgrade' | 'migrate-ast' | 'import' | 'lint'
export type ValueKind = 'switch' | 'enum' | 'json' | 'path' | 'code' | 'count'
export interface Flag {
  name: string
  commands: readonly Command[]
  kind: ValueKind
  values?: readonly string[]
  /** The option of the library the flag sets (C2-T-010). */
  option?: string
}

export const COMMANDS: readonly Command[] = ['render', 'ast', 'fmt', 'diagnostics', 'upgrade', 'migrate-ast', 'import', 'lint']

// C2-T-003: the reference engine also imports Markdown, GFM, Djot and BBCode, and offers the upgrade command.
const EXTRA_FROM = ['markdown', 'gfm', 'djot', 'bbcode']
const UPGRADE_FLAGS: readonly Flag[] = [
  { name: 'check', commands: ['upgrade'], kind: 'switch' },
  { name: 'write', commands: ['upgrade'], kind: 'switch' },
  { name: 'json', commands: ['upgrade'], kind: 'switch' },
  { name: 'force', commands: ['upgrade'], kind: 'switch' },
]

function specified(row: (typeof cli.flags)[number]): Flag {
  const flag: Flag = { name: row.name, commands: row.commands as Command[], kind: row.kind as ValueKind }
  if ('values' in row) flag.values = row.name === 'from' ? [...row.values, ...EXTRA_FROM] : row.values
  if ('option' in row) flag.option = row.option
  return flag
}

/** C2-T-007 to C2-T-010: every flag of every command; `help` and `version` are read before the others. */
export const FLAGS: readonly Flag[] = [
  ...cli.flags.filter((row) => row.name !== 'help' && row.name !== 'version').map(specified),
  ...UPGRADE_FLAGS,
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
  if (flag.name === 'allow-loss') {
    const collected = parsed.values[flag.name] as string[] | undefined
    parsed.values[flag.name] = [...(collected ?? []), value]
  } else parsed.values[flag.name] = readValue(flag, value)
}

function option(args: readonly string[], index: number, parsed: ParsedArgs): number {
  const arg = args[index] ?? ''
  if (shortWrite(arg, parsed)) return index
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

/** C2-T-030: `-w` is `--write`. */
function shortWrite(arg: string, parsed: ParsedArgs): boolean {
  if (arg !== '-w' || (parsed.command !== 'fmt' && parsed.command !== 'upgrade')) return false
  parsed.values['write'] = true
  return true
}

function commandAt(arg: string | undefined): Command | undefined {
  return COMMANDS.find((command) => command === arg)
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

function checkCombinations(parsed: ParsedArgs, files: readonly string[]): void {
  checkFormatCombinations(parsed)
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
export function parseArgs(args: readonly string[]): ParsedArgs {
  const command = commandAt(args[0]) ?? 'render'
  const start = commandAt(args[0]) === undefined ? 0 : 1
  const parsed: ParsedArgs = { command, files: [], values: {}, help: false, version: false }
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
  lines.push('  --help', '  --version', '', `Commands: ${COMMANDS.join(', ')}`)
  return `${lines.join('\n')}\n`
}
