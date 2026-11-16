// Prints the conformance table of this engine against the corpus of the pinned specification: per kind
// and per document the entries, those that pass, and those held for a corrected example, with every
// failure. Fails when an entry fails that is not held. The HTML import examples run in import/.
//   node v2/scripts/conformance.ts
import {
  CLAUSE_CASES, CORPUS_EXAMPLES, EXAMPLE_TREES, LAYOUT_FIXTURES, REFUSED_TREES, SPEC_PIN, SUPPLIED_TREES,
} from './corpus.ts'
import { clauseCaseMismatches, exampleMismatches, exampleTreeMismatches, layoutMismatches, refusalPath } from './corpus-checks.ts'
import { HELD, REFUSED_AT } from './corpus-held.ts'
import { decodeTree } from '../src/index.ts'

interface Row {
  total: number
  passed: number
  held: number
  unverified: number
  unverifiedPassed: number
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

for (const example of CORPUS_EXAMPLES) {
  if (example.kind === 'import') continue
  const failed = exampleMismatches(example).map((entry) => entry.field)
  const held = HELD.get(example.id)
  const row = count(`examples, ${example.document}`, failed, example.status === 'unverified')
  if (held !== undefined && failed.join() === held.fields.join()) row.held++
  else if (failed.length > 0) failures.push(`${example.id}: ${failed.join(', ')}`)
}
for (const entry of CLAUSE_CASES) {
  const failed = clauseCaseMismatches(entry).map((mismatch) => mismatch.field)
  count('clause cases', failed)
  if (failed.length > 0) failures.push(`${entry.id}: ${failed.join(', ')}`)
}
for (const entry of REFUSED_TREES) {
  const path = refusalPath(entry)
  const failed = path?.startsWith(REFUSED_AT.get(entry.id) ?? '?') === true ? [] : [`refused at ${String(path)}`]
  count('refused trees', failed)
  if (failed.length > 0) failures.push(`${entry.id}: ${failed.join(', ')}`)
}
for (const [file, trees] of EXAMPLE_TREES) {
  for (const entry of trees) {
    const failed = exampleTreeMismatches(entry).map((mismatch) => mismatch.field)
    count('positive trees', failed)
    if (failed.length > 0) failures.push(`${file} ${entry.id}: ${failed.join(', ')}`)
  }
}
for (const entry of SUPPLIED_TREES) {
  const failed = accepted(entry.tree) ? [] : ['refused']
  count('supplied trees', failed)
  if (failed.length > 0) failures.push(`nodes ${entry.id}: refused`)
}
for (const entry of LAYOUT_FIXTURES) {
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
