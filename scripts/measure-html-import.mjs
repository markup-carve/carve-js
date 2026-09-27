import { createHash } from 'node:crypto'
import { cp, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'

const [engine, ...pages] = process.argv.slice(2)
if (!engine || pages.length === 0) {
  console.error('Usage: node scripts/measure-html-import.mjs ENGINE_ROOT PAGE.html [...]')
  process.exit(1)
}
const samples = Number(process.env.CARVE_MEASURE_SAMPLES ?? 5)
if (!Number.isInteger(samples) || samples < 0 || samples > 100) throw new Error('Invalid CARVE_MEASURE_SAMPLES')
const root = resolve(engine)
const temporary = await mkdtemp(join(tmpdir(), 'carve-html-measure-'))
const hash = (value) => createHash('sha256').update(value).digest('hex')
try {
  await cp(join(root, 'dist'), join(temporary, 'dist'), { recursive: true })
  await writeFile(join(temporary, 'package.json'), '{"type":"module"}\n')
  await symlink(join(root, 'node_modules'), join(temporary, 'node_modules'), 'dir')
  const renderer = await readFile(join(temporary, 'dist', 'render-carve.js'), 'utf8')
  for (const name of ['narrowOccurrences', 'narrowEscalation']) {
    if (!renderer.includes(`function ${name}(`)) throw new Error(`Cannot identify ${name}; use an unminified tsc build`)
  }
  const parserPath = join(temporary, 'dist', 'parse.js')
  const parser = await readFile(parserPath, 'utf8')
  const entry = 'export function parse(source, opts = {}) {'
  if (parser.split(entry).length !== 2) throw new Error('Cannot locate the compiled parse entry point')
  await writeFile(parserPath, parser.replace(entry, `${entry}
    const measurement = globalThis.__carveParseMeasurement;
    const bytes = Buffer.byteLength(source);
    const previousLimit = Error.stackTraceLimit;
    Error.stackTraceLimit = 40;
    const trace = new Error().stack;
    Error.stackTraceLimit = previousLimit;
    const phase = trace.includes('narrowOccurrences') ? 'occurrences'
      : trace.includes('narrowEscalation') ? 'units' : 'other';
    measurement.calls++;
    measurement.bytes += bytes;
    measurement.codeUnits += source.length;
    measurement.phases[phase].calls++;
    measurement.phases[phase].bytes += bytes;
    measurement.phases[phase].codeUnits += source.length;
  `))
  const measured = await import(pathToFileURL(join(temporary, 'dist', 'index.js')).href)
  const ordinary = await import(pathToFileURL(join(root, 'dist', 'index.js')).href)
  for (const page of pages) {
    const html = await readFile(page, 'utf8')
    globalThis.__carveParseMeasurement = { calls: 0, bytes: 0, codeUnits: 0, phases: Object.fromEntries(['occurrences', 'units', 'other'].map(phase => [phase, { calls: 0, bytes: 0, codeUnits: 0 }])) }
    const result = measured.htmlToCarve(html)
    const counts = { ...globalThis.__carveParseMeasurement }
    const warmup = ordinary.htmlToCarve(html)
    if (warmup.value !== result.value) throw new Error('Instrumentation changed the output')
    const milliseconds = []
    for (let sample = 0; sample < samples; sample++) {
      const start = performance.now()
      const timed = ordinary.htmlToCarve(html)
      milliseconds.push(performance.now() - start)
      if (timed.value !== result.value) throw new Error('Output changed between samples')
    }
    const sorted = [...milliseconds].sort((a, b) => a - b)
    const middle = Math.floor(samples / 2)
    const medianMs = samples === 0 ? null : samples % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
    console.log(JSON.stringify({
      engineRoot: root, node: process.version, page: resolve(page), inputSha256: hash(html), inputBytes: Buffer.byteLength(html),
      parseCalls: counts.calls, parsedBytes: counts.bytes, parsedCodeUnits: counts.codeUnits, phases: counts.phases,
      outputBytes: Buffer.byteLength(result.value), outputSha256: hash(result.value),
      milliseconds, medianMs,
    }))
  }
} finally {
  delete globalThis.__carveParseMeasurement
  await rm(temporary, { recursive: true, force: true })
}
