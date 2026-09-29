import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFileSync, spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { Session } from 'node:inspector'
import { cpus, loadavg } from 'node:os'
import { dirname, resolve } from 'node:path'
import { performance } from 'node:perf_hooks'
import { fileURLToPath, pathToFileURL } from 'node:url'

const fixtures = {
  'long-line': 'word '.repeat(8192) + 'end\n',
  'unclosed-code': '`' + 'word '.repeat(8192) + 'end\n',
  'many-paragraphs': 'alpha beta\n\n'.repeat(1024),
  'nested-quotes': '> '.repeat(192) + 'end\n',
  'nested-lists': '- '.repeat(192) + 'end\n',
  'unicode-lines': '😀 alpha *beta*  \r\nline 😀\n\n'.repeat(256),
  'interior-spaces': 'a' + ' '.repeat(8192) + 'b\n',
  'definitions': '[r]: /target\n\n' + 'alpha [ref][r]\n\n'.repeat(512),
}
const digest = files => createHash('sha256').update(Buffer.concat(files.map(file => readFileSync(file)))).digest('hex')
const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]
const [command, entry, family, mode] = process.argv.slice(2)
if (command === '--worker') {
  const reader = await import(pathToFileURL(entry).href), source = fixtures[family]
  assert.ok(source !== undefined && ['parse', 'no-positions', 'html'].includes(mode))
  const operation = mode === 'html' ? () => reader.carveToHtml(source)
    : mode === 'no-positions' ? () => reader.parse(source, { positions: false }) : () => reader.parse(source)
  let sink = 0
  const once = () => { const result = operation(); sink ^= typeof result === 'string' ? result.length : result.children.length }
  const loadStart = loadavg(), warmUntil = performance.now() + 300
  while (performance.now() < warmUntil) once()
  const samples = []
  for (let batch = 0; batch < 5; batch++) {
    global.gc()
    const cpu = process.cpuUsage(), start = performance.now()
    let iterations = 0, elapsed
    do { once(); iterations++; elapsed = performance.now() - start } while (elapsed < 100)
    const usage = process.cpuUsage(cpu)
    samples.push({ iterations, wallMs: elapsed / iterations, cpuMs: (usage.user + usage.system) / 1000 / iterations })
  }
  const session = new Session(); session.connect()
  const post = (method, params = {}) => new Promise((resolve, reject) => session.post(method, params, (error, result) => error ? reject(error) : resolve(result)))
  global.gc()
  await post('HeapProfiler.enable')
  await post('HeapProfiler.startSampling', { samplingInterval: 4096, includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true })
  const heapIterations = 50
  for (let i = 0; i < heapIterations; i++) once()
  const { profile } = await post('HeapProfiler.stopSampling')
  session.disconnect()
  const sum = node => node.selfSize + node.children.reduce((total, child) => total + sum(child), 0)
  console.log(JSON.stringify({ samples, heapIterations, sampledAllocationBytes: sum(profile.head), loadStart, loadEnd: loadavg(), sink }))
} else {
  assert.ok(command && entry, 'Usage: node scripts/bench-parser-costs.mjs BASELINE_DIST_INDEX OUTPUT_JSON')
  const candidate = fileURLToPath(new URL('../dist/index.js', import.meta.url))
  const baseline = resolve(command), output = resolve(entry)
  assert.notEqual(baseline, candidate)
  const stamp = entry => {
    const root = resolve(dirname(entry), '..')
    return { head: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
      sourceSha256: digest(['fast-html.ts', 'parse.ts', 'source-positions.ts'].map(name => resolve(root, 'src', name))),
      buildSha256: digest(['fast-html.js', 'parse.js', 'source-positions.js'].map(name => resolve(root, 'dist', name))) }
  }
  const metadata = { generatedAt: new Date().toISOString(), node: process.version, cpu: cpus()[0].model, logicalCpus: cpus().length,
    baseline: stamp(baseline), candidate: stamp(candidate), runnerSha256: digest([fileURLToPath(import.meta.url)]),
    method: 'Two fresh-worker rounds per fixture/mode, baseline-candidate then candidate-baseline. Each worker warms for 300ms and records five batches of at least 100ms. GC precedes each batch. Separate 50-call heap sample at 4096 bytes includes collected objects. Keep rounds separate; timing and sampled allocation are observations, not CI thresholds.' }
  const groups = []
  const readers = { baseline: await import(pathToFileURL(baseline).href), candidate: await import(pathToFileURL(candidate).href) }
  for (const [family, source] of Object.entries(fixtures)) {
    for (const options of [{}, { positions: false }]) assert.deepEqual(readers.candidate.parse(source, options), readers.baseline.parse(source, options), family)
    assert.equal(readers.candidate.carveToHtml(source), readers.baseline.carveToHtml(source), family)
    for (const mode of ['parse', 'no-positions', 'html']) {
      for (const [round, order] of [['baseline', 'candidate'], ['candidate', 'baseline']].entries()) for (const reader of order) {
        const result = spawnSync(process.execPath, ['--expose-gc', fileURLToPath(import.meta.url), '--worker', reader === 'baseline' ? baseline : candidate, family, mode], { encoding: 'utf8', timeout: 120_000, maxBuffer: 1_000_000 })
        assert.equal(result.status, 0, result.error?.message ?? result.stderr)
        const observation = JSON.parse(result.stdout)
        groups.push({ family, mode, round, reader, bytes: Buffer.byteLength(source), sourceSha256: createHash('sha256').update(source).digest('hex'), ...observation })
        console.log(`${family}/${mode}/${reader}/${round}: ${median(observation.samples.map(sample => sample.wallMs)).toFixed(3)} ms`)
      }
      writeFileSync(output, JSON.stringify({ metadata, groups }, null, 2) + '\n')
    }
  }
}
