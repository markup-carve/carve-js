// Writes data/examples.json, the list of `{ input }` that scripts/spec2-ast-crosscheck.mjs of the specification
// reads from an engine checkout: every Carve source of the pinned corpus. Generated in CI, not committed.
//   node v2/scripts/write-example-inputs.ts
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { CARVE_SOURCES, DATA } from './corpus.ts'

writeFileSync(join(DATA, 'examples.json'), `${JSON.stringify(CARVE_SOURCES.map(({ input }) => ({ input })))}\n`)
console.log(`${CARVE_SOURCES.length} inputs`)
