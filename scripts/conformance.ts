// Prints the conformance table of this engine against the corpus of the pinned specification: per kind
// and per document the entries, those that pass, and those held for a corrected example, with every
// failure. Fails when an entry fails that is not held. The HTML import examples run in import/.
//   node scripts/conformance.ts
import {
  CLAUSE_CASES, CORPUS_EXAMPLES, EXAMPLE_TREES, LAYOUT_FIXTURES, REFUSED_TREES, SPEC_PIN, SUPPLIED_TREES,
} from './corpus.ts'
import { clauseCaseMismatches, exampleMismatches, exampleTreeMismatches, layoutMismatches, refusalPath } from './corpus-checks.ts'
import { HELD, HELD_SUPPLIED, REFUSED_AT } from './corpus-held.ts'
import { decodeTree } from '../src/index.ts'
import { newCaseMismatches } from './corpus-new.mjs'

interface Row {
  total: number
  passed: number
  held: number
  unverified: number
  unverifiedPassed: number
}

const sampleAt = process.argv.indexOf('--sample')
const sampleCount = sampleAt < 0 ? null : Number(process.argv[sampleAt + 1])
if (sampleCount !== null && (!Number.isSafeInteger(sampleCount) || sampleCount < 1)) {
  throw new Error('pass a positive sample count')
}
function sample<T>(entries: readonly T[]): readonly T[] {
  if (sampleCount === null || entries.length <= sampleCount) return entries
  return Array.from({ length: sampleCount }, (_, at) => entries[Math.floor(at * entries.length / sampleCount)]!)
}

const rows = new Map<string, Row>()
const failures: string[] = []

function count(name: string, failed: readonly string[], unverified = false): Row {
  const row = rows.get(name) ?? { total: 0, passed: 0, held: 0, unverified: 0, unverifiedPassed: 0 }
  rows.set(name, row)
  row.total++
  if (unverified) row.unverified++
  if (failed.length === 0) {
    row.passed++
    if (unverified) row.unverifiedPassed++
  }
  return row
}

function accepted(tree: unknown): boolean {
  try {
    decodeTree(JSON.stringify(tree))
    return true
  } catch {
    return false
  }
}

for (const example of sample(CORPUS_EXAMPLES)) {
  if (example.kind === 'import') continue
  const failed = exampleMismatches(example).map((entry) => entry.field)
  const held = HELD.get(example.id)
  const row = count(`examples, ${example.document}`, failed, example.status === 'unverified')
  if (held !== undefined && failed.join() === held.fields.join()) row.held++
  else if (failed.length > 0) failures.push(`${example.id}: ${failed.join(', ')}`)
}
for (const entry of sample(CLAUSE_CASES)) {
  if (sampleCount !== null && entry.kind === 'cli') continue
  const failed = (entry.kind === undefined ? clauseCaseMismatches(entry) : newCaseMismatches(entry)).map((mismatch) => mismatch.field)
  const held = HELD.get(entry.id)
  const row = count(`clause cases, ${entry.kind ?? 'render'}`, failed)
  if (held !== undefined && failed.join() === held.fields.join()) row.held++
  else if (failed.length > 0) failures.push(`${entry.id}: ${failed.join(', ')}`)
}
for (const entry of sample(REFUSED_TREES)) {
  const path = refusalPath(entry)
  const failed = path?.startsWith(REFUSED_AT.get(entry.id) ?? '?') === true ? [] : [`refused at ${String(path)}`]
  count('refused trees', failed)
  if (failed.length > 0) failures.push(`${entry.id}: ${failed.join(', ')}`)
}
for (const [file, trees] of EXAMPLE_TREES) {
  for (const entry of sample(trees)) {
    const failed = exampleTreeMismatches(entry).map((mismatch) => mismatch.field)
    const held = HELD.get(entry.id)
    const row = count('positive trees', failed)
    // A held tree field of the example is held in its tree file too, as in test/corpus.test.ts.
    if (held !== undefined && failed.length > 0 && failed.every((field) => held.fields.includes(field))) row.held++
    else if (failed.length > 0) failures.push(`${file} ${entry.id}: ${failed.join(', ')}`)
  }
}
for (const entry of sample(SUPPLIED_TREES)) {
  const failed = accepted(entry.tree) ? [] : ['refused']
  const row = count('supplied trees', failed)
  // A held supplied tree must still be refused; one that is accepted is a stale hold.
  if (HELD_SUPPLIED.has(entry.id)) {
    if (failed.length > 0) row.held++
    else failures.push(`nodes ${entry.id}: accepted, but held (${HELD_SUPPLIED.get(entry.id)})`)
  } else if (failed.length > 0) failures.push(`nodes ${entry.id}: refused`)
}
for (const entry of sample(LAYOUT_FIXTURES)) {
  const failed = layoutMismatches(entry).map((mismatch) => mismatch.field)
  count('layouts', failed)
  if (failed.length > 0) failures.push(`layout ${entry.id}: ${failed.join(', ')}`)
}

console.log(`specification ${SPEC_PIN.slice(0, 8)}`)
console.log(`${'kind'.padEnd(36)} ${'total'.padStart(5)} ${'pass'.padStart(5)} ${'held'.padStart(5)}  unverified passing`)
for (const [name, row] of rows) {
  const unverified = row.unverified === 0 ? '' : `  ${row.unverifiedPassed} of ${row.unverified}`
  const counts = [row.total, row.passed, row.held].map((value) => String(value).padStart(5)).join(' ')
  console.log(`${name.padEnd(36)} ${counts}${unverified}`)
}
for (const failure of failures) console.log(`FAIL ${failure}`)
if (failures.length > 0) process.exitCode = 1
