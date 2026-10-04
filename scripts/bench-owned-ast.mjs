import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { resolve, dirname, basename } from 'node:path'
import { loadavg } from 'node:os'
import { fileURLToPath, pathToFileURL } from 'node:url'

const [command, entry, file, mode] = process.argv.slice(2)
const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]
if (command === '--worker') {
  const api = await import(pathToFileURL(entry))
  const source = readFileSync(file, 'utf8')
  const { collectDocumentIds } = await import(new URL('./document-ids.js', pathToFileURL(entry)))
  const options = mode.endsWith('no-positions') ? { positions: false } : {}
  const doc = api.resolve(api.parse(source, options))
  const run = mode === 'ids' ? () => collectDocumentIds(doc)
    : mode.startsWith('render') ? () => api.renderHtml(doc)
    : mode === 'owned' ? () => api.renderHtml(api.resolve(api.parse(source)))
    : () => api.parse(source, options)
  const iterations = Buffer.byteLength(source) > 100000 ? 5 : 30
  for (let index = 0; index < 10; index++) run()
  const loadStart = loadavg()
  const samples = []
  for (let batch = 0; batch < 5; batch++) {
    const start = performance.now()
    for (let index = 0; index < iterations; index++) run()
    samples.push((performance.now() - start) / iterations)
  }
  console.log(JSON.stringify({ samples, medianMs: median(samples), iterations, loadStart, loadEnd: loadavg() }))
} else {
  assert.ok(command && entry && file, 'Usage: BASELINE_DIST_INDEX COMPARISON_CRV LARGE_CRV')
  const entries = { baseline: resolve(command), candidate: fileURLToPath(new URL('../dist/index.js', import.meta.url)) }
  const baseline = await import(pathToFileURL(entries.baseline))
  const candidate = await import(pathToFileURL(entries.candidate))
  const buildHash = entry => createHash('sha256').update(Buffer.concat(
    ['index.js', 'parse.js', 'heading-ids.js', 'document-ids.js', 'source-positions.js']
      .map(name => readFileSync(resolve(dirname(entry), name))))).digest('hex')
  const builds = Object.fromEntries(Object.entries(entries).map(([reader, entry]) => [reader, buildHash(entry)]))
  const results = []
  for (const fixture of [entry, file]) {
    const source = readFileSync(fixture, 'utf8')
    for (const options of [{}, { positions: false }]) {
      assert.deepStrictEqual(candidate.parse(source, options), baseline.parse(source, options))
      assert.equal(candidate.renderHtml(candidate.resolve(candidate.parse(source, options))),
        baseline.renderHtml(baseline.resolve(baseline.parse(source, options))))
    }
    const modes = process.argv.slice(5)
    for (const mode of modes.length ? modes : ['parse', 'parse-no-positions', 'render', 'render-no-positions', 'owned', 'ids']) {
      console.error(`${basename(fixture)}: ${mode}`)
      for (const [round, order] of [['baseline', 'candidate'], ['candidate', 'baseline']].entries()) {
        for (const reader of order) {
          const worker = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--worker', entries[reader], resolve(fixture), mode],
            { encoding: 'utf8', timeout: 120000 })
          assert.equal(worker.status, 0, worker.stderr)
          results.push({ fixture: basename(fixture), bytes: Buffer.byteLength(source), sha256: createHash('sha256').update(source).digest('hex'),
            mode, round, reader, ...JSON.parse(worker.stdout) })
        }
      }
    }
  }
  console.log(JSON.stringify({ node: process.version, generatedAt: new Date().toISOString(), builds, results }, null, 2))
}
