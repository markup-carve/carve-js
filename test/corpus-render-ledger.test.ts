/*
 * The Markdown, plain-text and ANSI output of EVERY corpus document, pinned.
 *
 * `corpus-render-fixtures.test.ts` asserts the reviewed bytes the spec ships,
 * and that population is thin: 39 documents on markdown, 13 on plain and 13 on
 * ansi out of 1740. Every other document reaches these three renderers only
 * through `compare:impls` in the spec repo, which runs on a nightly schedule
 * and reports engine-to-engine DISAGREEMENT - so a regression this engine makes
 * on its own surfaces the next morning, in another repository, beside whatever
 * else landed overnight.
 *
 * A digest line is not a correctness claim; the reviewed fixtures are. It says
 * the output has not moved since it was recorded, and the report below names
 * every document a change moves.
 *
 * The ledger on `main` is regenerated after every merge by
 * `.github/workflows/ledger-refresh.yml`, which opens an
 * `automation/render-ledger` PR. A pull request does not regenerate or commit
 * it: moved, added and removed rows are reported (and written to the job
 * summary) rather than failed, so two PRs that move the same row never
 * conflict. Read the report to see which documents a change moves.
 *
 * `npm run ledger:render` rewrites the file locally; that is the automation's
 * command, not a step for a PR.
 */

import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { appendFileSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { carveToAnsi, carveToMarkdown, carveToPlainText } from '../src/index.js'
import { expectedCorpusSize } from './helpers/corpus-population.js'

const here = dirname(fileURLToPath(import.meta.url))
const specRoot = resolve(here, '../spec')
const corpusDir = resolve(specRoot, 'tests/corpus')
const ledgerPath = resolve(here, 'fixtures/corpus-render-ledger.txt')

const TARGETS = {
  md: carveToMarkdown,
  txt: carveToPlainText,
  ansi: carveToAnsi,
} as const

type Target = keyof typeof TARGETS
type Row = Record<Target, string>

const HEADER = [
  '# carve-js non-HTML render ledger.',
  '# <slug> md:<digest> txt:<digest> ansi:<digest>, sha-256 truncated to 16 hex.',
  '# Regenerate with `npm run ledger:render`.',
]
const LINE = /^(\S+) md:([0-9a-f]{16}) txt:([0-9a-f]{16}) ansi:([0-9a-f]{16})$/

const digest = (value: string) => createHash('sha256').update(value).digest('hex').slice(0, 16)

const slugs = readdirSync(corpusDir)
  .filter((name) => name.endsWith('.crv'))
  .map((name) => name.slice(0, -'.crv'.length))
  .sort()

const rendered = new Map<string, Row>()
for (const slug of slugs) {
  const source = readFileSync(resolve(corpusDir, `${slug}.crv`), 'utf8')
  rendered.set(slug, {
    md: digest(TARGETS.md(source)),
    txt: digest(TARGETS.txt(source)),
    ansi: digest(TARGETS.ansi(source)),
  })
}

const serialize = (rows: Map<string, Row>) =>
  `${[
    ...HEADER,
    ...[...rows].map(([slug, row]) => `${slug} md:${row.md} txt:${row.txt} ansi:${row.ansi}`),
  ].join('\n')}\n`

// An update run rewrites the file before reading it back, so it is green by
// construction. That is the point of the flag, and CI never sets it.
const updating = process.env.UPDATE_RENDER_LEDGER === '1'

const recorded = new Map<string, Row>()
const unparsable: string[] = []
for (const line of readFileSync(ledgerPath, 'utf8').split('\n')) {
  if (line === '' || line.startsWith('#')) continue
  const match = LINE.exec(line)
  if (!match) {
    unparsable.push(line)
    continue
  }
  recorded.set(match[1], { md: match[2], txt: match[3], ansi: match[4] })
}

if (updating) {
  const added = slugs.filter((slug) => !recorded.has(slug))
  const removed = [...recorded.keys()].filter((slug) => !rendered.has(slug))
  const changed: string[] = []
  for (const [slug, row] of rendered) {
    const was = recorded.get(slug)
    if (was === undefined) continue
    for (const target of Object.keys(TARGETS) as Target[]) {
      if (was[target] !== row[target]) changed.push(`${slug} ${target}: ${was[target]} -> ${row[target]}`)
    }
  }
  console.info(`Ledger update: ${added.length} added documents, ${changed.length} changed outputs, ${removed.length} removed documents.`)
  if (added.length > 0) console.info(`Added documents:\n${added.join('\n')}`)
  if (changed.length > 0) console.info(`Changed outputs:\n${changed.join('\n')}`)
  if (removed.length > 0) console.info(`Removed documents:\n${removed.join('\n')}`)
  writeFileSync(ledgerPath, serialize(rendered))
  recorded.clear()
  for (const [slug, row] of rendered) recorded.set(slug, row)
}

const missing = slugs.filter((slug) => !recorded.has(slug))
const stale = [...recorded.keys()].filter((slug) => !rendered.has(slug))
const moved: string[] = []
for (const [slug, row] of rendered) {
  const was = recorded.get(slug)
  if (!was) continue
  for (const target of Object.keys(TARGETS) as Target[]) {
    if (was[target] !== row[target]) moved.push(`${slug} ${target}: ${was[target]} -> ${row[target]}`)
  }
}

// Informational: the post-merge automation owns the file, so a difference
// against main's ledger is a report for the reviewer, not a failure.
const report = [
  ['Output moved', moved],
  ['Document without a row', missing],
  ['Row whose document is gone', stale],
] as const
if (report.some(([, rows]) => rows.length > 0)) {
  const lines = [
    '### carve-js render ledger (informational)',
    '',
    'Rows this change moves against the ledger on main. Do not regenerate the ledger in a PR: ' +
      '`ledger-refresh.yml` updates it after the merge.',
    '',
  ]
  for (const [title, rows] of report) {
    if (rows.length === 0) continue
    lines.push(`${title} (${rows.length}):`, '', '```', ...rows, '```', '')
  }
  const text = `${lines.join('\n')}\n`
  console.info(text)
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, text)
}

describe('the non-HTML render ledger', () => {
  it('reads every document the spec examples derive', () => {
    // The floor. An unbuilt or empty submodule renders nothing at all, and the
    // report above would be empty for the wrong reason.
    expect(unparsable, 'unparsable ledger line(s)').toEqual([])
    expect(slugs.length).toBe(expectedCorpusSize(specRoot))
  })
})
