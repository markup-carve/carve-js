// Writes src/include-tables.ts from data/includes.json, data/limits.json and the include rows of data/lint-rules.json.
//   node v2/scripts/generate-include-tables.ts
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

interface Cause {
  rank: number
  name: string
  code: string
  stage: string
}

interface Conflict {
  name: string
  rule: string
  options: string[]
  code: string
}

interface Limit {
  name: string
  value: number
}

interface LintRule {
  id: string
  status: string
  channel?: string
  messages?: (string | { when: string, text: string })[]
}

const LIMITS = ['include_bytes', 'include_depth']

function limitValue(limits: Limit[], name: string): number {
  const row = limits.find((limit) => limit.name === name)
  if (row === undefined) throw new Error(`limits.json has no row ${name}`)
  return row.value
}

export function generateIncludeTables(includes: string, limits: string, lintRules: string): string {
  const data = JSON.parse(includes) as { causes: Cause[], conflicts: Conflict[] }
  const rows = (JSON.parse(limits) as { limits: Limit[] }).limits
  const codes = new Set(data.causes.map((cause) => cause.code))
  codes.add('include-unresolved')
  codes.add('include-heading-clamp')
  codes.add('include-expanded-roundtrip')
  const lintRows = (JSON.parse(lintRules) as { rules: LintRule[] }).rules
  const messages = lintRows
    .filter((rule) => codes.has(rule.id) && rule.status !== 'obsolete' && rule.messages !== undefined)
    .map((rule) => {
      const first = rule.messages![0]!
      return `  [${JSON.stringify(rule.id)},\n    ${JSON.stringify(typeof first === 'string' ? first : first.text)}],`
    })
  const optionMessages = lintRows.find((rule) => rule.id === 'include-option-invalid')?.messages ?? []
  const causes = [...data.causes].sort((a, b) => a.rank - b.rank)
  const lines = [
    '// Generated from data/includes.json, data/limits.json and data/lint-rules.json by',
    '// scripts/generate-include-tables.ts. Do not edit.',
    '',
    '/** C2-N-061: one failure cause, its code, and whether it is tested before, by or after the resolver. */',
    'export interface IncludeCause {',
    '  name: string',
    '  code: string',
    '  stage: string',
    '}',
    '',
    '/** C2-N-061: the causes in the order they are tested. */',
    'export const INCLUDE_CAUSES: ReadonlyMap<string, IncludeCause> = new Map([',
    ...causes.map((cause) => {
      const row = JSON.stringify({ name: cause.name, code: cause.code, stage: cause.stage })
      return `  [${JSON.stringify(cause.name)}, ${row}],`
    }),
    '])',
    '',
    '/** C2-N-024: the option combinations that keep an include from being expanded. */',
    'export interface IncludeConflict {',
    '  name: string',
    '  rule: string',
    '  options: readonly string[]',
    '}',
    '',
    'export const INCLUDE_CONFLICTS: readonly IncludeConflict[] = [',
    ...data.conflicts.map((row) => `  ${JSON.stringify({ name: row.name, rule: row.rule, options: row.options })},`),
    ']',
    '',
    ...LIMITS.map((name) => `export const ${name.toUpperCase()} = ${limitValue(rows, name)}`),
    '',
    '/** The message templates of the include codes, in which `${name}` stands for a value. */',
    'export const INCLUDE_MESSAGES: ReadonlyMap<string, string> = new Map([',
    ...messages,
    '])',
    '',
    '/** C2-B-206: one message for each invalid include option cause, in catalog order. */',
    `export const INCLUDE_OPTION_MESSAGES: readonly string[] = ${JSON.stringify(optionMessages.map((item) =>
      typeof item === 'string' ? item : item.text))}`,
    '',
  ]
  return lines.join('\n')
}

if (process.argv[1] === import.meta.filename) {
  const root = join(import.meta.dirname, '..')
  const read = (name: string): string => readFileSync(join(root, 'data', name), 'utf8')
  const text = generateIncludeTables(read('includes.json'), read('limits.json'), read('lint-rules.json'))
  writeFileSync(join(root, 'src/include-tables.ts'), text)
}
