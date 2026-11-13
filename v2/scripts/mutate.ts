// Mutation check: applies small semantic mutations to the scanner sources, one at a time, on
// temporary copies of v2/, runs the clause and example tests on each and lists the survivors.
//   node v2/scripts/mutate.ts [--jobs N] [--only TEXT]
// A survivor is a mutation no test notices: a missing test, or a change that cannot be observed.
import { spawn } from 'node:child_process'
import { cpSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs'
import { availableParallelism, tmpdir } from 'node:os'
import { join } from 'node:path'

const FILES = ['src/blocks.ts', 'src/lines.ts']
const TESTS = ['test/clauses.test.ts', 'test/examples.test.ts']

// [text to find, replacement]: flipped and shifted comparisons, off-by-one offsets, swapped connectives.
const OPERATORS: readonly (readonly [string, string])[] = [
  [' <= ', ' < '], [' < ', ' <= '], [' >= ', ' > '], [' > ', ' >= '],
  [' === ', ' !== '], [' !== ', ' === '],
  [' + 1', ' + 2'], [' - 1', ' - 2'], [' && ', ' || '], [' || ', ' && '],
  ['return true', 'return false'], ['return false', 'return true'], ['return -1', 'return 0'],
]

interface Mutation {
  file: string
  line: number
  before: string
  after: string
  text: string
}

function option(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`)
  return at >= 0 && at + 1 < process.argv.length ? process.argv[at + 1]! : fallback
}

function isCode(line: string): boolean {
  const trimmed = line.trimStart()
  return !(trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*') || trimmed.startsWith('import'))
}

function mutationsOf(root: string, file: string): Mutation[] {
  const lines = readFileSync(join(root, file), 'utf8').split('\n')
  const found: Mutation[] = []
  lines.forEach((line, index) => {
    if (!isCode(line)) return
    for (const [before, after] of OPERATORS) {
      for (let at = line.indexOf(before); at >= 0; at = line.indexOf(before, at + 1)) {
        const mutated = lines.slice()
        mutated[index] = line.slice(0, at) + after + line.slice(at + before.length)
        found.push({ file, line: index + 1, before: line.trim(), after: mutated[index]!.trim(), text: mutated.join('\n') })
      }
    }
  })
  return found
}

/** Runs the tests in a copy of v2/ that holds one mutation. Resolves true when they pass. */
function survives(copy: string, original: Map<string, string>, mutation: Mutation): Promise<boolean> {
  for (const [file, text] of original) writeFileSync(join(copy, file), file === mutation.file ? mutation.text : text)
  return new Promise((resolve) => {
    const vitest = join(copy, 'node_modules/.bin/vitest')
    const child = spawn(vitest, ['run', '--root', copy, '--no-file-parallelism', ...TESTS], { stdio: 'ignore' })
    const timer = setTimeout(() => child.kill('SIGKILL'), 60_000)
    child.on('exit', (code) => {
      clearTimeout(timer)
      resolve(code === 0)
    })
  })
}

const v2 = join(import.meta.dirname, '..')
const only = option('only', '')
const jobs = Number(option('jobs', String(Math.max(1, availableParallelism() >> 1))))
const original = new Map(FILES.map((file) => [file, readFileSync(join(v2, file), 'utf8')]))
const mutations = FILES.flatMap((file) => mutationsOf(v2, file)).filter((m) => `${m.file}:${m.line} ${m.before}`.includes(only))
const survivors: Mutation[] = []
let next = 0

async function worker(): Promise<void> {
  const copy = mkdtempSync(join(tmpdir(), 'carve-v2-mutate-'))
  cpSync(v2, copy, { recursive: true })
  symlinkSync(join(v2, '../node_modules'), join(copy, 'node_modules'))
  while (next < mutations.length) {
    const mutation = mutations[next++]!
    if (await survives(copy, original, mutation)) survivors.push(mutation)
  }
}

await Promise.all(Array.from({ length: jobs }, worker))
survivors.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line)
console.log(`${mutations.length} mutations, ${mutations.length - survivors.length} killed, ${survivors.length} survived`)
for (const survivor of survivors) {
  console.log(`${survivor.file}:${survivor.line}\n  - ${survivor.before}\n  + ${survivor.after}`)
}
process.exitCode = survivors.length > 0 ? 1 : 0
