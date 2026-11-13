// Wall time of Carve 0.2 against other JavaScript markup engines, per document, in two phases measured apart:
// parse (source to the engine's own tree, AST or token list) and source to HTML.
//   node v2/scripts/bench-engines.ts [--rounds N] [--sample-ms M] [--json FILE] [--verify] [--old FILE]
//
// Fairness rules, printed with the results too:
// - Each engine reads a document in its own language: `.crv` for Carve, `.md` for the Markdown engines, `.dj` for
//   djot.js. Every document is a triple of the same content and structure: test/fixtures/bench-commonmark-core.* and
//   the documents of v2/test/fixtures/bench-engines/, which v2/scripts/make-bench-fixtures.ts writes. `--verify`
//   counts the elements of the Carve 0.2 HTML against markdown-it on the `.md` twin and fails above 1% difference.
// - The `.md` twins are GFM (pipe tables, footnotes). Every Markdown engine runs with the GFM features it has;
//   one that lacks one (commonmark.js: tables and footnotes; marked: footnotes) reads those lines as paragraphs.
// - Engines run with their default options otherwise, built once outside the timed loop as an application would.
// - Each function is warmed up, then measured for `--rounds` rounds (default 15). A round runs every function in a
//   timed loop of at least `--sample-ms` (default 200) wall time, measured with process.hrtime.bigint(), in an order
//   that rotates each round so that drift hits every engine alike. The tables give the median and the minimum of
//   the rounds in microseconds per document. Every output is kept or read, so no engine leaves work undone.
// - One process. Nothing fails on a number.
// The 0.1 engine is the built entry of this repository (`--old`, default dist/index.js, which `npm run build` writes).
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { cpus, loadavg } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parse, render } from '../src/index.ts'

