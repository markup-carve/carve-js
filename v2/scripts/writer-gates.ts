// The two gates of the writer (C2-W-002, C2-W-003) with and without the sidecar, the stability of
// canonical inputs and the escapes of C2-W-088, compared byte for byte with a slow reference of its
// procedure, on every example input of the specification, every document of up to N lines over the
// alphabet of line shapes and every content of up to M inline tokens (test/support/writer-checks.ts).
// Inputs whose escapes the procedure does not decide are counted and listed apart. The random run
// checks the gates alone on seeded contents of 5 to 9 tokens and documents of 4 to 12 lines.
//   node v2/scripts/writer-gates.ts examples
//   node v2/scripts/writer-gates.ts lines 3
//   node v2/scripts/writer-gates.ts tokens 4
//   node v2/scripts/writer-gates.ts random [contents] [documents] [seed] [--silent]
// With --silent the random run fails only on an output that reads back differently with no reported loss.
import { readFileSync } from 'node:fs'
import { LINE_SHAPES } from '../test/support/enumerate.ts'
import { WRITER_TOKENS } from '../test/support/inline-enumerate.ts'
import { checkWriter, enumerateWriter, type RandomRunResult, randomWriter, seededRandom } from '../test/support/writer-checks.ts'

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
    const result = kind === 'tokens' ? enumerateWriter(WRITER_TOKENS, size, '', 'x') : enumerateWriter(LINE_SHAPES, size, '\n', '')
    const counts = `${result.documents} documents, ${result.refused} refused (C2-W-016), ${result.failures.length} failures`
    console.log(`${size} ${kind}: ${counts}, ${result.undecided} undecided (C2-W-088), ${Date.now() - started} ms`)
    for (const failure of result.failures) console.log(`  ${failure}`)
    for (const entry of result.undecidedSamples) console.log(`  undecided: ${entry}`)
    if (result.failures.length > 0) passed = false
  }
  return passed
}

function pick<T>(random: () => number, list: readonly T[]): T {
  return list[Math.floor(random() * list.length)]!
}

function between(random: () => number, low: number, high: number): number {
  return low + Math.floor(random() * (high - low + 1))
}

/** A content of 5 to 9 tokens behind the word `x`, as the enumeration of tokens writes one. */
function randomContent(random: () => number): string {
  let out = 'x'
  for (let count = between(random, 5, 9); count > 0; count--) out += pick(random, WRITER_TOKENS)
  return out
}

/** A document of 4 to 12 lines, each a line shape, half of them with up to three tokens behind it. */
function randomDocument(random: () => number): string {
  const lines: string[] = []
  for (let count = between(random, 4, 12); count > 0; count--) {
    let line: string = pick(random, LINE_SHAPES)
    if (random() < 0.5) for (let tokens = between(random, 1, 3); tokens > 0; tokens--) line += pick(random, WRITER_TOKENS)
    lines.push(line)
  }
  return lines.join('\n')
}

const silentOnly = process.argv.includes('--silent')

function report(what: string, result: RandomRunResult, started: number): boolean {
  const counts = `${result.documents} ${what}, ${result.refused} refused (C2-W-016), ${result.failureCount} failures`
  const losses = `${result.lossCount} with a reported loss (C2-W-011), ${result.silentCount} without one`
  console.log(`${counts}, ${losses}, ${Date.now() - started} ms`)
  for (const failure of result.failures) console.log(`  ${failure}`)
  for (const loss of result.losses) console.log(`  loss: ${loss}`)
  return silentOnly ? result.silentCount === 0 : result.failureCount === 0
}

function runRandom(contents: number, documents: number, seed: number): boolean {
  console.log(`seed ${seed}`)
  let started = Date.now()
  const inline = report('random contents', randomWriter(contents, seededRandom(seed), randomContent), started)
  started = Date.now()
  const blocks = report('random documents', randomWriter(documents, seededRandom(seed + 1), randomDocument), started)
  return inline && blocks
}

const kind = process.argv[2] ?? 'examples'
const numbers = process.argv.filter((value) => value !== '--silent')
const argument = (at: number, fallback: number): number => Number(numbers[at] ?? fallback)
let passed: boolean
if (kind === 'examples') passed = runExamples()
else if (kind === 'random') passed = runRandom(argument(3, 2_000_000), argument(4, 200_000), argument(5, 1))
else passed = runEnumeration(kind, argument(3, 2))
process.exitCode = passed ? 0 : 1
