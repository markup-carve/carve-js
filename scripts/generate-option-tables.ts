// Writes src/option-tables.ts from data/options.json and the render-loss codes of data/lint-rules.json.
//   node scripts/generate-option-tables.ts
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { wrapJson } from './wrap-literal.ts'

interface RuleRow {
  id: string
  channel: string
  status: string
}

interface OptionRow {
  name: string
  kind: string
  type: string
  values?: string[]
  maximum?: number
  default: unknown
}

/** The text of src/option-tables.ts for the options in `json`. */
export function generateOptionTables(json: string): string {
  const rows = (JSON.parse(json) as { options: OptionRow[] }).options
  const row = (name: string): OptionRow => rows.find((option) => option.name === name)!
  const enums = rows.filter((option) => option.type === 'enum')
  const booleans = rows.filter((option) => option.type === 'boolean')
  const nullable = rows.filter((option) => option.default === null).map((option) => option.name)
  const counts = rows.filter((option) => option.type === 'count')
  const rules = (JSON.parse(readFileSync(join(import.meta.dirname, '../data/lint-rules.json'), 'utf8')) as { rules: RuleRow[] }).rules
  const losses = rules.filter((rule) => rule.channel === 'render-loss' && rule.status !== 'obsolete' && rule.status !== 'void')
  const lines = [
    '// Generated from data/options.json by scripts/generate-option-tables.ts. Do not edit.',
    '',
    '/** C2-H-137: the options, and the stage that reads each. */',
    'export const OPTION_KINDS: ReadonlyMap<string, string> = new Map([',
    ...rows.map((option) => `  [${JSON.stringify(option.name)}, ${JSON.stringify(option.kind)}],`),
    '])',
    '',
    '/** C2-H-137: the declared type of each option, checked before anything else is read of it. */',
    'export const OPTION_TYPES: ReadonlyMap<string, string> = new Map([',
    ...rows.map((option) => `  [${JSON.stringify(option.name)}, ${JSON.stringify(option.type)}],`),
    '])',
    '',
    '/** The options whose default is null, which take null as that default. */',
    ...wrapJson('export const NULL_DEFAULTS: readonly string[] = ', nullable),
    '',
    'export const ENUM_VALUES: ReadonlyMap<string, readonly string[]> = new Map([',
    ...enums.flatMap((option) => wrapJson(`[${JSON.stringify(option.name)}, `, option.values!, '],', '  ')),
    '])',
    '',
    'export const ENUM_DEFAULTS: ReadonlyMap<string, string> = new Map([',
    ...enums.map((option) => `  [${JSON.stringify(option.name)}, ${JSON.stringify(option.default)}],`),
    '])',
    '',
    'export const BOOLEAN_DEFAULTS: ReadonlyMap<string, boolean> = new Map([',
    ...booleans.map((option) => `  [${JSON.stringify(option.name)}, ${JSON.stringify(option.default)}],`),
    '])',
    '',
    'export const COUNT_DEFAULTS: ReadonlyMap<string, number> = new Map([',
    ...counts.map((option) => `  [${JSON.stringify(option.name)}, ${JSON.stringify(option.default)}],`),
    '])',
    '',
    '/** The largest value of each count option that has one; a larger value is refused. */',
    'export const COUNT_MAXIMA: ReadonlyMap<string, number> = new Map([',
    ...counts.filter((option) => option.maximum !== undefined)
      .map((option) => `  [${JSON.stringify(option.name)}, ${JSON.stringify(option.maximum)}],`),
    '])',
    '',
    '/** C2-H-204: the codes of the render-loss channel, the values `allowLosses` takes. */',
    ...wrapJson('export const RENDER_LOSS_CODES: readonly string[] = ', losses.map((rule) => rule.id)),
    '',
    '/** C2-H-125: the English strings the engine writes itself. */',
    `export const DEFAULT_LABELS: Readonly<Record<string, string>> = ${JSON.stringify(row('labels').default, null, 2)}`,
    '',
    '/** C2-H-128: the schemes the default URL policy denies. */',
    ...wrapJson('export const DEFAULT_DENIED_SCHEMES: readonly string[] = ', (row('urlPolicy').default as { deny: string[] }).deny),
    '',
  ]
  return lines.join('\n')
}

if (process.argv[1] === import.meta.filename) {
  const root = join(import.meta.dirname, '..')
  const text = generateOptionTables(readFileSync(join(root, 'data/options.json'), 'utf8'))
  writeFileSync(join(root, 'src/option-tables.ts'), text)
}
