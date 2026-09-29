import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'

const root = new URL('../', import.meta.url)
const data = JSON.parse(readFileSync(new URL('reports/parser-costs.json', root)))
assert.equal(data.groups.length, 96)
assert.equal(new Set(data.groups.map(g => [g.family, g.mode, g.round, g.reader].join('/'))).size, 96)
const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]
const rows = []
for (const family of [...new Set(data.groups.map(g => g.family))]) for (const mode of ['parse', 'no-positions', 'html']) {
  const get = (reader, round) => {
    const group = data.groups.find(g => g.family === family && g.mode === mode && g.reader === reader && g.round === round)
    assert.ok(group)
    assert.equal(group.samples.length, 5)
    assert.equal(group.heapIterations, 50)
    return group
  }
  const wall = reader => [0, 1].map(round => median(get(reader, round).samples.map(s => s.wallMs)).toFixed(3)).join(' / ')
  const allocation = reader => ([0, 1].reduce((sum, round) => sum + get(reader, round).sampledAllocationBytes, 0) / 100 / 1024).toFixed(1)
  rows.push(`| ${family} | ${mode} | ${get('baseline', 0).bytes} | ${wall('baseline')} | ${wall('candidate')} | ${allocation('baseline')} → ${allocation('candidate')} |`)
}
const loads = data.groups.flatMap(g => [g.loadStart[0], g.loadEnd[0]])
const report = `# Parser cost reductions

Recorded ${data.metadata.generatedAt} on ${data.metadata.node}, ${data.metadata.cpu}.
The baseline is commit \`${data.metadata.baseline.head}\`. Candidate source and
build hashes are recorded in the [raw observations](parser-costs.json); the
candidate was measured before committing the change.

## Changes

1. HTML eligibility and delimiter scans use native searches without creating
   a suffix string for every character. Rejected fast-path attempts benefit too.
2. The definition prepass returns early when the remaining source contains no
   opening bracket. All definitions and rejected-definition records require that
   character. Sources containing it still use the complete ownership scan.
   Skipping the pass also skips its speculative matcher probes; extension
   matchers must remain pure predicates.
3. Nested lexers receive their existing shared maps and sets at construction,
   avoiding allocations that were immediately discarded. Each lexer's fence
   memo remains independent and is allocated only when needed.
4. Newline indexing uses native searches. Trailing whitespace is checked at
   line ends instead of retrying a regex at every interior space. Unicode offset
   conversion builds its line-start table in the same pass as its offset table.

Internal source positions remain necessary for authored code payloads and
ownership decisions. The positions option keeps its existing output contract;
it does not disable all internal bookkeeping.

## Measurements

Wall cells retain the separate medians for rounds 1 and 2. Allocation combines
both 50-call samples and estimates churn, including collected objects, rather
than retained memory. CPU samples, timing ranges, fixture hashes and per-worker
host load are in the JSON.

| Fixture | API | Input bytes | Baseline wall ms, rounds 1 / 2 | Candidate wall ms, rounds 1 / 2 | Sampled KiB/op, baseline → candidate |
|---|---|---:|---:|---:|---:|
${rows.join('\n')}

${data.metadata.method}

One-minute host load ranged from ${Math.min(...loads).toFixed(2)} to ${Math.max(...loads).toFixed(2)} on
${data.metadata.logicalCpus} logical CPUs. These measurements come from a shared
host. They support inspecting individual costs, not a guaranteed throughput
ratio. Reversing run order does not remove host drift or JIT variation.

## Verification and reproduction

The benchmark compares complete ASTs, ASTs without positions and HTML before
measuring each fixture. The differential checker adds the pinned corpus and
3,000 deterministic generated inputs, including mixed line endings, Unicode,
definitions and opaque containers. The normal test suite covers the changes;
the interior-whitespace timing guard runs only with \`CARVE_PERF=1\`.

Build a clean checkout of the baseline commit, then run in the candidate tree:

\`\`\`sh
npm run build
node scripts/check-parser-costs.mjs /path/to/baseline/dist/index.js
node scripts/bench-parser-costs.mjs /path/to/baseline/dist/index.js reports/parser-costs.json
node scripts/report-parser-costs.mjs
CARVE_PERF=1 npx vitest run test/parser-costs.test.ts --maxWorkers=1 --minWorkers=1
\`\`\`
`
writeFileSync(new URL('reports/parser-costs.md', root), report)
