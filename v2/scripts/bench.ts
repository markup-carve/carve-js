// CPU time of the block pass and of the inline pass per parse. CI runs it and prints the numbers;
// nothing fails on them.
//   node v2/scripts/bench.ts [--corpus DIR] [--realistic DIR] [--files A,B] [--spike DIR] [--old FILE] [--rounds N] [--sample-ms N]
// `--corpus` holds small.crv and large.crv of carve-bench (default: ../carve-bench/corpus),
// `--realistic` the Track D documents guide.crv, migration.crv and contract.crv
// (default: <corpus>/realistic). Missing files are skipped. `--spike` is the `src` directory of the
// phase 0 spike (branch spike/0.2-block-events, spike/block-events/src): its scanner then runs in
// the same process and rounds, writing events into its own reused array.
// A second table gives source to HTML: `parse` (the public tree with positions) and `render` of
// this engine, and `carveToHtml` of the 0.1 engine of this repository, as time per document and
// as a ratio. `--old` is the built entry of the 0.1 engine (default: ../../dist/index.js, which
// `npm run build` writes); without it the two columns stay empty.
// A third table gives source to HTML of this engine against djot.js, markdown-it and commonmark.js
// on the same inputs. An engine reads an input in its own language only, so a document with no
// file in that language beside it is left out for that engine, with a note below the table.
// The times are CPU time of the process, which counts the collector threads too, and on a kernel
// that accounts CPU time by ticks a sample of 20 ms is too short: pass `--sample-ms 200` there.
//
// A fourth table gives source to canonical source: `parseWithLayout` (the tree with its
// source-layout record) and `format` of this engine, and `carveToCarve` of the 0.1 engine.
import { existsSync, readFileSync } from 'node:fs'
import { cpus, loadavg } from 'node:os'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  acquireInlineState, acquireState, type BlockNode, buildTree, CAPTION, CELL, DIV, DOCUMENT, EVENT_WIDTH, HEADING,
  format, LINE_BLOCK, PARAGRAPH, parse, parseTree, parseWithLayout, releaseInlineState, releaseState, render, scanBlocks,
  scanInline, TERM,
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

interface OldEngine {
  carveToHtml(src: string): string
  carveToCarve?: (src: string) => string
}

async function loadOld(file: string): Promise<OldEngine | null> {
  return existsSync(file) ? await import(pathToFileURL(file).href) as OldEngine : null
}

const old = await loadOld(option('old', join(import.meta.dirname, '../../dist/index.js')))

type Converter = (src: string) => string

/** Another engine of the third table, with the extension of the language it reads. Its converter is null when it is not installed. */
interface Peer {
  name: string
  extension: string
  engine: Converter | null
}

/** The module `name`, or null when it is not installed. */
async function optional(name: string): Promise<unknown> {
  try {
    return await import(name) as unknown
  } catch {
    return null
  }
}

interface DjotModule {
  parse(src: string): unknown
  renderHTML(tree: unknown): string
}

interface MarkdownItModule {
  default: new (preset: string) => { render(src: string): string }
}

interface CommonmarkModule {
  Parser: new () => { parse(src: string): unknown }
  HtmlRenderer: new () => { render(tree: unknown): string }
}

function djotConverter(module: DjotModule | null): Converter | null {
  return module === null ? null : (src) => module.renderHTML(module.parse(src))
}

/** markdown-it with its CommonMark preset, built once as an application would. */
function markdownItConverter(module: MarkdownItModule | null): Converter | null {
  if (module === null) return null
  const engine = new module.default('commonmark')
  return (src) => engine.render(src)
}

function commonmarkConverter(module: CommonmarkModule | null): Converter | null {
  if (module === null) return null
  const parser = new module.Parser()
  const renderer = new module.HtmlRenderer()
  return (src) => renderer.render(parser.parse(src))
}

const peers: Peer[] = [
  { name: 'djot.js', extension: '.dj', engine: djotConverter(await optional('@djot/djot') as DjotModule | null) },
  { name: 'markdown-it', extension: '.md', engine: markdownItConverter(await optional('markdown-it') as MarkdownItModule | null) },
  { name: 'commonmark.js', extension: '.md', engine: commonmarkConverter(await optional('commonmark') as CommonmarkModule | null) },
]

function baseName(file: string): string {
  return file.split('/').slice(-1)[0]!
}

// The names of the three languages of a carve-bench directory, which holds one document as `carve.crv`, `djot.dj` and `markdown.md`.
const BENCH_NAMES = new Map([['.dj', 'djot.dj'], ['.md', 'markdown.md']])

/**
 * The text an engine of the language `extension` reads for the input `file`: the file itself when
 * it has that extension, or the file beside it with the same name in that language. Null when
 * there is none, so the engine cannot read this document.
 */
