import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { format } from '../../v2/src/index.ts'
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

function check(seed: Seed): 'tree' | 'typed-error' {
  try {
    const result = importDocument(seed.input, { from: seed.from })
    if (format(result.source) !== result.source) throw new Error('source is not stable')
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
  for (const seed of seeds) {
    if (check(seed) !== 'tree') throw new Error(`Suite input failed: ${seed.from}`)
  }
  for (let at = 0; at < count; at++) {
    const base = seeds[random() % seeds.length]
    if (base === undefined) throw new Error('No mutation seed')
    const result = check({ from: base.from, input: mutate(base.input, random) })
    if (result === 'tree') trees++
    else typedErrors++
  }
  const result = { suiteInputs: seeds.length, mutations: count, trees, typedErrors }
  if (!process.argv.includes('--sample')) {
    writeFileSync(join(import.meta.dirname, '../docs/mutations.json'), `${JSON.stringify(result, null, 2)}\n`)
  }
  process.stdout.write(`${JSON.stringify(result)}\n`)
}

run()