function option(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`)
  return at >= 0 && at + 1 < process.argv.length ? process.argv[at + 1]! : fallback
}

const ROOT = join(import.meta.dirname, '../..')
const rounds = Number(option('rounds', '15'))
const sampleNanos = BigInt(Math.round(Number(option('sample-ms', '200')) * 1e6))
const jsonFile = option('json', '')
const verifyOnly = process.argv.includes('--verify')

type Language = 'crv' | 'md' | 'dj'
type Parser = (src: string) => unknown
type Converter = (src: string) => string

interface Engine {
  name: string
  version: string
  language: Language
  parse: Parser | null
  html: Converter | null
}

/** The module `name`, or null with the reason when it does not load. */
async function optional(name: string, failures: string[]): Promise<unknown> {
  try {
    return await import(name) as unknown
  } catch (error) {
    failures.push(`${name}: ${error instanceof Error ? error.message.split('\n')[0]! : String(error)}`)
    return null
  }
}

function version(name: string): string {
  try {
    return (JSON.parse(readFileSync(join(ROOT, 'node_modules', name, 'package.json'), 'utf8')) as { version: string }).version
  } catch {
    return '?'
  }
}

interface OldModule {
  parse(src: string, options?: { positions: boolean }): unknown
  carveToHtml(src: string): string
}

interface DjotModule {
  parse(src: string): unknown
  renderHTML(tree: unknown): string
}

interface MarkdownIt {
  parse(src: string, env: object): unknown
  render(src: string): string
  use(plugin: unknown): MarkdownIt
}

interface MarkdownItModule {
  default: new (preset: string) => MarkdownIt
}

interface CommonmarkModule {
  Parser: new () => { parse(src: string): unknown }
  HtmlRenderer: new () => { render(tree: unknown): string }
}

interface MicromarkModule {
  micromark(src: string, options?: { extensions: unknown[], htmlExtensions: unknown[] }): string
}

interface GfmModule {
  gfm(): unknown
  gfmHtml(): unknown
}

interface FromMarkdownModule {
  fromMarkdown(src: string, options?: { extensions: unknown[], mdastExtensions: unknown[] }): unknown
}

interface MdastGfmModule {
  gfmFromMarkdown(): unknown
}

interface MarkedModule {
  lexer(src: string): unknown
  parse(src: string): string
}

function engine(name: string, release: string, language: Language, parse: Parser | null, html: Converter | null): Engine {
  return { name, version: release, language, parse, html }
}

function carveEngines(old: OldModule | null): Engine[] {
  const ownVersion = (JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { version: string }).version
  const engines: Engine[] = [
    engine('Carve 0.2', 'v2/src', 'crv', (src) => parse(src, { positions: false }), (src) => render(src)),
    engine('Carve 0.2 (positions)', 'v2/src', 'crv', (src) => parse(src), null),
  ]
  if (old !== null) {
    engines.push(engine('Carve 0.1', ownVersion, 'crv', (src) => old.parse(src, { positions: false }), (src) => old.carveToHtml(src)))
  }
  return engines
}

function djotEngine(module: DjotModule | null): Engine[] {
  if (module === null) return []
  return [engine('djot.js', version('@djot/djot'), 'dj', (src) => module.parse(src), (src) => module.renderHTML(module.parse(src)))]
}

/** markdown-it with its default preset (CommonMark plus tables and strikethrough, raw HTML off) and markdown-it-footnote. */
function markdownItEngine(module: MarkdownItModule | null, footnote: { default: unknown } | null): Engine[] {
  if (module === null) return []
  const md = new module.default('default')
  if (footnote !== null) md.use(footnote.default)
  const name = footnote === null ? 'markdown-it' : 'markdown-it + footnote'
  return [engine(name, version('markdown-it'), 'md', (src) => md.parse(src, {}), (src) => md.render(src))]
}

function commonmarkEngine(module: CommonmarkModule | null): Engine[] {
  if (module === null) return []
  const parser = new module.Parser()
  const renderer = new module.HtmlRenderer()
  return [engine('commonmark.js', version('commonmark'), 'md', (src) => parser.parse(src), (src) => renderer.render(parser.parse(src)))]
}

/** micromark has no tree of its own: source to HTML only, plain CommonMark and with GFM. */
function micromarkEngines(module: MicromarkModule | null, gfm: GfmModule | null): Engine[] {
  if (module === null) return []
  const release = version('micromark')
  const engines: Engine[] = [engine('micromark', release, 'md', null, (src) => module.micromark(src))]
  if (gfm !== null) {
    const options = { extensions: [gfm.gfm()], htmlExtensions: [gfm.gfmHtml()] }
    engines.push(engine('micromark + GFM', release, 'md', null, (src) => module.micromark(src, options)))
  }
  return engines
}

/** The mdast tree micromark's tokenizer feeds, with GFM when both GFM packages load. */
function mdastEngine(module: FromMarkdownModule | null, gfm: GfmModule | null, mdastGfm: MdastGfmModule | null): Engine[] {
  if (module === null) return []
  const options = gfm !== null && mdastGfm !== null ? { extensions: [gfm.gfm()], mdastExtensions: [mdastGfm.gfmFromMarkdown()] } : undefined
  const name = options === undefined ? 'mdast-util-from-markdown' : 'mdast-util-from-markdown + GFM'
  return [engine(name, version('mdast-util-from-markdown'), 'md', (src) => module.fromMarkdown(src, options), null)]
}

/** marked with its defaults, which turn GFM on. */
function markedEngine(module: MarkedModule | null): Engine[] {
  if (module === null) return []
  return [engine('marked', version('marked'), 'md', (src) => module.lexer(src), (src) => module.parse(src))]
}

async function loadEngines(failures: string[]): Promise<Engine[]> {
  const oldFile = option('old', join(ROOT, 'dist/index.js'))
  const old = existsSync(oldFile) ? await import(pathToFileURL(oldFile).href) as OldModule : null
  if (old === null) failures.push(`Carve 0.1: ${oldFile} is missing; run npm run build`)
  const gfm = await optional('micromark-extension-gfm', failures) as GfmModule | null
  return [
    ...carveEngines(old),
    ...djotEngine(await optional('@djot/djot', failures) as DjotModule | null),
    ...markdownItEngine(
      await optional('markdown-it', failures) as MarkdownItModule | null,
      await optional('markdown-it-footnote', failures) as { default: unknown } | null,
    ),
    ...commonmarkEngine(await optional('commonmark', failures) as CommonmarkModule | null),
    ...micromarkEngines(await optional('micromark', failures) as MicromarkModule | null, gfm),
    ...mdastEngine(
      await optional('mdast-util-from-markdown', failures) as FromMarkdownModule | null, gfm,
      await optional('mdast-util-gfm', failures) as MdastGfmModule | null,
    ),
    ...markedEngine(await optional('marked', failures) as MarkedModule | null),
  ]
}

interface Document {
  name: string
  /** False for the shared fixture of test/fixtures, which --verify reports but does not fail on. */
  owned: boolean
  sources: Record<Language, string>
}

function loadDocuments(): Document[] {
  const own = join(ROOT, 'v2/test/fixtures/bench-engines')
  const stems: [string, string][] = [
    ['commonmark-core', join(ROOT, 'test/fixtures/bench-commonmark-core')],
    ...['prose', 'lists-tables', 'reference-heavy'].map((name): [string, string] => [name, join(own, name)]),
  ]
  return stems.map(([name, stem]) => ({
    name,
    owned: name !== 'commonmark-core',
    sources: { crv: readFileSync(`${stem}.crv`, 'utf8'), md: readFileSync(`${stem}.md`, 'utf8'), dj: readFileSync(`${stem}.dj`, 'utf8') },
  }))
}

const ELEMENTS: [string, RegExp][] = [
  ['p', /<p[\s>]/g], ['li', /<li[\s>]/g], ['h1-h6', /<h[1-6][\s>]/g], ['a', /<a\s/g], ['td/th', /<t[dh][\s>]/g], ['code', /<code[\s>]/g],
]

function counts(html: string): number[] {
  return ELEMENTS.map(([, pattern]) => html.match(pattern)?.length ?? 0)
}

/** Prints the element counts of each document and returns whether Carve 0.2 and markdown-it agree within 1%. */
function verify(documents: Document[], engines: Engine[]): boolean {
  const reference = engines.find((engine) => engine.name.startsWith('markdown-it'))
  const djot = engines.find((engine) => engine.name === 'djot.js')
  if (reference?.html == null) {
    console.log('markdown-it is not installed: nothing to verify against.')
    return false
  }
  let ok = true
  console.log('| Document | Element | Carve 0.2 (.crv) | markdown-it (.md) | djot.js (.dj) | Difference | Check |')
  console.log('|---|---|--:|--:|--:|--:|---|')
  for (const document of documents) {
    const carve = counts(render(document.sources.crv))
    const markdown = counts(reference.html(document.sources.md))
    const dj = djot?.html == null ? null : counts(djot.html(document.sources.dj))
    ELEMENTS.forEach(([element], at) => {
      const difference = Math.abs(carve[at]! - markdown[at]!) / Math.max(1, markdown[at]!)
      if (document.owned) ok &&= difference <= 0.01
      const check = difference <= 0.01 ? 'ok' : document.owned ? 'MISMATCH' : 'differs (shared fixture)'
      const percent = `${(difference * 100).toFixed(1)}%`
      console.log(`| ${document.name} | ${element} | ${carve[at]} | ${markdown[at]} | ${dj?.[at] ?? ''} | ${percent} | ${check} |`)
    })
  }
  console.log('')
  console.log('commonmark-core is test/fixtures/bench-commonmark-core.*, written for the 0.1 engine and checked here but not failed on:')
  console.log('its `---` is no thematic break in Carve 0.2 (a paragraph with a dash), and the blank line before a nested list')
  console.log('makes the Markdown list loose (a paragraph per item), where Carve and Djot keep it tight.')
  return ok
}

let kept: unknown = null

/** Microseconds per call, from a timed loop of at least one sample. */
function sample(task: () => void): number {
  let calls = 0
  const start = process.hrtime.bigint()
  let elapsed = 0n
  do {
    task()
    calls++
    elapsed = process.hrtime.bigint() - start
  } while (elapsed < sampleNanos)
  return Number(elapsed) / 1000 / calls
}

function median(values: number[]): number {
  const sorted = values.slice().sort((a, b) => a - b)
  const middle = sorted.length >> 1
  return sorted.length % 2 === 1 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2
}

type Phase = 'parse' | 'html'

interface Task {
  engine: Engine
  phase: Phase
  run: () => void
  times: number[]
  error: string | null
}

function tasksOf(document: Document, engines: Engine[]): Task[] {
  const tasks: Task[] = []
  for (const engine of engines) {
    const src = document.sources[engine.language]
    const parser = engine.parse
    const converter = engine.html
    if (parser !== null) tasks.push({ engine, phase: 'parse', run: () => { kept = parser(src) }, times: [], error: null })
    if (converter !== null) {
      // Reading the last character makes the runtime build a string it has only concatenated.
      const run = (): void => {
        const html = converter(src)
        kept = html.charCodeAt(html.length - 1)
      }
      tasks.push({ engine, phase: 'html', run, times: [], error: null })
    }
  }
  return tasks
}

/** Runs one task, keeping an error instead of throwing it. */
function attempt(task: Task, body: () => void): void {
  if (task.error !== null) return
  try {
    body()
  } catch (error) {
    task.error = error instanceof Error ? error.message.split('\n')[0]! : String(error)
  }
}

function measure(tasks: Task[]): void {
  for (const task of tasks) attempt(task, () => void sample(task.run))
  for (let round = 0; round < rounds; round++) {
    for (let offset = 0; offset < tasks.length; offset++) {
      const task = tasks[(offset + round) % tasks.length]!
      attempt(task, () => task.times.push(sample(task.run)))
    }
  }
}

interface Row {
  engine: Engine
  bytes: number
  parse: Task | undefined
  html: Task | undefined
}

function rowsOf(document: Document, engines: Engine[], tasks: Task[]): Row[] {
  return engines.map((engine) => ({
    engine,
    bytes: Buffer.byteLength(document.sources[engine.language]),
    parse: tasks.find((task) => task.engine === engine && task.phase === 'parse'),
    html: tasks.find((task) => task.engine === engine && task.phase === 'html'),
  }))
}

/** The median of a task, or null when it has no number. */
function middle(task: Task | undefined): number | null {
  return task === undefined || task.error !== null || task.times.length === 0 ? null : median(task.times)
}

function cell(task: Task | undefined, pick: (times: number[]) => number): string {
  if (task === undefined) return ''
  if (task.error !== null) return 'error'
  return task.times.length === 0 ? '' : pick(task.times).toFixed(1)
}

function ratio(value: number | null, base: number | null): string {
  return value === null || base === null ? '' : (value / base).toFixed(2)
}

function printDocument(document: Document, rows: Row[]): void {
  const base = rows[0]!
  console.log(`### ${document.name}`)
  console.log('')
  console.log(
    '| Engine | Version | Input | Bytes | Parse us | Parse min | HTML us | HTML min | HTML MB/s | Parse / Carve 0.2 | HTML / Carve 0.2 |',
  )
  console.log('|---|---|---|--:|--:|--:|--:|--:|--:|--:|--:|')
  for (const row of rows) {
    const html = middle(row.html)
    const speed = html === null ? '' : (row.bytes / html).toFixed(1)
    console.log(
      `| ${row.engine.name} | ${row.engine.version} | .${row.engine.language} | ${row.bytes} | ` +
      `${cell(row.parse, median)} | ${cell(row.parse, (times) => Math.min(...times))} | ` +
      `${cell(row.html, median)} | ${cell(row.html, (times) => Math.min(...times))} | ${speed} | ` +
      `${ratio(middle(row.parse), middle(base.parse))} | ${ratio(html, middle(base.html))} |`,
    )
  }
  for (const row of rows) {
    for (const task of [row.parse, row.html]) if (task?.error != null) console.log(`- ${row.engine.name} ${task.phase}: ${task.error}`)
  }
  console.log('')
}

