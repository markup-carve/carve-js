// Times the two block-pass variants against each other.
//   node --expose-gc spike/block-events/bench.mjs [--corpus DIR] [--realistic DIR] [--engine FILE]
//                                                  [--rounds N] [--sample-ms N]
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { constants, PerformanceObserver } from 'node:perf_hooks'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { buildTreeFromEvents, EventSink, parseDirect, parseViaEvents, parseViaReusedEvents, scanToEvents } from './src/index.ts'

const here = path.dirname(fileURLToPath(import.meta.url))
const self = fileURLToPath(import.meta.url)
const args = parseArgs(process.argv.slice(2))
const corpusDir = args.corpus ?? path.resolve(here, '../../../carve-bench/corpus')
const realisticDir = args.realistic ?? path.join(corpusDir, 'realistic')
const enginePath = args.engine ?? path.resolve(here, '../../dist/index.js')
const rounds = Number(args.rounds ?? 100)
const sampleMicros = Number(args['sample-ms'] ?? 20) * 1000
const collect = globalThis.gc

const inputs = [
  ['small.crv', path.join(corpusDir, 'small.crv')],
  ['large.crv', path.join(corpusDir, 'large.crv')],
  ['realistic/guide.crv', path.join(realisticDir, 'guide.crv')],
  ['realistic/migration.crv', path.join(realisticDir, 'migration.crv')],
  ['realistic/contract.crv', path.join(realisticDir, 'contract.crv')],
].filter(([name, file]) => existsSync(file) || (console.error(`skipped, not found: ${name} (${file})`), false))
  .map(([name, file]) => ({ name, src: readFileSync(file, 'utf8') }))

// Keeps results alive so the optimizer cannot drop the work.
let keep = null

if (args.child === 'timing') console.log(JSON.stringify(timeOneVariant(args.variant)))
else if (args.child === 'alloc') console.log(JSON.stringify(await measureAllocation()))
else await main()

async function main() {
  const loadBefore = loadAverage()
  const rows = []
  for (const input of inputs) {
    const direct = parseDirect(input.src)
    assert.deepStrictEqual(parseViaEvents(input.src), direct, `trees differ on ${input.name}`)
    assert.deepStrictEqual(parseViaReusedEvents(input.src), direct, `trees differ on ${input.name}`)
    rows.push({ ...describe(input), ...timePaired(input.src) })
  }
  const engine = await timeEngine()
  const loadAfterPaired = loadAverage()
  const isolated = {}
  for (const variant of ['fresh', 'reused', 'direct']) isolated[variant] = runChild(['--child=timing', `--variant=${variant}`])
  const alloc = runChild(['--child=alloc'], ['--max-semi-space-size=64', '--min-semi-space-size=64'])
  const loadAfter = loadAverage()

  console.log(`Node ${process.version}, V8 ${process.versions.v8}, ${os.cpus()[0].model.trim()}, ${os.cpus().length} logical CPUs.`)
  console.log(`Load average (1, 5, 15 min): ${loadBefore} at the start, ${loadAfterPaired} after the paired runs, ${loadAfter} at the end.`)
  console.log(`${rounds} paired rounds per input in rotating order, about ${sampleMicros / 1000} ms of CPU per sample.`)
  console.log('The trees of all variants were deep-equal on every input.\n')

  console.log('A fresh: events into a new array per parse, then the tree. A reused: the same with one array kept across parses. B: the tree directly.\n')
  console.log('Paired runs, CPU time per parse in microseconds (median over rounds):\n')
  console.log('| Input | Bytes | Lines | Nodes | Events | A fresh | A reused | B | A scan only | A build only | 0.1 `parse()` |')
  console.log('|---|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|')
  for (const row of rows) {
    console.log(`| ${row.name} | ${row.bytes} | ${row.lines} | ${row.nodes} | ${row.events} | ${micros(row.fresh)} | ${micros(row.reused)} | ` +
      `${micros(row.direct)} | ${micros(row.scan)} | ${micros(row.build)} | ${micros(engine[row.name])} |`)
  }

  console.log('\nPer-round ratio against B, median (middle half):\n')
  console.log('| Input | A fresh / B, CPU | A reused / B, CPU | A fresh / B, wall | A reused / B, wall |')
  console.log('|---|--:|--:|--:|--:|')
  for (const row of rows) {
    console.log(`| ${row.name} | ${spread(row.freshCpu)} | ${spread(row.reusedCpu)} | ${spread(row.freshWall)} | ${spread(row.reusedWall)} |`)
  }

  console.log('\nEach variant alone in its own process, CPU time per parse in microseconds (median of 40 samples, not paired):\n')
  console.log('| Input | A fresh | A reused | B | A fresh / B | A reused / B |')
  console.log('|---|--:|--:|--:|--:|--:|')
  for (const row of rows) {
    const fresh = isolated.fresh[row.name]
    const reused = isolated.reused[row.name]
    const direct = isolated.direct[row.name]
    console.log(`| ${row.name} | ${micros(fresh)} | ${micros(reused)} | ${micros(direct)} | ${(fresh / direct).toFixed(3)} | ${(reused / direct).toFixed(3)} |`)
  }

  console.log('\nBytes allocated per parse:\n')
  console.log('| Input | A heap | A event array (outside the heap) | B heap | Scavenges during the measurement |')
  console.log('|---|--:|--:|--:|--:|')
  for (const row of rows) {
    const m = alloc[row.name]
    console.log(`| ${row.name} | ${m.aHeap} | ${m.eventBytes} | ${m.bHeap} | ${m.scavenges} |`)
  }
}

