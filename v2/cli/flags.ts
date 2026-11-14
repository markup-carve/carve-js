export type Command = 'render' | 'ast' | 'fmt' | 'diagnostics' | 'upgrade'
export type ValueKind = 'boolean' | 'enum' | 'json'
export interface Flag {
  name: string
  commands: readonly Command[]
  kind: ValueKind
  values?: readonly string[]
  description: string
}

const render = ['render'] as const
const fmt = ['fmt'] as const
const ast = ['ast'] as const
const upgrade = ['upgrade'] as const

// C2-H-137, C2-W-100: the option table drives both parsing and help.
export const FLAGS: readonly Flag[] = [
  { name: 'heading-ids', commands: render, kind: 'enum', values: ['off', 'keep-case', 'lower', 'ascii'], description: 'Heading ID policy' },
  { name: 'mode', commands: render, kind: 'enum', values: ['interactive', 'static'], description: 'HTML mode' },
  { name: 'profile', commands: render, kind: 'enum', values: ['full', 'article', 'comment', 'minimal'], description: 'Render profile' },
  { name: 'raw-html', commands: render, kind: 'boolean', description: 'Allow raw HTML' },
  { name: 'roundtrip', commands: render, kind: 'boolean', description: 'Keep roundtrip carriers' },
  { name: 'sections', commands: render, kind: 'boolean', description: 'Wrap headings in sections' },
  { name: 'smart-typography', commands: render, kind: 'boolean', description: 'Apply smart typography' },
  { name: 'source-lines', commands: render, kind: 'boolean', description: 'Add source line attributes' },
  { name: 'strict-losses', commands: render, kind: 'boolean', description: 'Refuse render losses' },
  { name: 'labels', commands: render, kind: 'json', description: 'Label map as JSON' },
  { name: 'symbols', commands: render, kind: 'json', description: 'Symbol map as JSON' },
  { name: 'social', commands: render, kind: 'json', description: 'Social URL templates as JSON' },
  { name: 'url-policy', commands: render, kind: 'json', description: 'URL policy as JSON' },
  { name: 'renderers', commands: render, kind: 'json', description: 'Renderer map as JSON' },
  { name: 'extensions', commands: render, kind: 'json', description: 'Extension list as JSON' },
  { name: 'includes', commands: render, kind: 'json', description: 'Include configuration as JSON' },
  { name: 'from-ast', commands: ['render', 'fmt'], kind: 'boolean', description: 'Read AST JSON' },
  { name: 'positions', commands: ast, kind: 'boolean', description: 'Include source positions' },
  { name: 'envelope', commands: ast, kind: 'boolean', description: 'Wrap the tree in an envelope' },
  { name: 'check', commands: ['fmt', 'upgrade'], kind: 'boolean', description: 'Check without writing' },
  { name: 'diff', commands: fmt, kind: 'boolean', description: 'Print a unified diff' },
  { name: 'normalize', commands: fmt, kind: 'boolean', description: 'Normalize source spelling' },
  { name: 'align-tables', commands: fmt, kind: 'boolean', description: 'Align pipe table cells' },
  { name: 'write', commands: ['fmt', 'upgrade'], kind: 'boolean', description: 'Write files in place (-w for fmt)' },
  { name: 'json', commands: ['diagnostics', 'upgrade'], kind: 'boolean', description: 'Print JSON' },
  { name: 'force', commands: upgrade, kind: 'boolean', description: 'Write even with an unexplained difference' },
]

export interface ParsedArgs {
  command: Command
  files: string[]
  values: Record<string, unknown>
  help: boolean
  version: boolean
}

function flagFor(command: Command, spelling: string): Flag | undefined {
  return FLAGS.find((flag) => flag.name === spelling && flag.commands.includes(command))
}

function readValue(flag: Flag, input: string): unknown {
  if (flag.kind === 'enum') {
    if (!flag.values?.includes(input)) throw new Error(`bad value for --${flag.name}: ${input}`)
    return input
  }
  try { return JSON.parse(input) as unknown } catch { throw new Error(`bad JSON for --${flag.name}`) }
}

function booleanOption(flag: Flag, negated: boolean, equals: number, parsed: ParsedArgs): boolean {
  if (flag.kind !== 'boolean') return false
  if (equals >= 0) throw new Error(`bad value for --${flag.name}`)
  parsed.values[flag.name] = !negated
  return true
}

function option(args: readonly string[], index: number, parsed: ParsedArgs): number {
  const arg = args[index] ?? ''
  if (arg === '-w' && (parsed.command === 'fmt' || parsed.command === 'upgrade')) { parsed.values['write'] = true; return index }
  if (!arg.startsWith('--')) throw new Error(`unknown option ${arg}`)
  const equals = arg.indexOf('=')
  const name = arg.slice(2, equals < 0 ? undefined : equals)
  const negated = name.startsWith('no-')
  const flag = flagFor(parsed.command, negated ? name.slice(3) : name)
  if (flag === undefined) throw new Error(`unknown option --${name}`)
  if (booleanOption(flag, negated, equals, parsed)) return index
  if (negated) throw new Error(`unknown option --${name}`)
  const value = equals >= 0 ? arg.slice(equals + 1) : args[index + 1]
  if (value === undefined) throw new Error(`missing value for --${name}`)
  parsed.values[flag.name] = readValue(flag, value)
  return equals >= 0 ? index : index + 1
}

function commandAt(arg: string | undefined): Command | undefined {
  if (arg === 'render' || arg === 'ast' || arg === 'fmt' || arg === 'diagnostics' || arg === 'upgrade') return arg
  return undefined
}

function checkCombinations(parsed: ParsedArgs): void {
  if (parsed.values['write'] === true && parsed.values['check'] === true) throw new Error('--write and --check cannot be combined')
  if (parsed.values['write'] === true && parsed.values['diff'] === true) throw new Error('--write and --diff cannot be combined')
  if (parsed.values['from-ast'] === true && parsed.values['normalize'] === true) throw new Error('--normalize needs source input')
}

export function parseArgs(args: readonly string[]): ParsedArgs {
  const command = commandAt(args[0]) ?? 'render'
  const start = commandAt(args[0]) === undefined ? 0 : 1
  const parsed: ParsedArgs = { command, files: [], values: {}, help: false, version: false }
  for (let index = start; index < args.length; index++) {
    const arg = args[index] ?? ''
    if (arg === '--help') { parsed.help = true; continue }
    if (arg === '--version') { parsed.version = true; continue }
    if (arg === '--') { parsed.files.push(...args.slice(index + 1)); break }
    if (arg !== '-' && arg.startsWith('-')) index = option(args, index, parsed)
    else parsed.files.push(arg)
  }
  checkCombinations(parsed)
  return parsed
}

export function help(command: Command): string {
  const lines = [`Usage: carve2 ${command} [options] [FILE...]`, '', 'Use - or omit FILE to read standard input.', '', 'Options:']
  for (const flag of FLAGS.filter((entry) => entry.commands.includes(command))) {
    const suffix = flag.kind === 'boolean' ? '' : flag.kind === 'enum' ? ` <${flag.values?.join('|')}>` : ' <json>'
    lines.push(`  --${flag.name}${suffix}  ${flag.description}`)
  }
  lines.push('  --help  Show this help', '  --version  Show version')
  return `${lines.join('\n')}\n`
}
