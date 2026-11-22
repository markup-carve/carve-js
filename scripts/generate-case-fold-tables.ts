// Writes src/case-fold-tables.ts from a Unicode CaseFolding.txt: the full default case folding (status C and F) that
// the lint value `fold` applies (C2-W-150), so the fold does not depend on the runtime.
//   node scripts/generate-case-fold-tables.ts <path to CaseFolding.txt>
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** The text of src/case-fold-tables.ts for the contents of a CaseFolding.txt. */
export function generateCaseFoldTables(text: string): string {
  const version = /^# CaseFolding-([\d.]+)\.txt/m.exec(text)?.[1]
  if (version === undefined) throw new Error('CaseFolding.txt: no version line')
  const single: number[] = []
  const multiple: string[] = []
  for (const line of text.split('\n')) {
    const fields = line.split('#')[0]!.split(';').map((field) => field.trim())
    if (fields.length < 3 || (fields[1] !== 'C' && fields[1] !== 'F')) continue
    const from = Number.parseInt(fields[0]!, 16)
    const to = fields[2]!.split(' ').map((code) => Number.parseInt(code, 16))
    if (fields[1] === 'C') single.push(from, to[0]!)
    else multiple.push(`  [0x${from.toString(16)}, ${JSON.stringify(String.fromCodePoint(...to))}],`)
  }
  const values = single.map((code) => `0x${code.toString(16)}`)
  const lines = [
    `// Generated from CaseFolding-${version}.txt by scripts/generate-case-fold-tables.ts. Do not edit.`,
    '',
    `export const CASE_FOLD_VERSION = '${version}'`,
    '',
    '/** Status C: a code point and the one it folds to, in turn. */',
    'export const SIMPLE_FOLDS: readonly number[] = [',
  ]
  for (let at = 0; at < values.length; at += 12) lines.push(`  ${values.slice(at, at + 12).join(', ')},`)
  lines.push(']', '', '/** Status F: a code point and the text it folds to. */',
    'export const FULL_FOLDS: readonly (readonly [number, string])[] = [', ...multiple, ']', '')
  return lines.join('\n')
}

if (process.argv[1] === import.meta.filename) {
  const path = process.argv[2]
  if (path === undefined) throw new Error('usage: node scripts/generate-case-fold-tables.ts <CaseFolding.txt>')
  writeFileSync(join(import.meta.dirname, '..', 'src/case-fold-tables.ts'), generateCaseFoldTables(readFileSync(path, 'utf8')))
}