function describe({ name, src }) {
  let nodes = 0
  const count = (node) => { nodes++; for (const child of node.children ?? []) count(child) }
  count(parseDirect(src))
  return { name, bytes: Buffer.byteLength(src), lines: src.split('\n').length, nodes, events: scanToEvents(src).length / 3 }
}

/** CPU and wall time per call, in microseconds, over `reps` calls. */
function sample(fn, reps) {
  const cpuStart = process.cpuUsage()
  const wallStart = process.hrtime.bigint()
  for (let i = 0; i < reps; i++) keep = fn()
  const wall = Number(process.hrtime.bigint() - wallStart) / 1000
  const cpu = process.cpuUsage(cpuStart)
  return { cpu: (cpu.user + cpu.system) / reps, wall: wall / reps }
}

/** Runs `fn` until it is optimized, then returns the repetitions that fill one sample. */
function warmUp(fn) {
  const end = process.hrtime.bigint() + 400_000_000n
  let calls = 0
  while (calls < 30 || process.hrtime.bigint() < end) { keep = fn(); calls++ }
  const probe = sample(fn, Math.max(3, Math.min(calls, 200)))
  return Math.max(1, Math.round(sampleMicros / probe.cpu))
}

function timePaired(src) {
  const events = scanToEvents(src)
  const scratch = new EventSink(src.length)
  const tasks = {
    fresh: () => parseViaEvents(src),
    reused: () => parseViaReusedEvents(src),
    direct: () => parseDirect(src),
    scan: () => { scratch.reset(); return scanToEvents(src, scratch) },
    build: () => buildTreeFromEvents(events),
  }
  const keys = Object.keys(tasks)
  const reps = {}
  const seen = { freshCpu: [], reusedCpu: [], freshWall: [], reusedWall: [] }
  for (const key of keys) {
    reps[key] = warmUp(tasks[key])
    seen[key] = []
  }
  collect?.()
  for (let round = 0; round < rounds; round++) {
    const got = {}
    for (let i = 0; i < keys.length; i++) {
      const key = keys[(i + round) % keys.length]
      got[key] = sample(tasks[key], reps[key])
    }
    for (const key of keys) seen[key].push(got[key].cpu)
    seen.freshCpu.push(got.fresh.cpu / got.direct.cpu)
    seen.reusedCpu.push(got.reused.cpu / got.direct.cpu)
    seen.freshWall.push(got.fresh.wall / got.direct.wall)
    seen.reusedWall.push(got.reused.wall / got.direct.wall)
  }
  const result = {}
  for (const key of keys) result[key] = median(seen[key])
  for (const key of ['freshCpu', 'reusedCpu', 'freshWall', 'reusedWall']) result[key] = quartiles(seen[key])
  return result
}

