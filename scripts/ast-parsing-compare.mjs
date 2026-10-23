import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { cpus, loadavg } from 'node:os'
import { pathToFileURL } from 'node:url'

const [beforePath, afterPath, sourcePath, importOrder = 'before-first'] = process.argv.slice(2)
assert.ok(beforePath && afterPath && sourcePath)
assert.ok(importOrder === 'before-first' || importOrder === 'after-first')
assert.ok(global.gc, 'run with --expose-gc')
const iterations = Number(process.env.AST_ITERATIONS ?? 1000)
const pairs = Number(process.env.AST_PAIRS ?? 20)
const warmup = Number(process.env.AST_WARMUP ?? 1000)
for (const value of [iterations, pairs, warmup]) assert.ok(Number.isSafeInteger(value) && value > 0)

const paths = { before: beforePath, after: afterPath }
const order = importOrder === 'before-first' ? ['before', 'after'] : ['after', 'before']
const modules = {}
for (const key of order) modules[key] = await import(pathToFileURL(paths[key]).href)
const source = readFileSync(sourcePath, 'utf8')
const render = Object.fromEntries(['before', 'after'].map(key => {
  assert.equal(typeof modules[key].carveToHtml, 'function')
  return [key, () => modules[key].carveToHtml(source)]
}))
const expected = render.before()
assert.equal(render.after(), expected, 'HTML output changed')
let sink = 0
for (let i = 0; i < warmup; i++) {
  sink += render.before().length
  sink += render.after().length
}

const rows = []
const loadStart = loadavg()[0]
for (let index = 0; index < pairs; index++) {
  const row = {}
  const pairOrder = index % 2 === 0 ? order : [...order].reverse()
  for (const key of pairOrder) {
    global.gc()
    const start = process.cpuUsage()
    for (let i = 0; i < iterations; i++) sink += render[key]().length
    const cpu = process.cpuUsage(start)
    row[key] = (cpu.user + cpu.system) / 1000 / iterations
  }
  rows.push({ before_ms: row.before, after_ms: row.after, ratio: row.after / row.before })
}
const median = values => {
  const sorted = [...values].sort((a, b) => a - b)
  return (sorted[(sorted.length - 1) >> 1] + sorted[sorted.length >> 1]) / 2
}
const ratios = rows.map(row => row.ratio)
console.log(JSON.stringify({
  schema: 1,
  before: process.env.AST_BEFORE_COMMIT,
  after: process.env.AST_AFTER_COMMIT,
  source_sha256: createHash('sha256').update(source).digest('hex'),
  output_sha256: createHash('sha256').update(expected).digest('hex'),
  node: process.version,
  cpu: cpus()[0]?.model,
  import_order: importOrder,
  iterations,
  pairs,
  warmup,
  load_start: loadStart,
  load_end: loadavg()[0],
  median_ratio: median(ratios),
  range: [Math.min(...ratios), Math.max(...ratios)],
  rows,
  sink,
}))
