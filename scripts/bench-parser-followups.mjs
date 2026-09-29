import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFileSync, spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { Session } from 'node:inspector'
import { cpus, loadavg } from 'node:os'
import { dirname, resolve } from 'node:path'
import { performance } from 'node:perf_hooks'
import { fileURLToPath, pathToFileURL } from 'node:url'

const fixtures = {
  'plain-paragraphs': 'alpha beta\n\n'.repeat(1024),
  'literal-bracket': '[' + 'alpha beta\n\n'.repeat(1024),
  'inline-links': 'alpha [ref](/target)\n\n'.repeat(512),
  'sparse-definitions': '[r]: /target\n\n' + 'alpha beta\n\n'.repeat(1024),
  'dense-definitions': Array.from({ length: 256 }, (_, i) => `[r${i}]: /target${i}\n`).join('') + '\n' + '[ref][r0]\n\n'.repeat(512),
  ...Object.fromEntries([32, 96, 192].flatMap(depth => [
    [`quotes-${depth}`, '> '.repeat(depth) + 'end\n'],
    [`lists-${depth}`, '- '.repeat(depth) + 'end\n'],
  ])),
  'quotes-body': '> '.repeat(96) + 'alpha beta '.repeat(128) + '\n',
  'lists-body': '- '.repeat(96) + 'alpha beta '.repeat(128) + '\n',
  'long-ascii': 'alpha beta '.repeat(1024) + '\n',
  'long-unicode': '😀 alpha '.repeat(1024) + '\n',
  'unicode-paragraphs': '😀 alpha\n\n'.repeat(1024),
  'sparse-markup': 'alpha *beta* gamma\n\n'.repeat(512),
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
  await post('Profiler.enable')
  await post('Profiler.setSamplingInterval', { interval: 100 })
  await post('Profiler.start')
  const profileUntil = performance.now() + 300
  let cpuIterations = 0
  while (performance.now() < profileUntil) { once(); cpuIterations++ }
  const { profile: cpuProfile } = await post('Profiler.stop')
  await post('Profiler.disable')
  const weights = new Map()
  for (let i = 0; i < cpuProfile.samples.length; i++) weights.set(cpuProfile.samples[i], (weights.get(cpuProfile.samples[i]) ?? 0) + cpuProfile.timeDeltas[i])
  const cpuFrames = cpuProfile.nodes.filter(n => weights.has(n.id)).map(n => ({ ...n.callFrame, selfUs: weights.get(n.id) }))
  global.gc()
  await post('HeapProfiler.enable')
  await post('HeapProfiler.startSampling', { samplingInterval: 4096, includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true })
  const heapIterations = 50
  for (let i = 0; i < heapIterations; i++) once()
  const { profile } = await post('HeapProfiler.stopSampling')
  session.disconnect()
  const sum = node => node.selfSize + node.children.reduce((total, child) => total + sum(child), 0)
  const heapFrames = []
  const walk = node => { if (node.selfSize) heapFrames.push({ ...node.callFrame, sampledBytes: node.selfSize }); node.children.forEach(walk) }
  walk(profile.head)
  console.log(JSON.stringify({ samples, cpuIterations, cpuFrames: cpuFrames.sort((a,b) => b.selfUs-a.selfUs).slice(0,64), heapFrames: heapFrames.sort((a,b) => b.sampledBytes-a.sampledBytes).slice(0,64), omittedCpuFrames: Math.max(0,cpuFrames.length-64), omittedHeapFrames: Math.max(0,heapFrames.length-64), heapIterations, sampledAllocationBytes: sum(profile.head), loadStart, loadEnd: loadavg(), sink }))
} else {
  assert.ok(command && entry, 'Usage: node scripts/bench-parser-followups.mjs BASELINE_DIST_INDEX OUTPUT_JSON')
  const candidate = fileURLToPath(new URL('../dist/index.js', import.meta.url))
  const baseline = resolve(command), output = resolve(entry)
  assert.notEqual(baseline, candidate)
  const stamp = entry => {
    const root = resolve(dirname(entry), '..')
    return { head: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
      sourceSha256: digest(readdirSync(resolve(root, 'src'), { recursive: true }).filter(name => name.endsWith('.ts')).sort().map(name => resolve(root, 'src', name))),
      buildSha256: digest(readdirSync(resolve(root, 'dist'), { recursive: true }).filter(name => name.endsWith('.js')).sort().map(name => resolve(root, 'dist', name))) }
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
