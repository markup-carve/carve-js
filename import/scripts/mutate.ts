import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { format } from '../../v2/src/index.ts'
import { writerHasLoss } from '../../v2/src/write.ts'
import { importDocument, ImportInputError, type Format } from '../src/index.ts'
import { commonmarkCases, djotCases, gfmCases } from './suites.ts'

interface Seed { from: Format, input: string }
interface SpecExample { html: string }
const specs = JSON.parse(readFileSync(join(import.meta.dirname, '../../v2/data/examples.json'), 'utf8')) as SpecExample[]
const seeds: Seed[] = [
  ...commonmarkCases().map(entry => ({ from: 'markdown' as const, input: entry.input })),
  ...gfmCases().map(entry => ({ from: 'gfm' as const, input: entry.input })),
  ...djotCases().map(entry => ({ from: 'djot' as const, input: entry.input })),
  ...specs.map(entry => ({ from: 'html' as const, input: entry.html })),
]
const MAX_SUITE_WRITER_REFUSALS = 253

function generator(seed: number): () => number {
  let state = seed
  return () => {
    state ^= state << 13
    state ^= state >>> 17
    state ^= state << 5
    return state >>> 0
  }
}

function mutate(input: string, random: () => number): string {
  const bytes = [...Buffer.from(input)]
  const kind = random() % 3
  const index = random() % (bytes.length + 1)
  if (kind === 0 || bytes.length === 0) bytes.splice(index, 0, random() % 256)
  else if (kind === 1) bytes.splice(index % bytes.length, 1)
  else if (bytes.length > 1) {
    const other = random() % bytes.length
    const first = index % bytes.length
    const previous = bytes[first] ?? 0
    bytes[first] = bytes[other] ?? 0
    bytes[other] = previous
  }
  return Buffer.from(bytes).toString('utf8')
}

function check(seed: Seed): 'tree' | 'typed-error' | 'writer-refusal' {
  try {
    const result = importDocument(seed.input, { from: seed.from })
    if (writerHasLoss(result.diagnostics)) return 'writer-refusal'
    if (format(result.source) !== result.source) throw new Error(`source is not stable: ${seed.from} ${JSON.stringify(seed.input)}`)
    return 'tree'
  } catch (error) {
    if (error instanceof ImportInputError) return 'typed-error'
    throw error
  }
}

function run(): void {
  const random = generator(0x0c2a2026)
  const count = process.argv.includes('--sample') ? 300 : 100_000
  let trees = 0
  let typedErrors = 0
  let writerRefusals = 0
  let suiteWriterRefusals = 0
  for (const seed of seeds) {
    const result = check(seed)
    if (result === 'typed-error') throw new Error(`Suite input failed: ${seed.from} ${JSON.stringify(seed.input)}`)
    if (result === 'writer-refusal') suiteWriterRefusals++
  }
  if (suiteWriterRefusals > MAX_SUITE_WRITER_REFUSALS) {
    throw new Error(`Suite writer refusals increased from ${MAX_SUITE_WRITER_REFUSALS} to ${suiteWriterRefusals}`)
  }
  for (let at = 0; at < count; at++) {
    const base = seeds[random() % seeds.length]
    if (base === undefined) throw new Error('No mutation seed')
    const result = check({ from: base.from, input: mutate(base.input, random) })
    if (result === 'tree') trees++
    else if (result === 'writer-refusal') writerRefusals++
    else typedErrors++
  }
  const result = { suiteInputs: seeds.length, suiteWriterRefusals, mutations: count, trees, typedErrors, writerRefusals }
  if (!process.argv.includes('--sample')) {
    writeFileSync(join(import.meta.dirname, '../docs/mutations.json'), `${JSON.stringify(result, null, 2)}\n`)
  }
  process.stdout.write(`${JSON.stringify(result)}\n`)
}

run()
