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
 * that differ, then holds that count under the ceiling in
 * `published-drift.ceiling`.
 *
 * It used to be an exact-equality ratchet against a baseline, checked in BOTH
 * directions so the number could not rot. That shape assumed a release would
 * come along and reset it to zero. Under a policy of not releasing on a
 * schedule it fails on every run instead, permanently, which is the one thing a
 * gate must not do: a red that is always red carries no information, and the
 * next real regression arrives into a job everybody already ignores.
 *
 * So the number is now a ceiling rather than a target. The value is a
 * JUDGEMENT, not a measurement, and it is edited by hand with a reason - there
 * is deliberately no flag that records the current count, because a gate that
 * accepts whatever it finds is the same thing as no gate.
 *
 * The starting value of 100 is "one skipped release round". Skipping the round
 * prepared on 2026-08-11 put the count at 78, so the ceiling sits above one
 * round and below two: breaching it means a second round has piled up behind
 * the first, which is the point at which the release is genuinely overdue
 * rather than deferred.
 *
 * Read that number honestly. The hand audit behind carve#608 found 38 corpus
 * documents differing and called it unacceptable; 78 is twice that. The ceiling
 * is not a claim that this is fine, it is a claim about when it stops being a
 * decision and starts being a backlog.
 *
 * The count is printed on every run, green included. A ceiling nobody watches
 * is how 38 documents accumulated unnoticed the first time.
 *
 * WHAT THE COUNT COUNTS. Both engines used to be run inside a `try` whose
 * `catch` skipped the document, so an exception removed it from the compared
 * set rather than reporting anything. That made the gate unfailable in the one
 * case it most needs to fail: a working tree whose engine threw on every corpus
 * document reported `0 of 1371 differ (1371 threw)` and exited 0, green and
 * under the ceiling, with nothing actually compared (carve-js#1366). A count
 * has to be a count of what was compared, so the two sides are separated now -
 * the working tree throwing aborts the run, and the published engine throwing
 * where the working tree does not is counted as a differing document, since a
 * consumer on that version cannot render it at all.
 *
 * Two things this measure is bad at, both of which carve-js#1039 addresses:
 * five repositories pin a git revision instead of installing from npm and are
 * invisible here (the worst is 256 commits behind, against 65 for the published
 * tag), and the document count is spiky - it went from 20 to 78 in a day
 * because a spec bump landed, not because consumers moved.
 *
 * Usage:
 *   node scripts/published-drift.mjs            # check against the ceiling
 */

import { execFileSync } from 'node:child_process'
import { appendFileSync, mkdtempSync, readdirSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

/**
 * Compare every corpus document through both engines.
 *
 * Exported and parameterized so the comparison can be exercised without an npm
 * install and a full corpus - the branches below are the ones a run in anger
 * almost never takes, which is exactly why they went unwatched.
 *
 * A THROW USED TO BE A SKIPPED DOCUMENT, on either side, which is how this gate
 * could pass while measuring nothing: a working tree whose engine threw on every
 * corpus document reported `0 of 1371 differ (1371 threw)` and exited 0 - green,
 * under the ceiling, with a completely broken engine (carve-js#1366). A count a
 * check reports has to be a count of what it compared, and an exception was
 * quietly removing documents from that set.
 *
 * The two sides are not symmetric, so they are not handled the same way:
 *
 * - THE WORKING TREE throwing is not drift at all. Nothing about the published
 *   package is in question when this build cannot render its own corpus, and a
 *   number derived from the documents that survived would be a SMALLER drift
 *   reported BECAUSE the engine got worse. The caller aborts on it.
 * - THE PUBLISHED ENGINE throwing where the working tree does not IS drift, and
 *   the sharpest kind: a consumer on that version cannot render the document at
 *   all. It counts as a differing document rather than vanishing from the set.
 */
export function compareCorpus({ files, read, local, published }) {
  const differing = []
  const localThrew = []
  const publishedThrew = []
  for (const file of files) {
    const source = read(file)
    let a, b
    try {
      a = local.carveToHtml(source)
    } catch (error) {
      localThrew.push({ file, message: error.message })
      continue
    }
    try {
      b = published.carveToHtml(source)
    } catch {
      publishedThrew.push(file)
      differing.push(file)
      continue
    }
    if (a !== b) differing.push(file)
  }
  return { differing, localThrew, publishedThrew }
}

const here = dirname(fileURLToPath(import.meta.url))
const repo = resolve(here, '..')
const ceilingFile = resolve(repo, 'published-drift.ceiling')
const corpusDir = resolve(repo, 'spec/tests/corpus')

// Side effects only when this file is RUN, so the exported comparison above can
// be imported by a test without installing the published package and exiting the
// process (the same shape `scripts/generate-wire-fields.mjs` uses).
if (process.argv[1] === fileURLToPath(import.meta.url)) {
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

  const { differing, localThrew, publishedThrew } = compareCorpus({
    files,
    read: (file) => readFileSync(join(corpusDir, file), 'utf8'),
    local,
    published,
  })
  rmSync(tmp, { recursive: true, force: true })

  // An empty corpus is not zero drift, it is nothing measured. The submodule
  // check above catches a missing directory; a directory holding no `.crv` at all
  // would otherwise walk zero documents, find zero differences and report a clean
  // bill of health for a comparison that never happened.
  if (files.length === 0) {
    console.error(`No corpus documents found in ${corpusDir}. Run: git submodule update --init`)
    process.exit(2)
  }

  if (localThrew.length > 0) {
    console.error(
      `The working tree failed to render ${localThrew.length} of ${files.length} corpus documents,\n` +
        'so there is no drift measurement to report - fix the engine first.\n',
    )
    for (const entry of localThrew.slice(0, 10)) console.error(`  ${entry.file}: ${entry.message}`)
    if (localThrew.length > 10) console.error(`  ... and ${localThrew.length - 10} more`)
    process.exit(2)
  }

  const publishedVersion = execFileSync('npm', ['view', '@markup-carve/carve', 'version'], {
    encoding: 'utf8',
  }).trim()

  const count = differing.length
  const ceilingText = readFileSync(ceilingFile, 'utf8').trim()
  const ceiling = Number(ceilingText)
  // A ceiling that is not a plain non-negative integer is a gate with no upper
  // bound: `Number('')` is 0 and `Number('1e9')` is a billion, and either would be
  // compared against silently. The value is a judgement someone wrote down by
  // hand, so it is read back as one.
  if (!Number.isInteger(ceiling) || ceiling < 0 || !/^\d+$/.test(ceilingText)) {
    console.error(
      `published-drift.ceiling holds ${JSON.stringify(ceilingText)}, which is not a non-negative integer.\n` +
        'The ceiling is a judgement about how far behind consumers may ship; it has to be a number to be one.',
    )
    process.exit(2)
  }

  const headline = `published ${publishedVersion} vs working tree: ${count} of ${files.length} corpus documents differ (${publishedThrew.length} the published engine could not render at all), ceiling ${ceiling}`
  console.log(headline)
  for (const f of differing.slice(0, 10)) console.log(`  ${f}`)
  if (differing.length > 10) console.log(`  ... and ${differing.length - 10} more`)

  // Reported on every run, not only on failure. The trend toward the ceiling is
  // the part worth seeing, and a job that only speaks when it fails hides it.
  if (process.env.GITHUB_STEP_SUMMARY) {
    const listed = differing.slice(0, 20).map((f) => `- \`${f}\``).join('\n')
    appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      `## Published engine drift\n\n${headline}\n\n${listed}\n` +
        (differing.length > 20 ? `\n_...and ${differing.length - 20} more._\n` : ''),
    )
  }

  if (count <= ceiling) {
    console.log(`Under the ceiling (${count} <= ${ceiling}).`)
    process.exit(0)
  }

  console.error(
    `\nDrift is over the ceiling: ${count} documents differ, ceiling ${ceiling}.\n` +
      'Publish a release (which drops this to 0), or raise the ceiling in\n' +
      '`published-drift.ceiling` with a commit message saying why this much is acceptable.\n' +
      'Raising it to whatever today happens to be is not an answer - the number is a\n' +
      'judgement about how far behind consumers may ship, and carve#608 is what it\n' +
      'looks like when nobody makes that judgement.',
  )
  process.exit(1)
}