function geometricMean(values: number[]): string {
  return values.length === 0 ? '' : Math.exp(values.reduce((sum, value) => sum + Math.log(value), 0) / values.length).toFixed(2)
}

function ratios(results: Row[][], index: number, phase: Phase): number[] {
  const out: number[] = []
  for (const rows of results) {
    const value = middle(rows[index]![phase])
    const base = middle(rows[0]![phase])
    if (value !== null && base !== null) out.push(value / base)
  }
  return out
}

function printSummary(engines: Engine[], results: Row[][]): void {
  console.log('### Summary')
  console.log('')
  console.log('Geometric mean over the documents of the time of each engine over the time of Carve 0.2 (parse without positions,')
  console.log('and render). Above 1 is slower than Carve 0.2.')
  console.log('')
  console.log('| Engine | Parse / Carve 0.2 | HTML / Carve 0.2 | Documents |')
  console.log('|---|--:|--:|--:|')
  engines.forEach((engine, index) => {
    const parses = ratios(results, index, 'parse')
    const htmls = ratios(results, index, 'html')
    console.log(`| ${engine.name} | ${geometricMean(parses)} | ${geometricMean(htmls)} | ${Math.max(parses.length, htmls.length)} |`)
  })
  console.log('')
}

function load(): string {
  return loadavg().map((n) => n.toFixed(2)).join(' ')
}

