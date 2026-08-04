#!/usr/bin/env node
/*
 * How far is the PUBLISHED engine behind this working tree?
 *
 * Nine repositories install `@markup-carve/carve` from npm rather than pinning
 * a git revision, so what they ship is whatever was last published - and
 * nothing anywhere measured the difference. It reached 176 commits and 38
 * corpus documents before anyone counted, and the only reason anyone counted
 * was a manual audit (carve#608). Their tests pass; being behind the language
 * is not a thing their CI can see.
 *
 * This renders the spec corpus through both engines and counts the documents
 * that differ, then compares that count against `published-drift.baseline`.
 * Green while the drift matches the baseline; red when it grows. Moving the
 * baseline is a commit that says "we accept shipping this far behind", and a
 * release resets it to zero.
 *
 * The ratchet shape is deliberate: the spec repo uses it for the refusal set
 * and the schema-field exemptions, both checked in BOTH directions so a state
 * cannot rot in either. Here that means a SHRINKING drift fails too - it says
 * the baseline is stale and someone published without resetting it.
 *
 * Usage:
 *   node scripts/published-drift.mjs            # check against the baseline
 *   node scripts/published-drift.mjs --write    # record the current count
 */

import { execFileSync } from 'node:child_process'
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const repo = resolve(here, '..')
const baselineFile = resolve(repo, 'published-drift.baseline')
const corpusDir = resolve(repo, 'spec/tests/corpus')

if (!existsSync(corpusDir)) {
  console.error(`Spec corpus not found at ${corpusDir}. Run: git submodule update --init`)
  process.exit(2)
}

const local = await import(resolve(repo, 'dist/index.js'))

// The published build goes in a throwaway prefix so it cannot shadow the
// working tree's own node_modules.
const tmp = mkdtempSync(join(tmpdir(), 'carve-published-'))
let published
try {
  execFileSync('npm', ['install', '--silent', '--no-audit', '--no-fund', '--prefix', tmp, '@markup-carve/carve@latest'], {
    stdio: ['ignore', 'ignore', 'inherit'],
  })
  published = await import(join(tmp, 'node_modules/@markup-carve/carve/dist/index.js'))
} catch (error) {
  console.error(`Could not install the published engine: ${error.message}`)
  rmSync(tmp, { recursive: true, force: true })
  process.exit(2)
}

const files = readdirSync(corpusDir).filter((f) => f.endsWith('.crv')).sort()
const differing = []
let threw = 0
for (const file of files) {
  const source = readFileSync(join(corpusDir, file), 'utf8')
  let a, b
  try { a = local.carveToHtml(source) } catch { threw++; continue }
  try { b = published.carveToHtml(source) } catch { threw++; continue }
  if (a !== b) differing.push(file)
}
rmSync(tmp, { recursive: true, force: true })

const publishedVersion = execFileSync('npm', ['view', '@markup-carve/carve', 'version'], {
  encoding: 'utf8',
}).trim()

const count = differing.length
console.log(`published ${publishedVersion} vs working tree: ${count} of ${files.length} corpus documents differ (${threw} threw)`)
for (const f of differing.slice(0, 10)) console.log(`  ${f}`)
if (differing.length > 10) console.log(`  ... and ${differing.length - 10} more`)

if (process.argv.includes('--write')) {
  writeFileSync(baselineFile, `${count}\n`)
  console.log(`Wrote baseline ${count}`)
  process.exit(0)
}

const baseline = Number(readFileSync(baselineFile, 'utf8').trim())
if (count === baseline) {
  console.log(`Matches the baseline (${baseline}).`)
  process.exit(0)
}

// Both directions, for the reason in the header.
console.error(
  count > baseline
    ? `\nDrift GREW: ${count} documents differ, baseline ${baseline}. Either publish a release (which resets this to 0) or record the new number deliberately:\n  node scripts/published-drift.mjs --write`
    : `\nDrift SHRANK: ${count} documents differ, baseline ${baseline}. A release was published without resetting the baseline; record it:\n  node scripts/published-drift.mjs --write`,
)
process.exit(1)
