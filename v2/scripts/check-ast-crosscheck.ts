// Classifies the findings from the spec's 100,000-mutant schema cross-check.
//   node v2/scripts/check-ast-crosscheck.ts PATH_TO_FINDINGS.json.gz
import { readFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'

interface Failure {
  tree?: unknown
  mutant?: unknown
  engineError?: string | null
}

interface Report {
  summary: { produced: number, mutants: number, producedFailures: number, disagreements: number }
  producedFailures: Failure[]
  findings: (Failure & { classification: string })[]
}

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function nodes(value: unknown): Record<string, unknown>[] {
  const found: Record<string, unknown>[] = []
  const pending = [value]
  while (pending.length > 0) {
    const item = pending.pop()
    if (Array.isArray(item)) for (const child of item) pending.push(child as unknown)
    else if (object(item)) {
      if (typeof item['type'] === 'string') found.push(item)
      pending.push(...Object.values(item))
    }
  }
  return found
}

function schemaGap(tree: unknown): string | null {
  for (const node of nodes(tree)) {
    const gap = gapForNode(node)
    if (gap !== null) return gap
  }
  return null
}

function gapForNode(node: Record<string, unknown>): string | null {
  if ((node['type'] === 'link' || node['type'] === 'image') && node['key'] !== undefined && node['refForm'] !== undefined) {
    return 'refForm dependency'
  }
  if (node['type'] === 'inline_extension' && node['name'] === '_') return 'underscore extension'
  if (node['type'] !== 'include' || !object(node['options'])) return null
  for (const field of ['lines', 'rows', 'cols']) {
    const value = node['options'][field]
    if (typeof value === 'string' && !/^[1-9][0-9]*-[1-9][0-9]*$/.test(value)) return 'include range'
  }
  return null
}

const BEYOND_SCHEMA = [
  'an undeclared extension name', 'an undeclared data name', 'no resource has the id', 'no header cell has the id',
  'the document and envelope versions differ', 'fallbacks are nested deeper', 'the tree is nested deeper',
  'the start lies behind the end', 'coordinates disagree with the source', 'a node in an opaque object',
  'extension nesting exceeds 32',
]

function explained(finding: Failure & { classification?: string }): string | null {
  if (finding.classification === 'schema wrong') {
    const error = finding.engineError ?? ''
    return BEYOND_SCHEMA.find((reason) => error.includes(reason)) ?? null
  }
  return schemaGap(finding.tree ?? finding.mutant)
}

const path = process.argv[2]
if (path === undefined) throw new Error('pass the findings file')
const report = JSON.parse(gunzipSync(readFileSync(path)).toString('utf8')) as Report
const all = [...report.producedFailures, ...report.findings]
const counts = new Map<string, number>()
for (const finding of all) {
  const kind = explained(finding) ?? 'unexplained'
  counts.set(kind, (counts.get(kind) ?? 0) + 1)
}
process.stdout.write(`${JSON.stringify({ ...report.summary, explained: Object.fromEntries(counts) })}\n`)
if (report.summary.mutants !== 100000 || report.summary.producedFailures !== report.producedFailures.length
  || report.summary.disagreements !== report.findings.length || counts.has('unexplained')) {
  process.exitCode = 1
}
