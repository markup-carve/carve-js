import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { Session } from 'node:inspector'
import { cpus, loadavg } from 'node:os'
import { dirname, resolve } from 'node:path'
import { performance } from 'node:perf_hooks'
import { fileURLToPath, pathToFileURL } from 'node:url'

const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]
const digest = text => createHash('sha256').update(text).digest('hex')

function sourceFor(family, n) {
  if (family === 'plain') return 'A plain paragraph with several words.\n\n'.repeat(n)
  if (family === 'inline-links') return '[A link](/target) and plain words.\n\n'.repeat(n)
  const definitions = family === 'fixed-definitions' ? 64 : n
  const paragraphs = family === 'fixed-paragraphs' ? 64 : n
  const defs = Array.from({ length: definitions }, (_, i) => `[r${i}]: /target${i}\n`).join('')
  const body = Array.from({ length: paragraphs }, (_, i) => {
    const label = family === 'missing' ? 'missing' : family === 'distributed' ? `r${i % definitions}` : 'r0'
    return `[ref][${label}]\n\n`
  }).join('')
  return family === 'forward' ? body + defs : defs + '\n' + body + (family === 'fallback' ? '%% force AST\n' : '')
}

const families = ['dense', 'fixed-paragraphs', 'fixed-definitions', 'distributed', 'missing', 'forward', 'fallback', 'plain', 'inline-links']
const [first, second, third, fourth] = process.argv.slice(2)
if (first === '--worker') {
  const config = JSON.parse(second)
  const reader = await import(pathToFileURL(config.entry).href)
  const fast = await import(pathToFileURL(resolve(dirname(config.entry), 'fast-html.js')).href)
  const source = sourceFor(config.family, config.size)
  const operation = config.api === 'html' ? () => reader.carveToHtml(source) : () => reader.parse(source)
  const result = operation()
  const outputHash = digest(typeof result === 'string' ? result : JSON.stringify(result))
  const routing = fast.tryFastHtmlWithStats(source, {})?.accepted ?? null
  let sink = 0
  const once = () => {
    const value = operation()
    sink ^= typeof value === 'string' ? value.length : value.children.length
  }
  const loadStart = loadavg(), warmUntil = performance.now() + 250
  while (performance.now() < warmUntil) once()
  const samples = []
  for (let batch = 0; batch < 5; batch++) {
    global.gc()
    const cpu = process.cpuUsage(), start = performance.now()
    let calls = 0, elapsed
    do { once(); calls++; elapsed = performance.now() - start } while (calls < 8 || elapsed < 150)
    const usage = process.cpuUsage(cpu)
    samples.push({ calls, wallMs: elapsed / calls, cpuMs: (usage.user + usage.system) / 1000 / calls })
  }
  const session = new Session(); session.connect()
  const post = (method, params = {}) => new Promise((resolve, reject) => session.post(method, params, (error, result) => error ? reject(error) : resolve(result)))
  global.gc()
  await post('HeapProfiler.enable')
  await post('HeapProfiler.startSampling', { samplingInterval: 4096, includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true })
  for (let i = 0; i < 50; i++) once()
  const { profile } = await post('HeapProfiler.stopSampling')
  session.disconnect()
  const sum = node => node.selfSize + node.children.reduce((total, child) => total + sum(child), 0)
  console.log(JSON.stringify({ samples, sampledBytesPerCall: sum(profile.head) / 50, routing, outputHash, loadStart, loadEnd: loadavg(), sink }))
} else {
  assert.ok(first && second && third, 'Usage: node scripts/bench-reference-definitions.mjs BASELINE_INDEX CANDIDATE_INDEX OUTPUT_JSON [--matrix|--cache|--sparse]')
  const entries = { baseline: resolve(first), candidate: resolve(second) }
  const stamp = entry => Object.fromEntries(['parse.js', 'fast-html.js', 'source-positions.js'].map(name => [name, digest(readFileSync(resolve(dirname(entry), name)))]))
  const metadata = {
    generatedAt: new Date().toISOString(), node: process.version, cpu: cpus()[0].model, logicalCpus: cpus().length,
    baseline: stamp(entries.baseline), candidate: stamp(entries.candidate), runnerSha256: digest(readFileSync(fileURLToPath(import.meta.url))),
    method: 'Two fresh-worker rounds per fixture/API in alternating reader order. Each worker warms for 250ms and measures five batches of at least eight calls and 150ms. Separate 50-call heap samples include collected objects. Timing and allocation are observations, not CI thresholds.',
  }
  const cases = fourth === '--sparse'
    ? ['fixed-definitions', 'dense', 'inline-links'].map(family => ({ family, size: 1024 }))
    : fourth === '--matrix'
    ? families.flatMap(family => [64, 256, 1024].map(size => ({ family, size })))
    : [{ family: 'dense', size: 256 }, { family: 'dense', size: 1024 }, { family: 'forward', size: 1024 }, { family: 'fallback', size: 1024 }, ...fourth === '--cache' ? [{ family: 'plain', size: 1024 }, { family: 'inline-links', size: 1024 }] : []]
  const groups = []
  for (const { family, size } of cases) {
    const source = sourceFor(family, size)
    for (const api of ['parse', 'html']) {
      let expected
      for (const [round, order] of [['baseline', 'candidate'], ['candidate', 'baseline']].entries()) {
        for (const reader of order) {
          const config = { entry: entries[reader], family, size, api }
          const result = spawnSync(process.execPath, ['--expose-gc', fileURLToPath(import.meta.url), '--worker', JSON.stringify(config)], {
            encoding: 'utf8', timeout: 180_000, maxBuffer: 1_000_000,
          })
          assert.equal(result.status, 0, result.error?.message ?? result.stderr)
          const observation = JSON.parse(result.stdout)
          expected ??= observation.outputHash
          assert.equal(observation.outputHash, expected, `${family}/${size}/${api}: output differs`)
          groups.push({ family, size, api, reader, round, bytes: Buffer.byteLength(source), sourceSha256: digest(source), ...observation })
          writeFileSync(third, JSON.stringify({ metadata, groups }, null, 2) + '\n')
          console.log(`${family}/${size}/${api}/${reader}/${round}: ${median(observation.samples.map(s => s.wallMs)).toFixed(3)} ms`)
        }
      }
    }
  }
}