function timeOneVariant(variant) {
  const parse = { fresh: parseViaEvents, reused: parseViaReusedEvents, direct: parseDirect }[variant]
  const result = {}
  for (const { name, src } of inputs) {
    const fn = () => parse(src)
    const reps = warmUp(fn)
    const seen = []
    for (let i = 0; i < 40; i++) seen.push(sample(fn, reps).cpu)
    result[name] = median(seen)
  }
  return result
}

/** The 0.1 engine on the same inputs. It parses the full language, so this is a yardstick only. */
async function timeEngine() {
  const result = {}
  if (!existsSync(enginePath)) {
    console.error(`skipped the 0.1 engine, not built: ${enginePath}`)
    return result
  }
  const { parse } = await import(pathToFileURL(enginePath).href)
  for (const { name, src } of inputs) {
    const fn = () => parse(src)
    const reps = warmUp(fn)
    const seen = []
    for (let i = 0; i < 15; i++) seen.push(sample(fn, reps).cpu)
    result[name] = median(seen)
  }
  return result
}

/**
 * Heap growth over a few parses with no collection in between. The child runs
 * with a 64 MB young generation so that none happens; a scavenge that slips
 * in is counted and reported. The event array lives outside the heap, so its
 * size is taken from the array itself.
 */
async function measureAllocation() {
  assert(collect, 'the allocation run needs --expose-gc')
  let scavenges = 0
  const observer = new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) if (entry.detail.kind === constants.NODE_PERFORMANCE_GC_MINOR) scavenges++
  })
  observer.observe({ entryTypes: ['gc'] })
  const result = {}
  for (const { name, src } of inputs) {
    const parses = Math.max(1, Math.min(500, Math.floor(16e6 / (src.length * 40))))
    const warmUps = Math.max(30, Math.min(2000, Math.floor(3e7 / src.length)))
    const heapGrowth = async (fn) => {
      for (let i = 0; i < warmUps; i++) keep = fn()
      collect()
      await settle()
      const scavengesBefore = scavenges
      const before = process.memoryUsage().heapUsed
      for (let i = 0; i < parses; i++) keep = fn()
      const bytes = Math.round((process.memoryUsage().heapUsed - before) / parses)
      await settle()
      return { bytes, scavenges: scavenges - scavengesBefore }
    }
    const a = await heapGrowth(() => parseViaReusedEvents(src))
    const b = await heapGrowth(() => parseDirect(src))
    result[name] = { aHeap: a.bytes, bHeap: b.bytes, eventBytes: scanToEvents(src).data.byteLength, scavenges: a.scavenges + b.scavenges }
  }
  return result
}

function settle() {
  return new Promise((resolve) => setTimeout(resolve, 30))
}

function runChild(childArgs, nodeArgs = []) {
  const passed = Object.entries(args).filter(([key]) => key !== 'child' && key !== 'variant').map(([key, value]) => `--${key}=${value}`)
  const child = spawnSync(process.execPath, ['--expose-gc', ...nodeArgs, self, ...childArgs, ...passed], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] })
  assert.equal(child.status, 0, `child run failed: ${childArgs.join(' ')}`)
  return JSON.parse(child.stdout)
}

function parseArgs(list) {
  const out = {}
  for (let i = 0; i < list.length; i++) {
    const [key, value] = list[i].replace(/^--/, '').split('=')
    out[key] = value ?? list[++i]
  }
  return out
}

function loadAverage() {
  return readFileSync('/proc/loadavg', 'utf8').split(' ').slice(0, 3).join(' ')
}

function median(values) {
  return quartiles(values).median
}

function quartiles(values) {
  const sorted = [...values].sort((x, y) => x - y)
  const at = (q) => {
    const index = (sorted.length - 1) * q
    const low = Math.floor(index)
    return sorted[low] + (sorted[Math.min(low + 1, sorted.length - 1)] - sorted[low]) * (index - low)
  }
  return { q1: at(0.25), median: at(0.5), q3: at(0.75) }
}

function spread({ q1, median: mid, q3 }) {
  return `${mid.toFixed(3)} (${q1.toFixed(3)} to ${q3.toFixed(3)})`
}

function micros(value) {
  if (value === undefined) return 'n/a'
  return value >= 100 ? value.toFixed(0) : value.toFixed(2)
}
