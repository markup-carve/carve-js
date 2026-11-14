// The two gates of the writer (C2-W-002, C2-W-003) with and without the sidecar, the stability of
// canonical inputs and the escapes of C2-W-088, compared byte for byte with a slow reference of its
// procedure, on every example input of the specification, every document of up to N lines over the
// alphabet of line shapes and every content of up to M inline tokens (test/support/writer-checks.ts).
// The random run checks the gates alone on seeded contents of 5 to 9 tokens and documents of 4 to 12 lines.
// Every gate counts its inputs four ways: refused (C2-W-016); with a reported loss (C2-W-011), listed
// apart; failures, a form with no reported loss that reads back as another tree, is not stable or
// differs from the reference; and undecided, whose escapes the procedure does not decide.
// Every input is a parse, which the writer writes faithfully or refuses, so a loss fails the run too.
//   node v2/scripts/writer-gates.ts examples
//   node v2/scripts/writer-gates.ts lines 3
//   node v2/scripts/writer-gates.ts tokens 4
//   node v2/scripts/writer-gates.ts random [contents] [documents] [seed] [--silent]
// With --silent a run fails only on a failure with no reported loss.
import { readFileSync } from 'node:fs'
import { LINE_SHAPES } from '../test/support/enumerate.ts'
import { WRITER_TOKENS } from '../test/support/inline-enumerate.ts'
import {
  checkWriter, enumerateWriter, isReportedLoss, type RandomRunResult, randomWriter, seededRandom,
} from '../test/support/writer-checks.ts'

interface Example {
  file: string
  number: number
  input: string
}

const silentOnly = process.argv.includes('--silent')

interface Counts {
  inputs: number
  refused: number
  losses: number
  failures: number
  undecided: number
}

/** The line of counts of one gate, and whether it passes. */
function summary(what: string, counts: Counts): boolean {
  const reported = `${counts.losses} with a reported loss (C2-W-011), ${counts.failures} failures, ${counts.undecided} undecided (C2-W-088)`
  console.log(`${what}: ${counts.inputs} inputs, ${counts.refused} refused (C2-W-016), ${reported}`)
  return counts.failures === 0 && (silentOnly || counts.losses === 0)
}

function runExamples(): boolean {
  const examples = JSON.parse(readFileSync(new URL('../data/examples.json', import.meta.url), 'utf8')) as Example[]
  const counts: Counts = { inputs: examples.length, refused: 0, losses: 0, failures: 0, undecided: 0 }
  const lines: string[] = []
  const undecided: string[] = []
  for (const example of examples) {
    const failure = checkWriter(example.input, undecided)
    if (failure === 'refused') counts.refused++
    else if (failure !== null && isReportedLoss(failure)) {
      counts.losses++
      lines.push(`  loss: ${example.file} example ${example.number}: ${failure}`)
    } else if (failure !== null) {
      counts.failures++
      lines.push(`  ${example.file} example ${example.number}: ${failure}`)
    }
  }
  counts.undecided = undecided.length
  const passed = summary('examples', counts)
  for (const line of lines) console.log(line)
  for (const entry of undecided) console.log(`  undecided: ${entry}`)
  return passed
}

function runEnumeration(kind: string, max: number): boolean {
  let passed = true
  for (let size = 1; size <= max; size++) {
    const started = Date.now()
    const result = kind === 'tokens' ? enumerateWriter(WRITER_TOKENS, size, '', 'x') : enumerateWriter(LINE_SHAPES, size, '\n', '')
    const counts: Counts = {
      inputs: result.documents, refused: result.refused, losses: result.lossCount, failures: result.failureCount - result.lossCount,
      undecided: result.undecided,
    }
    if (!summary(`${size} ${kind}, ${Date.now() - started} ms`, counts)) passed = false
    for (const failure of result.failures) if (!isReportedLoss(failure)) console.log(`  ${failure}`)
    for (const loss of result.losses) console.log(`  loss: ${loss}`)
    for (const entry of result.undecidedSamples) console.log(`  undecided: ${entry}`)
  }
  return passed
}

function pick<T>(random: () => number, list: readonly T[]): T {
  return list[Math.floor(random() * list.length)]!
}

function between(random: () => number, low: number, high: number): number {
  return low + Math.floor(random() * (high - low + 1))
}

// The tokens of the enumeration and the ingredients of the third review's findings: a byte-order mark,
// a lone CR, an escaped sigil and escaped brackets, a footnote reference and the bare sigils.
const RANDOM_TOKENS: readonly string[] = [...WRITER_TOKENS, '\uFEFF', '\r', '\\!', '\\[', '\\]', '[^^]', '!', '^', '(']

/** A content of 5 to 9 tokens behind the word `x`. */
function randomContent(random: () => number): string {
  let out = 'x'
  for (let count = between(random, 5, 9); count > 0; count--) out += pick(random, RANDOM_TOKENS)
  return out
}

/** A document of 4 to 12 lines, each a line shape, half of them with up to three tokens behind it. */
function randomDocument(random: () => number): string {
  const lines: string[] = []
  for (let count = between(random, 4, 12); count > 0; count--) {
    let line: string = pick(random, LINE_SHAPES)
    if (random() < 0.5) for (let tokens = between(random, 1, 3); tokens > 0; tokens--) line += pick(random, RANDOM_TOKENS)
    lines.push(line)
  }
  return lines.join('\n')
}

function report(what: string, result: RandomRunResult, started: number): boolean {
  const counts: Counts = {
    inputs: result.documents, refused: result.refused, losses: result.lossCount, failures: result.silentCount, undecided: 0,
  }
  const passed = summary(`${what}, ${Date.now() - started} ms`, counts)
  for (const failure of result.failures) console.log(`  ${failure}`)
  for (const loss of result.losses) console.log(`  loss: ${loss}`)
  return passed
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
else if (kind === 'random') passed = runRandom(argument(3, 5_000_000), argument(4, 500_000), argument(5, 1))
else passed = runEnumeration(kind, argument(3, 2))
process.exitCode = passed ? 0 : 1
