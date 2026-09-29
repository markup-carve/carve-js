import assert from 'node:assert/strict'
import { Session } from 'node:inspector'
import { spawnSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { performance } from 'node:perf_hooks'
import { loadavg } from 'node:os'

const fixtures = {
  paragraphs: 'alpha beta\n\n'.repeat(1024),
  definitions: '[r]: /target\n\n' + '[ref][r]\n\n'.repeat(512),
  quotes: '> '.repeat(192) + 'end\n',
  lists: '- '.repeat(192) + 'end\n',
}
const [command, entry, family] = process.argv.slice(2)
if (command === '--worker') {
  const { parse } = await import(pathToFileURL(entry))
  const { dropPositions } = await import(pathToFileURL(resolve(dirname(entry), 'source-positions.js')))
  const source = fixtures[family]
  const docs = () => Array.from({ length: 100 }, () => parse(source))
  const samples = []
  for (let batch = 0; batch < 5; batch++) {
    const prepared = docs()
    global.gc()
    const cpu = process.cpuUsage(), start = performance.now()
    for (const doc of prepared) dropPositions(doc)
    const elapsed = performance.now() - start, usage = process.cpuUsage(cpu)
    samples.push({ wallMs: elapsed / 100, cpuMs: (usage.user + usage.system) / 100000 })
    for (const doc of prepared) assert.deepEqual(doc, parse(source, { positions: false }))
  }
  const prepared = docs()
  const session = new Session(); session.connect()
  const post = (method, params = {}) => new Promise((resolve, reject) => session.post(method, params, (error, result) => error ? reject(error) : resolve(result)))
  global.gc()
  await post('HeapProfiler.enable')
  await post('HeapProfiler.startSampling', { samplingInterval: 4096, includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true })
  await post('Profiler.enable'); await post('Profiler.setSamplingInterval', { interval: 100 }); await post('Profiler.start')
  for (const doc of prepared) dropPositions(doc)
  const { profile: cpuProfile } = await post('Profiler.stop')
  const { profile: heapProfile } = await post('HeapProfiler.stopSampling'); session.disconnect()
  const sum = n => n.selfSize + n.children.reduce((total, child) => total + sum(child), 0)
  console.log(JSON.stringify({ samples, calls: 100, sampledAllocationBytes: sum(heapProfile.head), heapProfile, cpuProfile, load: loadavg() }))
} else {
  assert.ok(command && entry, 'Usage: BASELINE_DIST_INDEX OUTPUT_JSON')
  const readers = { baseline: resolve(command), candidate: fileURLToPath(new URL('../dist/index.js', import.meta.url)) }
  const results = []
  for (const family of Object.keys(fixtures)) for (const [round, order] of [['baseline', 'candidate'], ['candidate', 'baseline']].entries()) for (const reader of order) {
    const run = spawnSync(process.execPath, ['--expose-gc', fileURLToPath(import.meta.url), '--worker', readers[reader], family], { encoding: 'utf8', timeout: 120000, maxBuffer: 5000000 })
    assert.equal(run.status, 0, run.stderr)
    results.push({ family, round, reader, ...JSON.parse(run.stdout) })
  }
  writeFileSync(entry, JSON.stringify({ generatedAt: new Date().toISOString(), node: process.version, results }, null, 2) + '\n')
}
