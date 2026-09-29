import assert from 'node:assert/strict'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
const root = new URL('../reports/', import.meta.url)
const read = name => {
  const plain = new URL(name, root)
  return JSON.parse(existsSync(plain) ? readFileSync(plain) : gunzipSync(readFileSync(new URL(name + '.gz', root))))
}
const data = read('parser-next-five.json')
const positions = read('position-removal-next-five.json')
const median = values => [...values].sort((a,b) => a-b)[Math.floor(values.length / 2)]
const families = [...new Set(data.groups.map(g => g.family))]
assert.equal(data.groups.length, families.length * 12)
assert.equal(new Set(data.groups.map(g => [g.family,g.mode,g.reader,g.round].join('/'))).size, data.groups.length)
const rows = []
for (const family of families) for (const mode of ['parse','no-positions','html']) {
  const groups = reader => data.groups.filter(g => g.family === family && g.mode === mode && g.reader === reader).sort((a,b) => a.round-b.round)
  for (const reader of ['baseline','candidate']) for (const g of groups(reader)) {
    assert.equal(g.samples.length,5); assert.equal(g.heapIterations,50)
  }
  const time = reader => groups(reader).map(g => median(g.samples.map(s => s.wallMs)).toFixed(3)).join(' / ')
  const cpu = reader => groups(reader).map(g => median(g.samples.map(s => s.cpuMs)).toFixed(3)).join(' / ')
  const heap = reader => (groups(reader).reduce((s,g) => s + g.sampledAllocationBytes/g.heapIterations,0)/2/1024).toFixed(1)
  rows.push(`| ${family} | ${mode} | ${groups('baseline')[0].bytes} | ${time('baseline')} | ${time('candidate')} | ${cpu('baseline')} | ${cpu('candidate')} | ${heap('baseline')} → ${heap('candidate')} |`)
}
const drops = []
for (const family of [...new Set(positions.results.map(g => g.family))]) {
  const groups = reader => positions.results.filter(g => g.family === family && g.reader === reader).sort((a,b) => a.round-b.round)
  assert.equal(groups('baseline').length,2); assert.equal(groups('candidate').length,2)
  for (const reader of ['baseline','candidate']) for (const g of groups(reader)) {
    assert.equal(g.samples.length,5); assert.equal(g.calls,100)
  }
  const time = reader => groups(reader).map(g => median(g.samples.map(s => s.wallMs)).toFixed(3)).join(' / ')
  const heap = reader => (groups(reader).reduce((s,g) => s+g.sampledAllocationBytes/g.calls,0)/2/1024).toFixed(1)
  drops.push(`| ${family} | ${time('baseline')} | ${time('candidate')} | ${heap('baseline')} → ${heap('candidate')} |`)
}
const hotspots = []
for (const family of ['plain-paragraphs','inline-links','lists-192','quotes-192','long-unicode','unicode-paragraphs']) {
  for (const reader of ['baseline','candidate']) {
    const groups = data.groups.filter(g => g.family === family && g.mode === 'parse' && g.reader === reader)
    const cpu = new Map(), heap = new Map()
    for (const g of groups) {
      for (const f of g.cpuFrames) if (f.url.includes('/dist/')) cpu.set(f.functionName,(cpu.get(f.functionName) ?? 0)+f.selfUs/g.cpuIterations/2/1000)
      for (const f of g.heapFrames) if (f.url.includes('/dist/')) heap.set(f.functionName,(heap.get(f.functionName) ?? 0)+f.sampledBytes/g.heapIterations/2/1024)
    }
    const top = (map,unit) => [...map].sort((a,b) => b[1]-a[1]).slice(0,3).map(([name,value]) => `\`${name || '(anonymous)'}\` ${value.toFixed(3)} ${unit}`).join('; ')
    hotspots.push(`| ${family} | ${reader} | ${top(cpu,'ms/op')} | ${top(heap,'KiB/op')} |`)
  }
}
const loads = data.groups.flatMap(g => [g.loadStart[0],g.loadEnd[0]])
const report = `# Parser traversal and Unicode measurements

Baseline: \`${data.metadata.baseline.head}\`. Recorded ${data.metadata.generatedAt}
on ${data.metadata.node}, ${data.metadata.cpu}. The [observations](parser-next-five.json.gz)
record source/build hashes, five timing batches per worker, CPU profiles and
sampled allocation. Two worker rounds reverse baseline/candidate order.

## Changes

- Position removal visits children before deleting position fields. It skips
  those fields during traversal and still deletes non-enumerable own positions.
- Container lexers share collected immutable line arrays. Offset mapping builds
  the parent's line-number index only when literal strip origins cannot anchor a line.
- Ordinary non-ASCII text joins the existing plain-text paths. Every ASCII
  syntax opener and active extension matcher retains the authoritative scan.
- Reference resolution skips empty definition maps and keeps child arrays while
  resolving nodes in place. Unresolved heading references remain available.
- The two deep-quote scaling guards use batches of at least 20 ms, warm both
  sizes and retain the 2× per-byte threshold, reversed order and five rounds.

## Parse and render observations

Allocation is sampled churn, including collected objects, not peak or retained
memory. Profiles run separately from timing. Each raw observation retains the
64 largest CPU and heap frames, omitted counts and full sampled allocation totals.
Host one-minute load ranged from ${Math.min(...loads).toFixed(2)} to ${Math.max(...loads).toFixed(2)} on ${data.metadata.logicalCpus} logical CPUs.
Process CPU includes worker CPU consumed during a timed batch; it excludes
time waiting to be scheduled, but does not remove frequency and GC variation.
Both timing rounds remain visible; these results do not establish a general
speed ranking or attribute every difference to an individual change.

| Fixture | API | Input bytes | Baseline wall ms, rounds 1 / 2 | Candidate wall ms, rounds 1 / 2 | Baseline CPU ms, rounds 1 / 2 | Candidate CPU ms, rounds 1 / 2 | Sampled KiB/op, baseline → candidate |
|---|---|---:|---:|---:|---:|---:|---:|
${rows.join('\n')}

## Position removal alone

Each batch prepares 100 ASTs before timing removal; parsing and GC are outside
that interval. Each tree is checked against position-free parsing afterward.
The [separate profiles](position-removal-next-five.json.gz) include profiler control overhead.

| Fixture | Baseline ms, rounds 1 / 2 | Candidate ms, rounds 1 / 2 | Sampled KiB/op, baseline → candidate |
|---|---:|---:|---:|
${drops.join('\n')}

## Sampled implementation hotspots

Frames below are normalized per profile operation and averaged across both
rounds. Runtime frames are excluded from this shortlist but remain in the raw
observations. Self time and allocation identify costs; they do not prove a
cause for every timing difference. Line locations are recorded in the raw data.

| Fixture | Reader | CPU frames | Allocation frames |
|---|---|---|---|
${hotspots.join('\n')}

## Verification and limits

The full performance suite passed on the baseline and candidate locally. The
reported failure in #2405 was 2.28× per-byte growth on a short deep-quote sample;
the guard threshold has not been relaxed. The [full GitHub scaling run](https://github.com/markup-carve/carve-js/actions/runs/36642217388)
also passed for source commit \`1cc6b3f5b\`.
The differential checker covers 2,134 corpus and 3,000 generated sources, full
ASTs, position-free ASTs and HTML. Focused tests cover Unicode, surrogate halves,
line blocks, tables, mixed endings, extension matching and heading fallback.

Shared arrays remove a container copy; they do not eliminate recursive body
collection or make all container processing linear. Internal positions are
still built before removal. Newline indexes keep their existing document cache.

## Reproduction

Build a checkout of the baseline and this branch, then run:

\`\`\`sh
npm run build
node scripts/check-parser-costs.mjs /path/to/baseline/dist/index.js
node scripts/bench-parser-followups.mjs /path/to/baseline/dist/index.js reports/parser-next-five.json
node scripts/profile-position-removal.mjs /path/to/baseline/dist/index.js reports/position-removal-next-five.json
gzip -n reports/parser-next-five.json reports/position-removal-next-five.json
node scripts/report-parser-next-five.mjs
npm run test:perf
\`\`\`
`
writeFileSync(new URL('parser-next-five.md',root),report)
