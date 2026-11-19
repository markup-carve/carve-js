#!/usr/bin/env node
// Deterministic source mutations of the 0.2 block parser, inline parser and HTML renderer.
// Each mutant runs in a private copy so concurrent checkouts never see changed engine source.
import { execFile, execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const execute = promisify(execFile)

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const baselinePath = join(repo, 'data/mutation-baseline.json')
const ignored = JSON.parse(readFileSync(join(repo, 'data/mutation-ignore.json'), 'utf8'))
// Copied per workspace so a mutant never reaches the checkout; the rest is shared read-only.
const ENGINE_DIRS = ['src', 'test', 'data', 'scripts', 'cli', 'lint', 'migrate', 'public', 'extensions', 'proptest']
const SHARED_DIRS = ['node_modules', 'import', 'upgrade', 'build', 'dist', 'spec']
const mutations = [
  { id: 'block-eof', file: 'blocks.ts', from: 'if (lineEnd < 0) lineEnd = length', to: 'if (lineEnd < 0) lineEnd = length - 1' },
  { id: 'block-crlf', file: 'blocks.ts', from: 'src.charCodeAt(lineEnd - 1) === CR', to: 'src.charCodeAt(lineEnd - 1) !== CR' },
  { id: 'block-frontmatter', file: 'blocks.ts', from: 'if (!isFrontmatterOpener(src, pos, end)) return false', to: 'if (isFrontmatterOpener(src, pos, end)) return false' },
  { id: 'block-lazy', file: 'blocks.ts', from: 'if (interruptsLeaf(state, matched, lineStart, end)) return false', to: 'if (!interruptsLeaf(state, matched, lineStart, end)) return false' },
  { id: 'block-blank', file: 'blocks.ts', from: 'if (blank) return blankLine(state, matched)', to: 'if (!blank) return blankLine(state, matched)' },
  { id: 'block-heading', file: 'blocks.ts', from: 'leaf.kind === HEADING && !continuesHeading(state, matched)', to: 'leaf.kind === HEADING && continuesHeading(state, matched)' },
  { id: 'inline-code', file: 'inline-scan.ts', from: 'table[BACKTICK] = scanBacktick', to: 'table[BACKTICK] = scanBareMark' },
  { id: 'inline-break', file: 'inline-scan.ts', from: 'table[LF] = scanLineBreak', to: 'table[LF] = scanBareMark' },
  { id: 'inline-image', file: 'inline-scan.ts', from: 'return next === BRACKET_OPEN ? scanImageOpen(state, pos) : pos + 1', to: 'return next !== BRACKET_OPEN ? scanImageOpen(state, pos) : pos + 1' },
  { id: 'inline-plain', file: 'inline-scan.ts', from: 'return starts === 0 && !smart ? 1 : 0', to: 'return starts === 0 || !smart ? 1 : 0' },
  { id: 'inline-plain-class', file: 'inline-scan.ts', from: 'ALWAYS_TEXT[code] === 0) return false', to: 'ALWAYS_TEXT[code] === 1) return false' },
  { id: 'inline-bracket-close', file: 'inline-scan.ts', from: 'table[BRACKET_CLOSE] = scanBracketClose', to: 'table[BRACKET_CLOSE] = scanBracketOpen' },
  { id: 'html-indent', file: 'html.ts', from: 'level < CACHED_LEVELS ? LINE_STARTS[level]!', to: 'level <= CACHED_LEVELS ? LINE_STARTS[level]!' },
  { id: 'html-comments', file: 'html.ts', from: "if (INVISIBLE.includes(node.type)) return false", to: "if (INVISIBLE.includes(node.type)) return true" },
  { id: 'html-image', file: 'html.ts', from: "node.type === 'paragraph' && !isBareImage(node)", to: "node.type === 'paragraph' && isBareImage(node)" },
  { id: 'html-caption', file: 'html.ts', from: "node.type === 'paragraph' && !isBareImage(node) && node.caption === undefined", to: "node.type === 'paragraph' && !isBareImage(node) && node.caption !== undefined" },
  { id: 'html-comment-break', file: 'html.ts', from: "child.type !== 'soft_break' && child.type !== 'hard_break'", to: "child.type !== 'soft_break' || child.type !== 'hard_break'" },
  { id: 'html-text-paragraph', file: 'html.ts', from: "node.type !== 'paragraph' || !onlyComments(node.children)", to: "node.type === 'paragraph' || !onlyComments(node.children)" },
]

async function run(cwd, argv, timeout = 240_000) {
  try {
    const result = await execute(process.execPath, argv, { cwd, encoding: 'utf8', timeout, maxBuffer: 16 << 20 })
    return { ok: true, timedOut: false, output: `${result.stdout}\n${result.stderr}` }
  } catch (error) {
    return { ok: false, timedOut: error.killed === true, output: `${error.stdout ?? ''}\n${error.stderr ?? ''}\n${error}` }
  }
}

function workspace() {
  const root = mkdtempSync(join(tmpdir(), 'carve-mutation-'))
  for (const dir of ENGINE_DIRS) cpSync(join(repo, dir), join(root, dir), { recursive: true })
  for (const dir of SHARED_DIRS) if (existsSync(join(repo, dir))) symlinkSync(join(repo, dir), join(root, dir), 'dir')
  writeFileSync(join(root, 'package.json'), '{"type":"module"}\n')
  writeFileSync(join(root, 'vitest.config.mjs'),
    "export default { test: { include: ['test/**/*.test.ts'], maxWorkers: 1, minWorkers: 1, isolate: false } }\n")
  return root
}

async function check(root) {
  const corpus = await run(root, ['scripts/mutation-corpus.ts'])
  if (!corpus.ok) return { ...corpus, by: 'corpus' }
  const tests = await run(root, [join(repo, 'node_modules/vitest/vitest.mjs'), 'run',
    'test/clauses.test.ts', 'test/html-clauses.test.ts', '--config', 'vitest.config.mjs'])
  return { ...tests, by: 'engine tests' }
}

const roots = Array.from({ length: 4 }, workspace)
const control = await check(roots[0])
if (!control.ok) {
  console.error(`mutation-gate: unmodified control failed in ${control.by}\n${control.output.slice(-3000)}`)
  process.exit(1)
}

const queue = [...mutations]
const results = []
await Promise.all(roots.map(async (root) => {
  for (let mutation = queue.shift(); mutation; mutation = queue.shift()) {
    const path = join(root, 'src', mutation.file)
    const original = readFileSync(path, 'utf8')
    if (original.split(mutation.from).length !== 2) throw new Error(`${mutation.id}: source anchor is not unique`)
    writeFileSync(path, original.replace(mutation.from, mutation.to))
    let result
    try { result = await check(root) } finally { writeFileSync(path, original) }
    const status = result.timedOut ? 'timed-out' : result.ok ? 'survived' : 'killed'
    results.push({ id: mutation.id, file: mutation.file, status, by: result.by })
    console.log(`${mutation.id}\t${mutation.file}\t${status}\t${result.by}`)
  }
}))
results.sort((a, b) => mutations.findIndex((mutation) => mutation.id === a.id) - mutations.findIndex((mutation) => mutation.id === b.id))

const ids = new Set(mutations.map((mutation) => mutation.id))
for (const id of Object.keys(ignored)) if (!ids.has(id)) throw new Error(`${id}: ignored mutant no longer exists`)
for (const [id, reason] of Object.entries(ignored)) if (typeof reason !== 'string' || !reason.trim()) {
  throw new Error(`${id}: ignored mutant needs a reason`)
}
for (const id of Object.keys(ignored)) if (results.find((result) => result.id === id)?.status !== 'survived') {
  throw new Error(`${id}: ignored mutant no longer survives; remove its equivalent classification`)
}
const counted = results.filter((result) => ignored[result.id] === undefined)
if (counted.length === 0) throw new Error('mutation-gate: no non-equivalent mutants')
const killed = counted.filter((result) => result.status === 'killed').length
const timedOut = counted.filter((result) => result.status === 'timed-out').length
const rate = killed / counted.length
for (const file of [...new Set(results.map((result) => result.file))]) {
  const moduleResults = results.filter((result) => result.file === file)
  const counts = Object.fromEntries(['killed', 'survived', 'timed-out'].map((status) =>
    [status, moduleResults.filter((result) => result.status === status).length]))
  console.log(`${file}: total=${moduleResults.length} killed=${counts.killed} survived=${counts.survived} timed-out=${counts['timed-out']}`)
}
console.log(`mutation-gate: total=${results.length} killed=${killed} timed-out=${timedOut} survived=${counted.length - killed - timedOut} equivalent=${results.length - counted.length} rate=${rate.toFixed(3)}`)
if (timedOut) {
  console.error(`mutation-gate: ${timedOut} mutant(s) timed out`)
  process.exit(1)
}
if (process.argv.includes('--write')) {
  writeFileSync(baselinePath, `${JSON.stringify({ killed: counted.filter((result) => result.status === 'killed').map((result) => result.id),
    minimumRate: rate }, null, 2)}\n`)
} else {
  const baseline = JSON.parse(readFileSync(baselinePath, 'utf8'))
  const base = process.argv.find((arg) => arg.startsWith('--base='))?.slice('--base='.length)
  let previous
  if (base) {
    execFileSync('git', ['rev-parse', '--verify', `${base}^{commit}`], { cwd: repo, stdio: 'ignore' })
    let present = true
    try {
      execFileSync('git', ['cat-file', '-e', `${base}:data/mutation-baseline.json`], { cwd: repo, stdio: 'ignore' })
    } catch {
      present = false // The introducing PR has no baseline on its base branch.
    }
    if (present) previous = JSON.parse(execFileSync('git', ['show', `${base}:data/mutation-baseline.json`],
      { cwd: repo, encoding: 'utf8' }))
  }
  for (const id of new Set([...baseline.killed, ...(previous?.killed ?? [])])) if (results.find((result) => result.id === id)?.status !== 'killed') {
    console.error(`mutation-gate: formerly killed mutant survived: ${id}`)
    process.exitCode = 1
  }
  const floor = Math.max(baseline.minimumRate, previous?.minimumRate ?? 0)
  if (rate < floor) {
    console.error(`mutation-gate: kill rate ${rate.toFixed(3)} fell below ${floor.toFixed(3)}`)
    process.exitCode = 1
  }
}
