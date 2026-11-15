#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { Worker } from 'node:worker_threads'
import { type Finding } from './check.ts'
import { TARGETS, type Target } from './targets.ts'
import { generate, generateJson, loadCorpus, random } from './generate.ts'

interface Settings {
  target: Target
  seed: number
  count: number
  minutes: number
  maxBytes: number
  corpus?: string
}

function arg(name: string, fallback?: string): string {
  const at = process.argv.indexOf(name)
  const value = at < 0 ? fallback : process.argv[at + 1]
  if (value === undefined) throw new Error(`missing ${name}`)
  return value
}

function settings(): Settings {
  const target = arg('--target') as Target
  if (!TARGETS.includes(target)) throw new Error(`unknown target ${target}`)
  const seed = Number(arg('--seed'))
  const count = Number(arg('--count'))
  const minutes = Number(arg('--minutes', '0'))
  const maxBytes = Number(arg('--max-bytes', '32768'))
  if (![seed, count, minutes, maxBytes].every(Number.isFinite) || count < 0 || minutes < 0 || maxBytes < 1) {
    throw new Error('invalid numeric option')
  }
  const corpus = process.argv.includes('--corpus') ? arg('--corpus') : undefined
  return { target, seed, count, minutes, maxBytes, ...(corpus === undefined ? {} : { corpus }) }
}

function engineCommit(): string {
  const result = spawnSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' })
  return result.status === 0 ? result.stdout.trim() : 'unknown'
}

function cliCheck(source: string, seed: number): Finding | null {
  const rng = random(seed)
  const commands = ['render', 'ast', 'fmt', 'diagnostics', 'upgrade', '--help', '--bogus']
  const flags = ['--mode=static', '--mode=wrong', '--raw-html', '--normalize', '--check', '--from-ast',
    '--json', '--not-real', '--profile=minimal', '--heading-ids=ascii']
  const args = [commands[rng.int(commands.length)] ?? 'render']
  for (let at = 0; at < rng.int(6); at++) args.push(flags[rng.int(flags.length)] ?? '--not-real')
  args.push(rng.bool() ? '-' : '/no/such/carve-input.crv')
  const result = spawnSync(process.execPath, ['v2/cli/main.ts', ...args], {
    input: source, encoding: 'utf8', timeout: 3000, maxBuffer: 1024 * 1024,
  })
  if (result.error !== undefined) return { kind: 'cli-process-error', detail: String(result.error) }
  if (![0, 1, 2].includes(result.status ?? -1)) return { kind: 'cli-exit-code', detail: String(result.status) }
  if (result.stderr.includes('\n    at ')) return { kind: 'cli-stack-trace', detail: result.stderr.slice(0, 1000) }
  return null
}

class Checker {
  private worker: Worker | null = null
  private readonly target: Target

  constructor(target: Target) {
    this.target = target
    if (target !== 'cli') this.worker = new Worker(new URL('./case-worker.ts', import.meta.url))
  }

  check(source: string, seed: number): Promise<Finding | null> {
    if (this.target === 'cli') return Promise.resolve(cliCheck(source, seed))
    const worker = this.worker
    if (worker === null) return Promise.resolve({ kind: 'harness-exception', detail: 'missing worker' })
    return new Promise((resolve) => {
      const timeout = Math.max(3000, Buffer.byteLength(source) / 10240 * 500)
      const timer = setTimeout(() => {
        worker.removeAllListeners('message')
        worker.removeAllListeners('error')
        void worker.terminate().then(() => {
          this.worker = new Worker(new URL('./case-worker.ts', import.meta.url))
          resolve({ kind: 'no-termination', detail: `over ${timeout} ms` })
        }, (error: unknown) => resolve({ kind: 'worker-exception', detail: String(error) }))
      }, timeout)
      worker.once('message', (value: unknown) => {
        clearTimeout(timer)
        worker.removeAllListeners('error')
        resolve(value as Finding | null)
      })
      worker.once('error', (error: Error) => {
        clearTimeout(timer)
        worker.removeAllListeners('message')
        this.worker = new Worker(new URL('./case-worker.ts', import.meta.url))
        resolve({ kind: 'worker-exception', detail: String(error) })
      })
      worker.postMessage({ target: this.target, source, seed })
    })
  }

  async close(): Promise<void> {
    if (this.worker !== null) await this.worker.terminate()
  }
}

function signature(finding: Finding | null): string {
  if (finding === null) return ''
  if (finding.kind === 'render-invalid-html' || finding.kind === 'tabs-invalid-html') {
    return `${finding.kind}:${finding.detail.split(',')[0]}`
  }
  if (finding.kind === 'parse-invalid-tree') return `${finding.kind}:${finding.detail.split('\n')[0]}`
  if (finding.kind.startsWith('option-')) return `${finding.kind}:${finding.detail.split(':')[0]}`
  return finding.kind
}

