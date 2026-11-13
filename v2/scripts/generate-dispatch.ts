// Writes src/dispatch.ts from data/line-shapes.json.
//   node v2/scripts/generate-dispatch.ts
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

interface Shape {
  name: string
  first: string[]
}

const ASCII = 128

/** The text of src/dispatch.ts for the line shapes in `json`. */
export function generateDispatch(json: string): string {
  const shapes = (JSON.parse(json) as { shapes: Shape[] }).shapes
  const table = new Array<number>(ASCII).fill(0)
  const lines = [
    '// Generated from data/line-shapes.json by scripts/generate-dispatch.ts. Do not edit.',
    '',
  ]
  shapes.forEach((shape, bit) => {
    lines.push(`export const SHAPE_${shape.name.toUpperCase()} = ${1 << bit}`)
    for (const entry of shape.first) {
      const from = entry.charCodeAt(0)
      const to = entry.length === 3 ? entry.charCodeAt(2) : from
      for (let code = from; code <= to; code++) table[code]! |= 1 << bit
    }
  })
  lines.push('', '/** The shapes a line can have, by the code of its first character after the prefixes. */')
  lines.push('export const FIRST_CHARACTER_SHAPES: readonly number[] = [')
  for (let row = 0; row < ASCII; row += 16) lines.push(`  ${table.slice(row, row + 16).join(', ')},`)
  lines.push(']', '')
  return lines.join('\n')
}

if (process.argv[1] === import.meta.filename) {
  const root = join(import.meta.dirname, '..')
  writeFileSync(join(root, 'src/dispatch.ts'), generateDispatch(readFileSync(join(root, 'data/line-shapes.json'), 'utf8')))
}
