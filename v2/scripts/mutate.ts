// Mutation check: applies small semantic mutations to the scanner sources, one at a time, on
// temporary copies of v2/, runs the clause and example tests on each and lists the survivors.
//   node v2/scripts/mutate.ts [--jobs N] [--only TEXT] [--shard K/N]
// A survivor is a mutation no test notices. Each survivor is then compared with the unchanged
// engine on every document of up to three lines over the enumerator alphabet: when the events
// differ, a test is missing and the smallest differing document is printed; when they are the
// same, the mutation changes nothing those documents can show.
// At most four test runners work at a time, each in one process, and all of them are killed
// when this script ends or is interrupted.
import { type ChildProcess, spawn } from 'node:child_process'
import { cpSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const FILES = ['src/blocks.ts', 'src/lines.ts', 'src/tree.ts']
const MAX_JOBS = 4
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
  // The smallest enumerated document that tells the mutation from the original, or ''.
  witness: string
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
        found.push({ file, line: index + 1, before: line.trim(), after: mutated[index]!.trim(), text: mutated.join('\n'), witness: '' })
      }
    }
  })
  return found
}

const children = new Set<ChildProcess>()

function killChildren(): void {
  for (const child of children) {
    try {
      process.kill(-child.pid!, 'SIGKILL')
    } catch {
      // The process group is gone already.
    }
  }
}

process.on('exit', killChildren)
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) process.on(signal, () => process.exit(130))

/** Runs a command in its own process group and resolves its exit code and output. */
function run(command: string, args: string[], seconds: number): Promise<{ code: number, output: string }> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { detached: true, stdio: ['ignore', 'pipe', 'ignore'] })
    children.add(child)
    let output = ''
    child.stdout.on('data', (chunk: Buffer) => {
      output += chunk.toString()
    })
    const timer = setTimeout(() => {
      try {
        process.kill(-child.pid!, 'SIGKILL')
      } catch {
        // Gone already.
      }
    }, seconds * 1000)
    child.on('exit', (code) => {
      clearTimeout(timer)
      children.delete(child)
      resolve({ code: code ?? 1, output })
    })
  })
}

/** Runs the tests in a copy of v2/ that holds one mutation. Resolves true when they pass. */
async function survives(copy: string, original: Map<string, string>, mutation: Mutation): Promise<boolean> {
  for (const [file, text] of original) writeFileSync(join(copy, file), file === mutation.file ? mutation.text : text)
  const vitest = join(copy, 'node_modules/.bin/vitest')
  const args = ['run', '--root', copy, '--pool=forks', '--poolOptions.forks.singleFork', ...TESTS]
  if ((await run(vitest, args, 90)).code !== 0) return false
  const compared = await run(process.execPath, [join(v2, 'scripts/compare-events.ts'), copy], 120)
  mutation.witness = compared.code === 0 ? '' : compared.output.trim() || '(the mutated engine did not finish)'
  return true
}

const v2 = join(import.meta.dirname, '..')
const only = option('only', '')
const jobs = Math.min(MAX_JOBS, Math.max(1, Number(option('jobs', String(MAX_JOBS)))))
const [shard, shards] = option('shard', '1/1').split('/').map(Number) as [number, number]
const original = new Map(FILES.map((file) => [file, readFileSync(join(v2, file), 'utf8')]))
const mutations = FILES.flatMap((file) => mutationsOf(v2, file))
  .filter((mutation) => `${mutation.file}:${mutation.line} ${mutation.before}`.includes(only))
  .filter((_, index) => index % shards === shard - 1)
const survivors: Mutation[] = []
let next = 0

async function worker(): Promise<void> {
  const copy = mkdtempSync(join(tmpdir(), 'carve-v2-mutate-'))
  cpSync(v2, copy, { recursive: true })
  symlinkSync(join(v2, '../node_modules'), join(copy, 'node_modules'))
  while (next < mutations.length) {
    const mutation = mutations[next++]!
    if (!(await survives(copy, original, mutation))) continue
    survivors.push(mutation)
    // Printed as found, so a run that is cut short still shows what it reached.
    console.log(`${mutation.file}:${mutation.line}${mutation.witness === '' ? '' : `  differs on ${mutation.witness}`}`)
    console.log(`  - ${mutation.before}\n  + ${mutation.after}`)
  }
}

await Promise.all(Array.from({ length: jobs }, worker))
const missing = survivors.filter((survivor) => survivor.witness !== '')
console.log(
  `${mutations.length} mutations, ${mutations.length - survivors.length} killed by the tests, ` +
  `${missing.length} need a test, ${survivors.length - missing.length} change no enumerated document`,
)
process.exitCode = missing.length > 0 ? 1 : 0