async function same(checker: Checker, input: string, seed: number, wanted: string, deadline = Infinity): Promise<boolean> {
  if (Date.now() >= deadline) return false
  return signature(await checker.check(input, seed)) === wanted
}

async function bomWitness(checker: Checker, source: string, seed: number, wanted: string,
  deadline: number): Promise<string | null> {
  if ((!wanted.startsWith('parse-invalid-tree:') && wanted !== 'tabs-exception') || !source.startsWith('\ufeff')) return null
  for (const char of source.slice(1)) {
    if (Date.now() >= deadline) return null
    const candidate = '\ufeff' + char
    if (await same(checker, candidate, seed, wanted, deadline)) return candidate
  }
  return null
}

async function singleCharacterWitness(checker: Checker, source: string, seed: number, wanted: string,
  deadline: number): Promise<string> {
  const bom = await bomWitness(checker, source, seed, wanted, deadline)
  if (bom !== null) return bom
  if (!wanted.startsWith('render-invalid-html:') && !wanted.startsWith('tabs-invalid-html:')) return source
  for (const char of source) {
    if (Date.now() >= deadline) return source
    if (await same(checker, char, seed, wanted, deadline)) return char
  }
  return source
}

function sourceLines(input: string): string[] {
  const lines: string[] = []
  let start = 0
  for (let at = 0; at < input.length; at++) {
    if (input[at] !== '\n' && input[at] !== '\r') continue
    const end = input[at] === '\r' && input[at + 1] === '\n' ? at + 2 : at + 1
    lines.push(input.slice(start, end))
    start = end
    at = end - 1
  }
  if (start < input.length || lines.length === 0) lines.push(input.slice(start))
  return lines
}

async function removeLines(checker: Checker, input: string, seed: number, kind: string, deadline: number): Promise<string> {
  let lines = sourceLines(input)
  let width = Math.floor(lines.length / 2)
  while (width > 0) {
    let changed = false
    for (let at = 0; at < lines.length; at += width) {
      if (Date.now() >= deadline) return lines.join('')
      const next = [...lines.slice(0, at), ...lines.slice(at + width)]
      if (next.length > 0 && await same(checker, next.join(''), seed, kind, deadline)) {
        lines = next
        changed = true
        break
      }
    }
    if (!changed) width = Math.floor(width / 2)
  }
  return lines.join('')
}

async function removeBytes(checker: Checker, input: string, seed: number, kind: string, deadline: number): Promise<string> {
  if (Buffer.from(input).toString('utf8') !== input) return removeCodeUnits(checker, input, seed, kind, deadline)
  let bytes = Buffer.from(input)
  let width = bytes.length === 0 ? 0 : Math.max(1, Math.floor(bytes.length / 2))
  while (width > 0) {
    let changed = false
    for (let at = 0; at < bytes.length; at += width) {
      if (Date.now() >= deadline) return bytes.toString('utf8')
      const next = Buffer.concat([bytes.subarray(0, at), bytes.subarray(at + width)])
      if (await same(checker, next.toString('utf8'), seed, kind, deadline)) {
        bytes = next
        changed = true
        break
      }
    }
    if (!changed) width = Math.floor(width / 2)
  }
  return bytes.toString('utf8')
}

async function removeCodeUnits(checker: Checker, input: string, seed: number, kind: string,
  deadline: number): Promise<string> {
  let value = input
  let width = value.length === 0 ? 0 : Math.max(1, Math.floor(value.length / 2))
  while (width > 0) {
    let changed = false
    for (let at = 0; at < value.length; at += width) {
      if (Date.now() >= deadline) return value
      const next = value.slice(0, at) + value.slice(at + width)
      if (await same(checker, next, seed, kind, deadline)) {
        value = next
        changed = true
        break
      }
    }
    if (!changed) width = Math.floor(width / 2)
  }
  return value
}

