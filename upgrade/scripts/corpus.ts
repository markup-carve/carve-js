// Slice 5: runs the tool over real documents and prints the counts per entry and the differences
// no entry explains.
//   node upgrade/scripts/corpus.ts [--list] [--smallest N] [--examples DIR]... DIR...
// A plain DIR gives every `.crv` file under it. `--examples DIR` gives every Carve input of the
// example files under it: the body of each fenced block with the language `carve` in a `.md` file.
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { upgrade } from '../src/upgrade.ts'

interface Document {
  name: string
  text: string
}

function collect(dir: string, extension: string, out: string[]): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.git') continue
    const path = join(dir, entry.name)
    if (entry.isDirectory()) collect(path, extension, out)
    else if (entry.name.endsWith(extension)) out.push(path)
  }
}

function fenceLength(line: string): number {
  let at = 0
  while (line[at] === '`') at++
  return at
}

/** The Carve inputs of the example file `path`. */
function carveBlocks(path: string): Document[] {
  const out: Document[] = []
  const lines = readFileSync(path, 'utf8').split('\n')
  for (let at = 0; at < lines.length; at++) {
    const length = fenceLength(lines[at]!)
    if (length < 3 || lines[at]!.slice(length) !== 'carve') continue
    const first = at + 1
    while (at + 1 < lines.length && !(fenceLength(lines[at + 1]!) >= length && lines[at + 1]!.trim().length === fenceLength(lines[at + 1]!))) at++
    out.push({ name: `${path}:${first + 1}`, text: lines.slice(first, at + 1).join('\n') + '\n' })
    at++
  }
  return out
}

function readArguments(args: string[]): { list: boolean, smallest: number, documents: Document[] } {
  const documents: Document[] = []
  let list = false
  let smallest = 0
  for (let at = 0; at < args.length; at++) {
    const arg = args[at]!
    if (arg === '--list') list = true
    else if (arg === '--smallest') smallest = Number.parseInt(args[++at] ?? '0', 10)
    else if (arg === '--examples') {
      const files: string[] = []
      collect(args[++at]!, '.md', files)
      for (const file of files.sort()) documents.push(...carveBlocks(file))
    } else {
      const files: string[] = []
      collect(arg, '.crv', files)
      for (const file of files.sort()) documents.push({ name: file, text: readFileSync(file, 'utf8') })
    }
  }
  return { list, smallest, documents }
}

const { list, smallest, documents } = readArguments(process.argv.slice(2))
const perEntry = new Map<string, number>()
const perEntryDocuments = new Map<string, number>()
const checks = { pass: 0, explained: 0, mismatch: 0 }
let changed = 0
const mismatches: { name: string, line: number, message: string, text: string }[] = []
for (const document of documents) {
  const result = upgrade(document.text)
  if (result.changed) changed++
  checks[result.check]++
  const seen = new Set<string>()
  for (const record of result.records) {
    perEntry.set(record.entry, (perEntry.get(record.entry) ?? 0) + 1)
    seen.add(record.entry)
    if (record.class === 'mismatch') mismatches.push({ name: document.name, line: record.line, message: record.message, text: document.text })
  }
  for (const entry of seen) perEntryDocuments.set(entry, (perEntryDocuments.get(entry) ?? 0) + 1)
}
console.log(`documents ${documents.length}, changed ${changed}, check pass ${checks.pass}, explained ${checks.explained}, mismatch ${checks.mismatch}`)
console.log('entry\trecords\tdocuments')
for (const [entry, count] of [...perEntry].sort()) console.log(`${entry}\t${count}\t${perEntryDocuments.get(entry) ?? 0}`)
if (list) for (const entry of mismatches) console.log(`${entry.name}:${entry.line}: ${entry.message}`)
if (smallest > 0) {
  mismatches.sort((a, b) => a.text.length - b.text.length)
  for (const entry of mismatches.slice(0, smallest)) console.log(`--- ${entry.name}: ${entry.message}\n${entry.text}`)
}
