// The parser and HTML slice of the pinned 0.2 conformance corpus. The full conformance
// runner also exercises CLI, migration, lint and import, which this gate does not mutate.
import { CLAUSE_CASES, CORPUS_EXAMPLES, EXAMPLE_TREES } from './corpus.ts'
import { clauseCaseMismatches, exampleMismatches, exampleTreeMismatches } from './corpus-checks.ts'
import { HELD } from './corpus-held.ts'
import { newCaseMismatches } from './corpus-new.mjs'

let checked = 0
const failures: string[] = []

function assess(id: string, actual: string[], held: string[] | undefined): void {
  checked++
  if (actual.join() !== (held ?? []).join()) failures.push(`${id}: ${actual.join(', ')}`)
}

for (const example of CORPUS_EXAMPLES) {
  if (example.kind === 'import' || example.kind === 'lint') continue
  assess(example.id, exampleMismatches(example).map((mismatch) => mismatch.field), HELD.get(example.id)?.fields)
}
for (const entry of CLAUSE_CASES) {
  if (entry.kind !== undefined && !['parse', 'tree', 'layout'].includes(entry.kind)) continue
  const mismatches = entry.kind === undefined ? clauseCaseMismatches(entry) : newCaseMismatches(entry)
  assess(entry.id, mismatches.map((mismatch: { field: string }) => mismatch.field), HELD.get(entry.id)?.fields)
}
for (const trees of EXAMPLE_TREES.values()) for (const entry of trees) {
  const held = HELD.get(entry.id)?.fields ?? []
  const actual = exampleTreeMismatches(entry).map((mismatch) => mismatch.field).filter((field) => !held.includes(field))
  assess(entry.id, actual, [])
}

console.log(`mutation-corpus: ${checked} pinned cases, ${failures.length} failures`)
for (const failure of failures.slice(0, 20)) console.error(failure)
if (failures.length) process.exitCode = 1
