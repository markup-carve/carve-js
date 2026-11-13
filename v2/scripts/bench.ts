// CPU time of the block pass and of the inline pass per parse. CI runs it and prints the numbers;
// nothing fails on them.
//   node v2/scripts/bench.ts [--corpus DIR] [--realistic DIR] [--files A,B] [--spike DIR] [--rounds N] [--sample-ms N]
// `--corpus` holds small.crv and large.crv of carve-bench (default: ../carve-bench/corpus),
// `--realistic` the Track D documents guide.crv, migration.crv and contract.crv
// (default: <corpus>/realistic). Missing files are skipped. `--spike` is the `src` directory of the
// phase 0 spike (branch spike/0.2-block-events, spike/block-events/src): its scanner then runs in
// the same process and rounds, writing events into its own reused array.
import { existsSync, readFileSync } from 'node:fs'
import { cpus, loadavg } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  acquireInlineState, acquireState, type BlockNode, buildTree, CAPTION, CELL, DIV, DOCUMENT, EVENT_WIDTH, HEADING,
  LINE_BLOCK, PARAGRAPH, parseTree, releaseInlineState, releaseState, scanBlocks, scanInline, TERM,
} from '../src/index.ts'

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

// `--files A,B` replaces the default inputs, for a runner that has no carve-bench checkout.
const listed = option('files', '')
const files = listed !== '' ? listed.split(',') : [
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
console.log('| Input | Bytes | Lines | Events | Scan | Scan and tree | Spike scan | Contents | Inline events | Inline scan | Tree with inlines |')
console.log('|---|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|')

/** One inline content: the spans of its leaf, the range of them it takes, and how it is read. */
interface Content {
  spans: number[]
  from: number
  to: number
  depth: number
  lineComments: boolean
}

/** The contents the inline pass reads in the tree below `node`, as src/tree.ts finds them. */
function contentsOf(node: BlockNode, depth: number, out: Content[]): Content[] {
  const spans = node.spans ?? []
  if (node.children !== null) {
    const inner = node.kind > DOCUMENT && node.kind <= DIV ? depth + 1 : depth
    for (const child of node.children) contentsOf(child, inner, out)
  } else if (node.kind === LINE_BLOCK) {
    for (let at = 0; at < spans.length; at += 2) out.push({ spans, from: at, to: at + 2, depth, lineComments: false })
  } else if ([PARAGRAPH, HEADING, TERM, CAPTION, CELL].includes(node.kind)) {
    out.push({ spans, from: 0, to: spans.length, depth, lineComments: true })
  }
  return out
}

const state = acquireState()
const inlineState = acquireInlineState()
for (const file of files) {
  if (!existsSync(file)) {
    console.log(`| ${file} | missing | | | | | | | | | |`)
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
  // The inline pass alone: every content of the document, on one reused state, with no tree built.
  scanBlocks(state, src)
  const contents = contentsOf(buildTree(state.events, state.eventLength), 0, [])
  let inlineEvents = 0
  const inlineScan = (): void => {
    inlineEvents = 0
    for (const content of contents) {
      scanInline(inlineState, src, content.spans, content.from, content.to, content.depth, content.lineComments)
      inlineEvents += inlineState.eventLength
    }
  }
  const fullTree = (): void => {
    parseTree(src)
  }
  sample(scan)
  sample(scanAndTree)
  sample(inlineScan)
  sample(fullTree)
  if (spike !== null) sample(spikeScan)
  const scanTimes: number[] = []
  const treeTimes: number[] = []
  const spikeTimes: number[] = []
  const inlineTimes: number[] = []
  const fullTimes: number[] = []
  for (let round = 0; round < rounds; round++) {
    scanTimes.push(sample(scan))
    treeTimes.push(sample(scanAndTree))
    inlineTimes.push(sample(inlineScan))
    fullTimes.push(sample(fullTree))
    if (spike !== null) spikeTimes.push(sample(spikeScan))
  }
  scanBlocks(state, src)
  const name = file.split('/').slice(-1)[0]!
  console.log(
    `| ${name} | ${Buffer.byteLength(src)} | ${state.lineCount} | ${state.eventLength / EVENT_WIDTH} | ` +
    `${median(scanTimes).toFixed(2)} | ${median(treeTimes).toFixed(2)} | ` +
    `${spike === null ? '' : median(spikeTimes).toFixed(2)} | ${contents.length} | ${inlineEvents / EVENT_WIDTH} | ` +
    `${median(inlineTimes).toFixed(2)} | ${median(fullTimes).toFixed(2)} |`,
  )
}
releaseState(state)
releaseInlineState(inlineState)
console.log('')
console.log(`Load average at the end: ${load()}`)