function peerInput(file: string, extension: string): string | null {
  if (file.endsWith(extension)) return readFileSync(file, 'utf8')
  const dot = file.lastIndexOf('.')
  const stem = dot < 0 ? file : file.slice(0, dot)
  const beside = baseName(stem) === 'carve' ? join(dirname(file), BENCH_NAMES.get(extension)!) : `${stem}${extension}`
  return existsSync(beside) ? readFileSync(beside, 'utf8') : null
}

/** Reads the last character of an output, which makes the runtime build a string it has only concatenated. */
function built(html: string): void {
  void html.charCodeAt(html.length - 1)
}

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
console.log('Source to HTML, median in microseconds per document. The ratio is the 0.1 engine over `render` of this engine.')
console.log('')
console.log('| Input | Bytes | 0.2 parse (tree with positions) | 0.2 render (source to HTML) | 0.1 carveToHtml | Ratio |')
console.log('|---|--:|--:|--:|--:|--:|')
for (const file of files) {
  if (!existsSync(file)) continue
  const src = readFileSync(file, 'utf8')
  const tasks: (() => void)[] = [() => void parse(src), () => void render(src)]
  if (old !== null) tasks.push(() => void old.carveToHtml(src))
  const times: number[][] = tasks.map(() => [])
  for (const task of tasks) sample(task)
  for (let round = 0; round < rounds; round++) tasks.forEach((task, at) => times[at]!.push(sample(task)))
  const [parseTime, renderTime, oldTime] = times.map(median)
  const ratio = oldTime === undefined ? '' : (oldTime / renderTime!).toFixed(1)
  console.log(
    `| ${file.split('/').slice(-1)[0]!} | ${Buffer.byteLength(src)} | ${parseTime!.toFixed(2)} | ${renderTime!.toFixed(2)} | ` +
    `${oldTime === undefined ? '' : oldTime.toFixed(2)} | ${ratio} |`,
  )
}
console.log('')
console.log('Source to HTML against other engines, median in microseconds per document. Each engine reads the document in its own')
console.log('language: the input itself, or the file beside it with the same name and the extension of that language. Every output')
console.log('is read once, so no engine leaves a string unbuilt.')
console.log('')
console.log(`| Input | 0.2 render | ${peers.map((peer) => peer.name).join(' | ')} |`)
console.log(`|---|--:|${peers.map(() => '--:').join('|')}|`)
const notes: string[] = []
for (const file of files) {
  if (!existsSync(file)) continue
  const src = readFileSync(file, 'utf8')
  const tasks: (() => void)[] = [() => built(render(src))]
  const columns: number[] = []
  for (const peer of peers) {
    const input = peer.engine === null ? null : peerInput(file, peer.extension)
    columns.push(input === null ? -1 : tasks.length)
    if (input === null) notes.push(peer.engine === null ? `${peer.name} is not installed` : `${peer.name} cannot read ${baseName(file)}: no ${peer.extension} file beside it`)
    else tasks.push(() => built(peer.engine!(input)))
  }
  const times: number[][] = tasks.map(() => [])
  for (const task of tasks) sample(task)
  for (let round = 0; round < rounds; round++) tasks.forEach((task, at) => times[at]!.push(sample(task)))
  const medians = times.map(median)
  console.log(`| ${baseName(file)} | ${medians[0]!.toFixed(2)} | ${columns.map((at) => (at < 0 ? '' : medians[at]!.toFixed(2))).join(' | ')} |`)
}
console.log('')
for (const note of new Set(notes)) console.log(`- ${note}`)
console.log('')
console.log('Source to canonical source, median in microseconds per document. The ratio is the 0.1 engine over `format` of this engine.')
console.log('')
console.log('| Input | Bytes | 0.2 parse with the record | 0.2 format | 0.1 carveToCarve | Ratio |')
console.log('|---|--:|--:|--:|--:|--:|')
for (const file of files) {
  if (!existsSync(file)) continue
  const src = readFileSync(file, 'utf8')
  const tasks: (() => void)[] = [() => void parseWithLayout(src), () => void format(src)]
  const oldFormat = old?.carveToCarve
  if (oldFormat !== undefined) tasks.push(() => void oldFormat(src))
  const times: number[][] = tasks.map(() => [])
  for (const task of tasks) sample(task)
  for (let round = 0; round < rounds; round++) tasks.forEach((task, at) => times[at]!.push(sample(task)))
  const [recordTime, formatTime, oldTime] = times.map(median)
  const ratio = oldTime === undefined ? '' : (oldTime / formatTime!).toFixed(1)
  console.log(
    `| ${file.split('/').slice(-1)[0]!} | ${Buffer.byteLength(src)} | ${recordTime!.toFixed(2)} | ${formatTime!.toFixed(2)} | ` +
    `${oldTime === undefined ? '' : oldTime.toFixed(2)} | ${ratio} |`,
  )
}
console.log('')
console.log(`Load average at the end: ${load()}`)
