import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** The line model and data rules of data/lint-model.json as a module. */
export function generateDataTables(json: string): string {
  const model = JSON.parse(json) as Record<string, unknown>
  const { text_leaves: textLeaves, verbatim_leaves: verbatimLeaves, row_leaves: rowLeaves, rules } = model
  return ['// Generated from data/lint-model.json by lint/generate-data-tables.ts. Do not edit.',
    `export const LINT_MODEL = ${JSON.stringify({ text_leaves: textLeaves, verbatim_leaves: verbatimLeaves, row_leaves: rowLeaves, rules }, null, 2)} as const`,
    ''].join('\n')
}

if (process.argv[1] === import.meta.filename) {
  const root = join(import.meta.dirname, '..')
  writeFileSync(join(import.meta.dirname, 'data-tables.ts'),
    generateDataTables(readFileSync(join(root, 'data/lint-model.json'), 'utf8')))
}
