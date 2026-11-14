// The two gates of the writer (C2-W-002, C2-W-003) with and without the sidecar, the stability of
// canonical inputs and the escapes of C2-W-088, compared byte for byte with a slow reference of its
// procedure, on every example input of the specification, every document of up to N lines over the
// alphabet of line shapes and every content of up to M inline tokens (test/support/writer-checks.ts).
// Inputs whose escapes the procedure does not decide are counted and listed apart.
//   node v2/scripts/writer-gates.ts examples
//   node v2/scripts/writer-gates.ts lines 3
//   node v2/scripts/writer-gates.ts tokens 4
import { readFileSync } from 'node:fs'
import { LINE_SHAPES } from '../test/support/enumerate.ts'
import { INLINE_TOKENS } from '../test/support/inline-enumerate.ts'
import { checkWriter, enumerateWriter } from '../test/support/writer-checks.ts'

interface Example {
  file: string
  number: number
  input: string
}

function runExamples(): boolean {
  const examples = JSON.parse(readFileSync(new URL('../data/examples.json', import.meta.url), 'utf8')) as Example[]
  let failures = 0
  let refused = 0
  const undecided: string[] = []
  for (const example of examples) {
    const failure = checkWriter(example.input, undecided)
    if (failure === 'refused') refused++
    else if (failure !== null) {
      failures++
      console.log(`  ${example.file} example ${example.number}: ${failure}`)
    }
  }
  const counts = `${refused} refused (C2-W-016), ${failures} failures, ${undecided.length} undecided (C2-W-088)`
  console.log(`examples: ${examples.length} inputs, ${counts}`)
  for (const entry of undecided) console.log(`  undecided: ${entry}`)
  return failures === 0
}

function runEnumeration(kind: string, max: number): boolean {
  let passed = true
  for (let size = 1; size <= max; size++) {
    const started = Date.now()
    const result = kind === 'tokens' ? enumerateWriter(INLINE_TOKENS, size, '', 'x') : enumerateWriter(LINE_SHAPES, size, '\n', '')
    const counts = `${result.documents} documents, ${result.refused} refused (C2-W-016), ${result.failures.length} failures`
    console.log(`${size} ${kind}: ${counts}, ${result.undecided} undecided (C2-W-088), ${Date.now() - started} ms`)
    for (const failure of result.failures) console.log(`  ${failure}`)
    for (const entry of result.undecidedSamples) console.log(`  undecided: ${entry}`)
    if (result.failures.length > 0) passed = false
  }
  return passed
}

const kind = process.argv[2] ?? 'examples'
const passed = kind === 'examples' ? runExamples() : runEnumeration(kind, Number(process.argv[3] ?? '2'))
process.exitCode = passed ? 0 : 1
