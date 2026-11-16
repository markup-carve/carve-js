// Writes src/unicode-tables.ts from data/unicode-categories.json (C2-I-127): the general categories the
// engine tests, as sorted inclusive ranges, so no test depends on the Unicode version of the runtime.
//   node v2/scripts/generate-unicode-tables.ts
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

interface Categories {
  unicode: string
  categories: { name: string, ranges: string[] }[]
}

type Range = [number, number]

function rangesOf(data: Categories, name: string): Range[] {
  const category = data.categories.find((entry) => entry.name === name)
  if (category === undefined) throw new Error(`data/unicode-categories.json has no category ${name}`)
  return category.ranges.map((range) => {
    const [first, last] = range.split('-')
    return [Number.parseInt(first!, 16), Number.parseInt(last ?? first!, 16)]
  })
}

/** The union of `lists`, sorted, with touching ranges joined. */
function union(...lists: Range[][]): Range[] {
  const sorted = lists.flat().sort((a, b) => a[0] - b[0])
  const out: Range[] = []
  for (const range of sorted) {
    const last = out[out.length - 1]
    if (last !== undefined && range[0] <= last[1] + 1) last[1] = Math.max(last[1], range[1])
    else out.push([range[0], range[1]])
  }
  return out
}

function table(name: string, doc: string, ranges: Range[]): string[] {
  const values = ranges.flatMap(([first, last]) => [first, last]).map((code) => `0x${code.toString(16)}`)
  const lines = [`/** ${doc} */`, `export const ${name}: readonly number[] = [`]
  for (let at = 0; at < values.length; at += 12) lines.push(`  ${values.slice(at, at + 12).join(', ')},`)
  lines.push(']', '')
  return lines
}

/** The text of src/unicode-tables.ts for the data file. */
export function generateUnicodeTables(json: string): string {
  const data = JSON.parse(json) as Categories
  const letter = rangesOf(data, 'L')
  return [
    `// Generated from data/unicode-categories.json (Unicode ${data.unicode}) by scripts/generate-unicode-tables.ts. Do not edit.`,
    '// Each table is a sorted list of inclusive ranges, first and last code point in turn.',
    '',
    `export const UNICODE_VERSION = '${data.unicode}'`,
    '',
    ...table('LETTER_RANGES', 'General category L.', letter),
    ...table('LETTER_OR_NUMBER_RANGES', 'General categories L and N.', union(letter, rangesOf(data, 'N'))),
    ...table('NUMBER_RANGES', 'General category N.', rangesOf(data, 'N')),
    ...table('MARK_RANGES', 'General category M.', rangesOf(data, 'M')),
    ...table('FORMAT_RANGES', 'General category Cf.', rangesOf(data, 'Cf')),
  ].join('\n')
}

if (process.argv[1] === import.meta.filename) {
  const root = join(import.meta.dirname, '..')
  writeFileSync(join(root, 'src/unicode-tables.ts'), generateUnicodeTables(readFileSync(join(root, 'data/unicode-categories.json'), 'utf8')))
}