const FAIRNESS = [
  'Each engine reads the document in its own language (.crv, .md, .dj); the three files of a document have the same content and structure.',
  'The .md files are GFM. markdown-it runs its default preset (tables on, raw HTML off) with markdown-it-footnote; marked runs its',
  'defaults (GFM on, no footnotes); micromark and mdast-util-from-markdown run once plain and once with the GFM extensions;',
  'commonmark.js has neither tables nor footnotes and reads those lines as paragraphs.',
  'Parse is source to the engine\'s own tree or token list: Carve 0.2 without positions (a second row with them), Carve 0.1 parse()',
  'without positions and without its resolve pass. HTML is source to HTML in one call, parse included; Carve 0.1 carveToHtml takes',
  'its fast path where the source allows it. micromark has no tree: HTML only.',
  `Each function is warmed up, then timed in ${rounds} rounds of at least ${Number(sampleNanos) / 1e6} ms wall time each, in an order that`,
  'rotates per round. Times are the median (and the minimum) of the rounds, in microseconds per document. MB/s is the engine\'s own',
  'input bytes over the median HTML time.',
]

async function main(): Promise<void> {
  const failures: string[] = []
  const engines = await loadEngines(failures)
  const documents = loadDocuments()
  if (verifyOnly) {
    process.exitCode = verify(documents, engines) ? 0 : 1
    return
  }
  const loadStart = load()
  console.log(`Node ${process.version}, ${cpus()[0]?.model ?? 'unknown CPU'}, ${cpus().length} logical CPUs`)
  console.log(`Load average (1, 5, 15 min) at the start: ${loadStart}`)
  console.log('')
  for (const line of FAIRNESS) console.log(line)
  for (const failure of failures) console.log(`- not loaded: ${failure}`)
  console.log('')
  const results: Row[][] = []
  for (const document of documents) {
    const tasks = tasksOf(document, engines)
    measure(tasks)
    const rows = rowsOf(document, engines, tasks)
    results.push(rows)
    printDocument(document, rows)
  }
  printSummary(engines, results)
  const loadEnd = load()
  console.log(`Load average at the end: ${loadEnd}`)
  if (jsonFile !== '') writeJson(jsonFile, { loadStart, loadEnd, failures, documents, results })
  void kept
}

interface Report {
  loadStart: string
  loadEnd: string
  failures: string[]
  documents: Document[]
  results: Row[][]
}

function writeJson(file: string, report: Report): void {
  const phase = (task: Task | undefined): object | null => (task === undefined ? null : {
    rounds: task.times, median: middle(task), min: task.times.length === 0 ? null : Math.min(...task.times), error: task.error,
  })
  writeFileSync(file, JSON.stringify({
    node: process.version, cpu: cpus()[0]?.model ?? null, logicalCpus: cpus().length, loadStart: report.loadStart, loadEnd: report.loadEnd,
    rounds, sampleMs: Number(sampleNanos) / 1e6, unit: 'microseconds per document', notLoaded: report.failures,
    documents: report.documents.map((document, at) => ({
      name: document.name,
      engines: report.results[at]!.map((row) => ({
        name: row.engine.name, version: row.engine.version, language: row.engine.language, bytes: row.bytes,
        parse: phase(row.parse), html: phase(row.html),
      })),
    })),
  }, null, 2) + '\n')
}

await main()
