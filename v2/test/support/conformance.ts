// The examples of the 0.2 specification against the HTML this engine writes. data/examples.json
// holds every `compare` container of the four documents, written by scripts/extract-examples.ts.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { render, type RenderOptions } from '../../src/index.ts'

export interface SpecExample {
  file: string
  number: number
  label: string
  flags: string[]
  input: string
  html: string
}

export const EXAMPLES = JSON.parse(readFileSync(join(import.meta.dirname, '../../data/examples.json'), 'utf8')) as SpecExample[]

/**
 * The options an example is rendered with, where they are not the defaults. Example 23 of the
 * HTML document stands in the section on the roundtrip carriers and shows the output with them.
 */
export const EXAMPLE_OPTIONS: ReadonlyMap<string, RenderOptions> = new Map([['html.md:23', { roundtrip: true }]])

/**
 * The options each flag behind the label of an example stands for. `--no-raw-html` is the default
 * of 0.2 (C2-H-127), and `lowercaseHeadingIds` is the 0.1 name of the value the flag beside it gives.
 */
export const FLAG_OPTIONS: ReadonlyMap<string, RenderOptions> = new Map<string, RenderOptions>([
  ['--no-raw-html', {}],
  ['lowercaseHeadingIds', { headingIds: 'lower' }],
  ['which is headingIds: lower', { headingIds: 'lower' }],
  ['--profile comment', { profile: 'comment' }],
  ['--profile minimal', { profile: 'minimal' }],
])

/** The options of an example: those of its flags, then those listed for it. A flag with no entry is an error. */
export function exampleOptions(example: SpecExample): RenderOptions {
  let options: RenderOptions = {}
  for (const flag of example.flags) {
    const found = FLAG_OPTIONS.get(flag)
    if (found === undefined) throw new Error(`${exampleId(example)}: the flag ${flag} has no options`)
    options = { ...options, ...found }
  }
  return { ...options, ...EXAMPLE_OPTIONS.get(exampleId(example)) }
}

/** The examples this engine does not match, each with the verdict on it. A failure without a verdict fails the test. */
export const VERDICTS: ReadonlyMap<string, string> = new Map<string, string>([
  ['syntax-inline.md:95', 'the example shows `‘n’`, but C2-I-108 exempts the word n: `Rock \'n\' roll` holds two apostrophes'],
])

export function exampleId(example: SpecExample): string {
  return `${example.file}:${example.number}`
}

/** The HTML of an example, or the error its render threw as text. */
export function renderExample(example: SpecExample): string {
  try {
    return render(example.input, exampleOptions(example))
  } catch (error) {
    return `threw ${String(error)}`
  }
}

export interface Tally {
  passed: number
  total: number
}

export interface ConformanceReport {
  all: Tally
  byFile: Map<string, Tally>
  byLabel: Map<string, Tally>
  /** The ids of the examples whose HTML differs, byte for byte. The HTML document defines no normalization. */
  failures: string[]
}

function count(table: Map<string, Tally>, key: string, passed: boolean): void {
  const tally = table.get(key) ?? { passed: 0, total: 0 }
  tally.total++
  if (passed) tally.passed++
  table.set(key, tally)
}

export function conformance(): ConformanceReport {
  const report: ConformanceReport = { all: { passed: 0, total: 0 }, byFile: new Map(), byLabel: new Map(), failures: [] }
  for (const example of EXAMPLES) {
    const passed = renderExample(example) === example.html
    report.all.total++
    if (passed) report.all.passed++
    else report.failures.push(exampleId(example))
    count(report.byFile, example.file, passed)
    count(report.byLabel, example.label, passed)
  }
  return report
}
