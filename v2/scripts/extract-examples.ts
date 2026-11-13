// Writes data/examples.json from the `compare` containers of the four documents of the 0.2
// specification that hold examples, and copies every data file this engine keeps a copy of.
//   node v2/scripts/extract-examples.ts <path to spec/0.2>
import { copyFileSync, existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export interface SpecExample {
  file: string
  number: number
  // `generated` or `unverified`, and the flags named beside it.
  label: string
  flags: string[]
  input: string
  html: string
}

const FILES = ['syntax-blocks.md', 'syntax-inline.md', 'html.md', 'ast.md']
const HEADER = /^Example (\d+) \((generated|unverified)([^)]*)\)\s*$/
const FENCE = /^(`{3,})(\w*)\s*$/

function fencedBlock(lines: string[], at: number): { info: string, body: string, next: number } | null {
  const open = FENCE.exec(lines[at] ?? '')
  if (open === null) return null
  let end = at + 1
  while (end < lines.length && lines[end] !== open[1]) end++
  return { info: open[2]!, body: lines.slice(at + 1, end).join('\n'), next: end + 1 }
}

/** The examples of one document: a header line, then a compare container with a carve and an html fence. */
export function examplesOf(file: string, text: string): SpecExample[] {
  const lines = text.split('\n')
  const examples: SpecExample[] = []
  for (let at = 0; at < lines.length; at++) {
    const header = HEADER.exec(lines[at]!)
    if (header === null) continue
    const blocks: { info: string, body: string }[] = []
    let line = at + 1
    while (line < lines.length && blocks.length < 2 && HEADER.exec(lines[line]!) === null) {
      const block = fencedBlock(lines, line)
      if (block === null) {
        line++
        continue
      }
      blocks.push(block)
      line = block.next
    }
    if (blocks.length < 2 || blocks[0]!.info !== 'carve' || blocks[1]!.info !== 'html') {
      throw new Error(`${file}: example ${header[1]!} has no carve and html fence`)
    }
    const flags = header[3]!.split(',').map((flag) => flag.replaceAll('`', '').trim()).filter((flag) => flag !== '')
    examples.push({ file, number: Number(header[1]), label: header[2]!, flags, input: blocks[0]!.body, html: blocks[1]!.body })
  }
  return examples
}

if (process.argv[1] === import.meta.filename) {
  const spec = process.argv[2]
  if (spec === undefined) throw new Error('usage: extract-examples.ts <path to spec/0.2>')
  const data = join(import.meta.dirname, '../data')
  const examples = FILES.flatMap((file) => examplesOf(file, readFileSync(join(spec, file), 'utf8')))
  writeFileSync(join(data, 'examples.json'), `${JSON.stringify(examples, null, 1)}\n`)
  // The generated tables in src/ are written from these copies; run the generate scripts after a copy changes.
  const copies = readdirSync(data).filter((name) => name.endsWith('.json') && existsSync(join(spec, 'data', name)))
  for (const name of copies) copyFileSync(join(spec, 'data', name), join(data, name))
  console.log(`${examples.length} examples, ${copies.length} data files`)
}
