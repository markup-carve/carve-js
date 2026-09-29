import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
const root = new URL('../reports/', import.meta.url)
const read = name => {
  const plain = new URL(name, root)
  return JSON.parse(existsSync(plain) ? readFileSync(plain) : gunzipSync(readFileSync(new URL(name + '.gz', root))))
}
const data = read('parser-followups.json')
const positions = read('position-removal.json')
const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]
const families = [...new Set(data.groups.map(g => g.family))]
assert.equal(data.groups.length, families.length * 12)
assert.equal(new Set(data.groups.map(g => [g.family, g.mode, g.round, g.reader].join('/'))).size, data.groups.length)
const get = (family, mode, reader, round) => {
  const g = data.groups.find(g => g.family === family && g.mode === mode && g.reader === reader && g.round === round)
  assert.equal(g.samples.length, 5); assert.equal(g.heapIterations, 50)
  return g
}
const rows = []
for (const family of families) for (const mode of ['parse', 'no-positions', 'html']) {
  const timing = reader => [0, 1].map(round => median(get(family, mode, reader, round).samples.map(s => s.wallMs)).toFixed(3)).join(' / ')
  const heap = reader => ([0, 1].reduce((sum, round) => sum + get(family, mode, reader, round).sampledAllocationBytes, 0) / 100 / 1024).toFixed(1)
  rows.push(`| ${family} | ${mode} | ${get(family, mode, 'baseline', 0).bytes} | ${timing('baseline')} | ${timing('candidate')} | ${heap('baseline')} → ${heap('candidate')} |`)
}
const dropRows = []
for (const family of [...new Set(positions.results.map(r => r.family))]) {
  const groups = reader => positions.results.filter(r => r.family === family && r.reader === reader).sort((a,b) => a.round-b.round)
  const timing = reader => groups(reader).map(g => median(g.samples.map(s => s.wallMs)).toFixed(3)).join(' / ')
  const heap = reader => (groups(reader).reduce((sum,g) => sum + g.sampledAllocationBytes / g.calls,0) / 2 / 1024).toFixed(1)
  dropRows.push(`| ${family} | ${timing('baseline')} | ${timing('candidate')} | ${heap('baseline')} → ${heap('candidate')} |`)
}
const hotspots = []
for (const family of ['plain-paragraphs', 'inline-links', 'lists-192', 'quotes-192', 'long-ascii', 'unicode-paragraphs']) {
  for (const reader of ['baseline', 'candidate']) {
    const groups = [0,1].map(round => get(family,'parse',reader,round))
    const cpu = new Map(), heap = new Map()
    for (const g of groups) {
      for (const f of g.cpuFrames) if (f.url.includes('/dist/')) cpu.set(f.functionName, (cpu.get(f.functionName) ?? 0) + f.selfUs / g.cpuIterations / 2 / 1000)
      for (const f of g.heapFrames) if (f.url.includes('/dist/')) heap.set(f.functionName, (heap.get(f.functionName) ?? 0) + f.sampledBytes / g.heapIterations / 2 / 1024)
    }
    const top = (map, unit) => [...map].sort((a,b) => b[1]-a[1]).slice(0,3).map(([name,n]) => `\`${name || '(anonymous)'}\` ${n.toFixed(3)} ${unit}`).join('; ')
    hotspots.push(`| ${family} | ${reader} | ${top(cpu,'ms/op')} | ${top(heap,'KiB/op')} |`)
  }
}
const loads = data.groups.flatMap(g => [g.loadStart[0],g.loadEnd[0]])
const report = `# Parser performance follow-ups

Baseline: \`${data.metadata.baseline.head}\`. Recorded ${data.metadata.generatedAt}
on ${data.metadata.node}, ${data.metadata.cpu}. Candidate source/build hashes,
CPU frame locations and allocation samples are in [the observations](parser-followups.json.gz).

## Changes

- #2390: position removal walks own enumerable properties without creating a
  key array for every object. Shared/cyclic extension state and attribute rules
  are preserved. Internal positions remain available during parsing.
- #2391: definition collection requires a line containing \`]: \`, the shared
  sequence in every definition spelling. Other bracket uses skip the complete
  pass. A possible definition still receives the full ownership scan.
- #2392: quote/list fence memo maps and list comment-payload maps are created
  only when used. They retain their existing container scopes.
- #2393: single-line paragraphs avoid a mapped line array. Ordinary ASCII
  letters, digits, spaces and tabs use a plain-text inline path when no
  extension matcher is active. Punctuation, Unicode and multiline text retain
  the authoritative scanner.

## Paired observations

Wall cells keep rounds separate. Allocation combines two 50-call samples and
measures churn, including collected objects. It is not retained or peak memory.
CPU profiles are separate from timing batches. Each observation keeps the
64 largest CPU and heap frames; omitted frame counts and full allocation totals
are recorded. The shortlist below filters to implementation frames. Sampled frames identify costs;
they do not establish causality for every timing difference.

| Fixture | API | Input bytes | Baseline wall ms, rounds 1 / 2 | Candidate wall ms, rounds 1 / 2 | Sampled KiB/op, baseline → candidate |
|---|---|---:|---:|---:|---:|
${rows.join('\n')}

${data.metadata.method}

Host one-minute load ranged from ${Math.min(...loads).toFixed(2)} to ${Math.max(...loads).toFixed(2)} on
${data.metadata.logicalCpus} logical CPUs. Timing variation and regressions remain
visible. These measurements are workload observations, not general speed claims.
Nesting is bounded; this change does not make all container processing linear
in source length.

## Position removal alone

Each worker prepares 100 ASTs before measuring each of five batches. Parsing,
GC and parity checks stay outside the measured removal interval. A separate
100-call allocation/CPU profile contains only removal operations and profiler
control overhead. See [the raw profiles](position-removal.json.gz). Each removed
tree is checked against the same reader's position-free parse.

| Fixture | Baseline ms, rounds 1 / 2 | Candidate ms, rounds 1 / 2 | Sampled KiB/op, baseline → candidate |
|---|---:|---:|---:|
${dropRows.join('\n')}

The removal pass is slower in both rounds for all four fixtures. Sampled allocation
is lower for paragraphs, definitions and lists, but higher for quotes. This is
an allocation tradeoff, not a position-removal speed improvement. Internal
position construction remains a separate cost.

## Current parse hotspots

Top implementation frames by sampled self time and allocation. Runtime frames
are excluded from this shortlist, but remain in the raw data. The two rounds
are normalized per profile operation before averaging. Line numbers refer to
the installed JavaScript.

| Fixture | Reader | CPU frames | Allocation frames |
|---|---|---|---|
${hotspots.join('\n')}

## Reproduction

Build both checkouts. Run the scripts from the candidate checkout:

\`\`\`sh
npm run build
node scripts/check-parser-costs.mjs /path/to/baseline/dist/index.js
node scripts/bench-parser-followups.mjs /path/to/baseline/dist/index.js reports/parser-followups.json
node scripts/profile-position-removal.mjs /path/to/baseline/dist/index.js reports/position-removal.json
gzip -n reports/parser-followups.json reports/position-removal.json
node scripts/report-parser-followups.mjs
\`\`\`

The differential checker compares full ASTs, position-free ASTs and HTML across
2,134 corpus documents and 3,000 deterministic generated sources. The benchmark
also checks both AST variants and HTML before timing each fixture. Regression
tests cover extension matching, abbreviation expansion, nested definitions,
opaque code, shared/cyclic objects and inherited properties.
`
writeFileSync(new URL('parser-followups.md', root), report)
