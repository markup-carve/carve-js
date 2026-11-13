// CPU time of the block pass per parse. Run by hand; not part of CI.
//   node v2/scripts/bench.ts [--corpus DIR] [--realistic DIR] [--spike DIR] [--rounds N] [--sample-ms N]
// `--corpus` holds small.crv and large.crv of carve-bench (default: ../carve-bench/corpus),
// `--realistic` the Track D documents guide.crv, migration.crv and contract.crv
// (default: <corpus>/realistic). Missing files are skipped. `--spike` is the `src` directory of the
// phase 0 spike (branch spike/0.2-block-events, spike/block-events/src): its scanner then runs in
// the same process and rounds, writing events into its own reused array.
import { existsSync, readFileSync } from 'node:fs'
import { cpus, loadavg } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { acquireState, buildTree, EVENT_WIDTH, releaseState, scanBlocks } from '../src/index.ts'

function option(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`)
  return at >= 0 && at + 1 < process.argv.length ? process.argv[at + 1]! : fallback
}

const corpus = option('corpus', join(import.meta.dirname, '../../../carve-bench/corpus'))
const realistic = option('realistic', join(corpus, 'realistic'))
const rounds = Number(option('rounds', '50'))
const sampleMicros = Number(option('sample-ms', '20')) * 1000

interface SpikeSink {
  reset(): void
}

interface SpikeModules {
  EventSink: new (sourceLength: number) => SpikeSink
  BlockScanner: new (src: string, sink: SpikeSink) => { scan(): void }
}

async function loadSpike(directory: string): Promise<SpikeModules | null> {
  if (directory === '') return null
  const events = await import(pathToFileURL(join(directory, 'events.ts')).href) as Pick<SpikeModules, 'EventSink'>
  const scanner = await import(pathToFileURL(join(directory, 'scanner.ts')).href) as Pick<SpikeModules, 'BlockScanner'>
  return { EventSink: events.EventSink, BlockScanner: scanner.BlockScanner }
}

const spike = await loadSpike(option('spike', ''))

const files = [
  join(corpus, 'small.crv'), join(corpus, 'large.crv'),
  join(realistic, 'guide.crv'), join(realistic, 'migration.crv'), join(realistic, 'contract.crv'),
]

function load(): string {
  return loadavg().map((n) => n.toFixed(2)).join(' ')
}

function cpuMicros(): number {
  const usage = process.cpuUsage()
  return usage.user + usage.system
}

/** CPU microseconds per call, from enough calls to fill one sample. */
function sample(task: () => void): number {
  let calls = 0
  const start = cpuMicros()
  let used = 0
  while (used < sampleMicros) {
    task()
    calls++
    used = cpuMicros() - start
  }
  return used / calls
}

function median(values: number[]): number {
  const sorted = values.slice().sort((a, b) => a - b)
  const middle = sorted.length >> 1
  return sorted.length % 2 === 1 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2
}

console.log(`Node ${process.version}, ${cpus()[0]?.model ?? 'unknown CPU'}, ${cpus().length} logical CPUs`)
console.log(`Load average (1, 5, 15 min) at the start: ${load()}`)
console.log(`${rounds} rounds per input, about ${sampleMicros / 1000} ms of CPU per sample, median in microseconds per parse`)
console.log('')
console.log('| Input | Bytes | Lines | Events | Scan | Scan and tree | Spike scan |')
console.log('|---|--:|--:|--:|--:|--:|--:|')

const state = acquireState()
for (const file of files) {
  if (!existsSync(file)) {
    console.log(`| ${file} | missing | | | | | |`)
    continue
  }
  const src = readFileSync(file, 'utf8')
  const scan = (): void => scanBlocks(state, src)
  const scanAndTree = (): void => {
    scanBlocks(state, src)
    buildTree(state.events, state.eventLength)
  }
  const spikeSink = spike === null ? null : new spike.EventSink(src.length)
  const spikeScan = (): void => {
    spikeSink!.reset()
    new spike!.BlockScanner(src, spikeSink!).scan()
  }
  sample(scan)
  sample(scanAndTree)
  if (spike !== null) sample(spikeScan)
  const scanTimes: number[] = []
  const treeTimes: number[] = []
  const spikeTimes: number[] = []
  for (let round = 0; round < rounds; round++) {
    scanTimes.push(sample(scan))
    treeTimes.push(sample(scanAndTree))
    if (spike !== null) spikeTimes.push(sample(spikeScan))
  }
  scanBlocks(state, src)
  const name = file.split('/').slice(-1)[0]!
  console.log(
    `| ${name} | ${Buffer.byteLength(src)} | ${state.lineCount} | ${state.eventLength / EVENT_WIDTH} | ` +
    `${median(scanTimes).toFixed(2)} | ${median(treeTimes).toFixed(2)} | ` +
    `${spike === null ? '' : median(spikeTimes).toFixed(2)} |`,
  )
}
releaseState(state)
console.log('')
console.log(`Load average at the end: ${load()}`)
