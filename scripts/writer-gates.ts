// The two gates of the writer (C2-W-002, C2-W-003) with and without the sidecar, the stability of
// canonical inputs and the escapes of C2-W-088, compared byte for byte with a slow reference of its
// procedure, on every example input of the specification, every document of up to N lines over the
// alphabet of line shapes and every content of up to M inline tokens (test/support/writer-checks.ts).
// The random run checks the gates alone on seeded contents of 5 to 9 tokens and documents of 4 to 12 lines.
// Every gate counts its inputs four ways: refused (C2-W-016, C2-W-133); with a reported loss (C2-W-011), listed
// apart; failures, a form with no reported loss that reads back as another tree, is not stable or
// differs from the reference; and undecided, whose escapes the procedure does not decide.
// Every input is a parse, which the writer writes faithfully or refuses, so a loss fails the run too.
//   node scripts/writer-gates.ts examples
//   node scripts/writer-gates.ts lines 3
//   node scripts/writer-gates.ts tokens 4
//   node scripts/writer-gates.ts random [contents] [documents] [seed] [--silent] [--all-losses]
//   node scripts/writer-gates.ts plan-check [contents] [documents] [seed] [property documents]
// The plan check counts the groups the plan decides that do not read back as their tree, on the random inputs,
// the documents of the property generator and the examples. `format` writes such a group with no parse, so each
// one is a loss it would not report.
// With --silent a run fails only on a failure with no reported loss.
import { CARVE_SOURCES } from './corpus.ts'
import { parseWithLayout } from '../src/api.ts'
import { format, parse, tabsExtensions, treesEqual, writeWithDiagnostics, type DocumentNode } from '../src/index.ts'
import { writeTreeWithStats } from '../src/write.ts'
import { generate, loadCorpus, random as propertyRandom } from '../proptest/generate.ts'
import { LINE_SHAPES } from '../test/support/enumerate.ts'
import { WRITER_TOKENS } from '../test/support/inline-enumerate.ts'
import {
  checkWriter, enumerateWriter, isReportedLoss, type RandomRunResult, randomWriter, seededRandom, WRITER_GATE_HELD,
} from '../test/support/writer-checks.ts'

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
  console.log(`${what}: ${counts.inputs} inputs, ${counts.refused} refused (C2-W-016, C2-W-133), ${reported}`)
  return counts.failures === 0 && (silentOnly || counts.losses === 0)
}

function runExamples(): boolean {
  const examples = CARVE_SOURCES
  const counts: Counts = { inputs: examples.length, refused: 0, losses: 0, failures: 0, undecided: 0 }
  const lines: string[] = []
  const undecided: string[] = []
  for (const example of examples) {
    const failure = checkWriter(example.input, undecided)
    const held = WRITER_GATE_HELD.get(example.id)
    if (held !== undefined) {
      if (failure === null) {
        counts.failures++
        lines.push(`  ${example.id}: held (${held}) but passes; drop the hold`)
      }
      continue
    }
    if (failure === 'refused') counts.refused++
    else if (failure !== null && isReportedLoss(failure)) {
      counts.losses++
      lines.push(`  loss: ${example.id}: ${failure}`)
    } else if (failure !== null) {
      counts.failures++
      lines.push(`  ${example.id}: ${failure}`)
    }
  }
  counts.undecided = undecided.length
  const passed = summary('examples', counts)
  for (const line of lines) console.log(line)
  for (const entry of undecided) console.log(`  undecided: ${entry}`)
  return passed && runExtensionExamples()
}

/** C2-X-049: the writer gates on claims and on a supplied tree with no source form. */
function runExtensionExamples(): boolean {
  const inputs = [
    ':::: tabs\n::: tab "One"\nBody\n:::\n::::\n',
    ':::: tabs\n::: tab "One"\n::: tabs\n::: tab "Two"\nNested\n:::\n:::\n:::\n::::\n',
  ]
  let failures = 0
  for (const input of inputs) for (const extensions of [tabsExtensions, []]) {
    const once = format(input, { extensions })
    const parseOptions = { extensions, positions: false }
    if (format(once, { extensions }) !== once
      || !treesEqual(parse(once, parseOptions), parse(input, parseOptions))) failures++
  }
  const unknown: DocumentNode = { type: 'document', astVersion: '2.0',
    extensions: [{ name: 'test.unknown', version: '1', required: false, slots: [] }],
    children: [{ type: 'block_extension', name: 'test.unknown', version: '1', children: [],
      fallback: [{ type: 'paragraph', children: [{ type: 'text', value: 'Safe' }] }] }] }
  const written = writeWithDiagnostics(unknown)
  if (written.source !== 'Safe\n' || !written.diagnostics.some((entry) => entry.code === 'structure-unspellable')) failures++
  console.log(`extension writer gates: ${inputs.length * 2 + 1} inputs, ${failures} failures`)
  return failures === 0
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
  const blocks = report('random documents', randomWriter(documents, seededRandom(seed + 1), randomDocument,
    process.argv.includes('--all-losses') ? documents : 20), started)
  return inline && blocks
}

/** Whether the plan decides a group of `src` that does not read back (C2-W-089). */
function planMisses(src: string): boolean {
  const parsed = parseWithLayout(src, { extensions: [] })
  return (writeTreeWithStats(parsed.document, { layout: parsed.layout }, 'plan', true).stats.reasons.get('check') ?? 0) > 0
}

function runPlanCheck(contents: number, documents: number, seed: number, property: number): boolean {
  const started = Date.now()
  const missed: string[] = []
  const inputs: [number, () => string][] = []
  const contentRandom = seededRandom(seed)
  const documentRandom = seededRandom(seed + 1)
  for (let at = 0; at < contents; at++) inputs.push([0, () => randomContent(contentRandom)])
  for (let at = 0; at < documents; at++) inputs.push([1, () => randomDocument(documentRandom)])
  for (const example of CARVE_SOURCES) inputs.push([2, () => example.input])
  const corpus = loadCorpus(undefined)
  const generator = propertyRandom(seed)
  for (let at = 0; at < property; at++) inputs.push([3, () => generate(generator, corpus, 4096)])
  let count = 0
  for (const [, build] of inputs) {
    const src = build()
    if (!planMisses(src)) continue
    count++
    if (missed.length < 20) missed.push(JSON.stringify(src))
  }
  console.log(`plan check, ${Date.now() - started} ms: ${inputs.length} inputs, ${count} with a planned group read back as another tree`)
  for (const src of missed) console.log(`  ${src}`)
  return count === 0
}

const kind = process.argv[2] ?? 'examples'
const numbers = process.argv.filter((value) => value !== '--silent')
const argument = (at: number, fallback: number): number => Number(numbers[at] ?? fallback)
let passed: boolean
if (kind === 'examples') passed = runExamples()
else if (kind === 'plan-check') passed = runPlanCheck(argument(3, 500_000), argument(4, 500_000), argument(5, 1), argument(6, 20_000))
else if (kind === 'random') passed = runRandom(argument(3, 5_000_000), argument(4, 500_000), argument(5, 1))
else passed = runEnumeration(kind, argument(3, 2))
process.exitCode = passed ? 0 : 1
