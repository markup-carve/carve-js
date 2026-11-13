// Slice 5: runs the tool over every `.crv` file under the directories given and prints the counts
// per entry and the differences no entry explains.
//   node upgrade/scripts/corpus.ts [--list] DIR...
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { upgrade } from '../src/upgrade.ts'

function collect(dir: string, out: string[]): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.git') continue
    const path = join(dir, entry.name)
    if (entry.isDirectory()) collect(path, out)
    else if (entry.name.endsWith('.crv')) out.push(path)
  }
}

const args = process.argv.slice(2)
const list = args.includes('--list')
const files: string[] = []
for (const dir of args) {
  if (!dir.startsWith('--')) collect(dir, files)
}
files.sort()

const perEntry = new Map<string, number>()
const checks = { pass: 0, explained: 0, mismatch: 0 }
let changed = 0
const mismatches: string[] = []
for (const file of files) {
  const result = upgrade(readFileSync(file, 'utf8'))
  if (result.changed) changed++
  checks[result.check]++
  for (const record of result.records) {
    perEntry.set(record.entry, (perEntry.get(record.entry) ?? 0) + 1)
    if (record.class === 'mismatch') mismatches.push(`${file}:${record.line}: ${record.message}`)
  }
}
console.log(`documents ${files.length}, changed ${changed}, check pass ${checks.pass}, explained ${checks.explained}, mismatch ${checks.mismatch}`)
for (const [entry, count] of [...perEntry].sort()) console.log(`${entry}\t${count}`)
if (list) for (const line of mismatches) console.log(line)
