import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

interface RuleRow {
  id: string
  severity: string
  channel?: string
  status: string
  default?: string
  messages?: string[]
}

function messageLines(value: string): string[] {
  const chunks: string[] = []
  for (let at = 0; at < value.length; at += 68) chunks.push(JSON.stringify(value.slice(at, at + 68)))
  if (chunks.length === 0) chunks.push('""')
  return chunks.length === 1 ? [`    ${chunks[0]},`] : [
    '    [', ...chunks.map((chunk) => `      ${chunk},`), "    ].join(''),",
  ]
}

/** C2-W-106: generate the catalog from the sole copied specification table. */
export function generateCatalog(json: string): string {
  const rows = (JSON.parse(json) as { rules: RuleRow[] }).rules.filter((row) =>
    row.channel === 'lint' && row.messages !== undefined)
  const lines = ['// C2-W-106: generated from data/lint-rules.json by lint/generate-catalog.ts. Do not edit.',
    'export const CATALOG = {']
  for (const row of rows) {
    lines.push(`  ${JSON.stringify(row.id)}: { severity: ${JSON.stringify(row.severity)}, ` +
      `default: ${row.default === undefined ? 'undefined' : JSON.stringify(row.default)}, messages: [`)
    for (const message of row.messages ?? []) lines.push(...messageLines(message))
    lines.push('  ] },')
  }
  lines.push('} as const', '', 'export type RuleId = keyof typeof CATALOG', '')
  return lines.join('\n')
}

if (process.argv[1] === import.meta.filename) {
  const root = join(import.meta.dirname, '..')
  const source = readFileSync(join(root, 'data/lint-rules.json'), 'utf8')
  writeFileSync(join(import.meta.dirname, 'catalog.ts'), generateCatalog(source))
}
