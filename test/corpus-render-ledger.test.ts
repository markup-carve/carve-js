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
 * the output has not moved since it was recorded, and a change that moves it
 * has to rewrite the line, so the diff names every document affected.
 *
 * Regenerate with `npm run ledger:render`. Read the diff: a moved document is a
 * replaced line, a new one is an added line.
 *
 * A document the ledger has never seen is REPORTED, not failed, while coverage
 * holds. The spec corpus grew by about 13 documents a day over the month to
 * 2026-09-21 and the downstream bump workflow moves the pin whenever spec main
 * does, so failing on an unrecorded document would put most pin bumps red for
 * bookkeeping. A regression moves output on the documents already recorded, so
 * the signal survives a few unrecorded ones; a ledger that has stopped
 * describing the corpus does not, which is what COVERAGE_FLOOR bounds.
 */

import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
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

/** Roughly a week of corpus growth. Beyond it the ledger needs regenerating. */
const COVERAGE_FLOOR = 0.95

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
if (updating) writeFileSync(ledgerPath, serialize(rendered))

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

describe('the non-HTML render ledger', () => {
  it('reads every document the spec examples derive', () => {
    // The floor. Every sweep below asserts that a list came out empty, and an
    // unbuilt or empty submodule produces exactly that.
    expect(unparsable, 'unparsable ledger line(s)').toEqual([])
    expect(slugs.length).toBe(expectedCorpusSize(specRoot))
  })

  it('still describes the corpus', () => {
    const covered = slugs.filter((slug) => recorded.has(slug)).length
    expect(
      covered / slugs.length,
      `the ledger covers ${covered} of ${slugs.length} corpus documents - ` +
        'run `npm run ledger:render`',
    ).toBeGreaterThanOrEqual(COVERAGE_FLOOR)
  })

  it('has no line whose document is gone', () => {
    const stale = [...recorded.keys()].filter((slug) => !rendered.has(slug))
    expect(stale, 'ledger line(s) whose document is gone - run `npm run ledger:render`')
      .toEqual([])
  })

  it('records the output every renderer still produces', () => {
    const moved: string[] = []
    for (const [slug, row] of rendered) {
      const was = recorded.get(slug)
      if (!was) continue
      for (const target of Object.keys(TARGETS) as Target[]) {
        if (was[target] !== row[target]) moved.push(`${slug} ${target}: ${was[target]} -> ${row[target]}`)
      }
    }
    expect(
      moved,
      `${moved.length} recorded output(s) moved. If the change is intended, ` +
        'run `npm run ledger:render` and review the rewritten lines.',
    ).toEqual([])
  })
})