async function save(checker: Checker, target: Target, source: string, seed: number,
  runSeed: number, finding: Finding, commit: string): Promise<string> {
  const path = join('v2/proptest/findings', target)
  mkdirSync(path, { recursive: true })
  const wanted = signature(finding)
  const deadline = Date.now() + 20_000
  const witness = await singleCharacterWitness(checker, source, seed, wanted, deadline)
  const lines = await removeLines(checker, witness, seed, wanted, deadline)
  const shrunk = await removeBytes(checker, lines, seed, wanted, deadline)
  const minimized = await same(checker, shrunk, seed, wanted) ? shrunk : source
  const reducedFinding = await checker.check(minimized, seed)
  const hash = createHash('sha256').update(wanted).update('\0').update(Buffer.from(minimized, 'utf16le'))
    .digest('hex').slice(0, 16)
  const file = join(path, `${hash}.crv`)
  if (!existsSync(file)) {
    writeFileSync(file, minimized)
    writeFileSync(`${file}.json`, JSON.stringify({ kind: finding.kind, detail: reducedFinding?.detail ?? finding.detail,
      seed, runSeed,
      engineCommit: commit, inputJson: minimized, originalBytes: Buffer.byteLength(source),
      minimizedBytes: Buffer.byteLength(minimized), minimizationTimedOut: Date.now() >= deadline }, null, 2) + '\n')
  }
  return file
}

async function replayOne(checker: Checker, options: Settings, replay: string): Promise<number> {
  const sidecar = `${replay}.json`
  const meta = existsSync(sidecar) ? JSON.parse(readFileSync(sidecar, 'utf8')) as { inputJson?: string, seed?: number } : {}
  const source = meta.inputJson ?? readFileSync(replay, 'utf8')
  const found = await checker.check(source, meta.seed ?? options.seed)
  console.log(found === null ? 'PASS' : JSON.stringify(found))
  return found === null ? 0 : 1
}

interface Counts { failures: number, known: number, losses: number, refusals: number }

function isKnown(target: Target, found: Finding): boolean {
  if (target !== 'render') return false
  return (found.kind === 'option-invalid-accepted' && (found.detail === 'rules' || found.detail === 'platforms')) ||
    (found.kind === 'option-invalid-error' && found.detail.startsWith('platforms:'))
}

async function recordFinding(checker: Checker, options: Settings, source: string, caseSeed: number,
  found: Finding, commit: string, coverageOnly: boolean, index: number, seen: Set<string>, allowKnown: boolean): Promise<Counts> {
  if (found.kind === 'writer-accounting') {
    return { failures: 0, known: 0, losses: found.losses ?? 0, refusals: found.refusals ?? 0 }
  }
  const key = signature(found)
  if (!coverageOnly && !seen.has(key)) {
    seen.add(key)
    const file = await save(checker, options.target, source, caseSeed, options.seed, found, commit)
    console.log(`${options.target} ${found.kind} seed=${options.seed} case=${index} file=${file}`)
  }
  const known = allowKnown && isKnown(options.target, found)
  return { failures: known ? 0 : 1, known: known ? 1 : 0, losses: 0, refusals: 0 }
}

async function main(): Promise<number> {
  const options = settings()
  const absent = ({ cli: 'v2/cli', lint: 'v2/lint', migrate: 'v2/migrate', import: 'import' } as Record<string, string>)[options.target]
  if (absent !== undefined && !existsSync(absent)) { console.log(`${options.target}: not built`); return 0 }
  const replay = process.argv.includes('--replay') ? arg('--replay') : undefined
  const checker = new Checker(options.target)
  if (replay !== undefined) {
    const result = await replayOne(checker, options, replay)
    await checker.close()
    return result
  }
  const corpus = loadCorpus(options.corpus)
  const coverageOnly = process.argv.includes('--coverage')
  const allowKnown = process.argv.includes('--allow-known')
  const rng = random(options.seed)
  const start = Date.now()
  const deadline = options.minutes > 0 ? start + options.minutes * 60_000 : Infinity
  const commit = engineCommit()
  let failures = 0
  let known = 0
  let writerLosses = 0
  let writerRefusals = 0
  const seen = new Set<string>()
  let cases = 0
  for (; cases < options.count && Date.now() < deadline; cases++) {
    const source = options.target === 'decode' || options.target === 'migrate' ?
      generateJson(rng, options.target === 'migrate') : generate(rng, corpus, options.maxBytes)
    const caseSeed = rng.int(0x7fffffff)
    const found = await checker.check(source, caseSeed)
    if (found === null) continue
    const result = await recordFinding(checker, options, source, caseSeed, found, commit, coverageOnly, cases, seen, allowKnown)
    failures += result.failures
    known += result.known
    writerLosses += result.losses
    writerRefusals += result.refusals
  }
  console.log(JSON.stringify({ target: options.target, seed: options.seed, cases, findings: failures, known,
    writerLosses, writerRefusals, seconds: (Date.now() - start) / 1000, engineCommit: commit, corpus: corpus.documents.length,
    dictionary: corpus.dictionary.length }))
  await checker.close()
  return failures === 0 ? 0 : 1
}

process.exitCode = await main()
