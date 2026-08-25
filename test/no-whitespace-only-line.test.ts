import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { carveToCarve, carveToHtml } from '../src/index.js'
import { expectedCorpusSize } from './helpers/corpus-population.js'

/**
 * PART 11 §7: `fmt` never emits a line whose only content is ASCII space or
 * tab. Such a line is emitted empty.
 *
 * A whitespace-only line is not stable - editors that strip trailing whitespace
 * on save, `git apply --whitespace=fix` and CI whitespace checks all rewrite it,
 * so a formatter emitting one produces output that ordinary tooling changes
 * behind it, and then reports a diff on a file nobody edited (carve#375).
 *
 * This engine was already the conformant one on the shape that was reported, so
 * this is a regression guard rather than a fix. It is a sweep over the whole
 * corpus because the reported shape was a list item and the sibling engines
 * turned out to have the same defect in definition lists, footnote
 * continuations and nested lists.
 */

/**
 * Sites the sweep still tolerates. Listed rather than filtered out of it, so
 * they stay visible.
 *
 * Empty: its one entry named `73-list-nesting-and-looseness-5.crv:3`, a fenced
 * block in a list item whose indentation sentinel hid the structural indent on
 * a line with no verbatim content. Upstream renumbered that document to 75, so
 * the entry named no file and excused nothing, and the renumbered document
 * emits no such line - the sweep is green with the set empty. The guard below
 * is what makes the next one of these fail instead of rot.
 */
const KNOWN_REMAINING = new Set<string>([])

/**
 * ASCII space and tab only. A trailing no-break space is content the author
 * wrote - it renders as `&nbsp;` - and JS `trim()` would treat U+00A0 as
 * whitespace, which corpus case 139 pins against.
 */
const offendingLines = (slug: string, out: string): string[] =>
  out
    .split('\n')
    .map((line, i) => ({ line, site: `${slug}:${i + 1}` }))
    .filter(({ line }) => line.length > 0 && line.replace(/[ \t]+/g, '') === '')
    .map(({ site }) => site)

/*
 * A SITE THAT NAMES NO CORPUS FILE IS NOT AN EXEMPTION.
 *
 * The sweep below only consults this set for a site it actually produced, so an
 * entry naming a file the corpus no longer has is consulted never, excuses
 * nothing, and still reads as a live carve-out. Corpus files carry the spec's
 * ordering number, which shifts whenever a section is inserted upstream, so
 * that is the ordinary way an entry here goes stale. Same guard shape as
 * AHEAD_OF_PIN in `test/corpus.test.ts`.
 */
describe('KNOWN_REMAINING', () => {
  it('names only corpus files that exist', () => {
    const dir = resolve(import.meta.dirname, '../spec/tests/corpus')
    const files = new Set(readdirSync(dir))
    const orphaned = [...KNOWN_REMAINING]
      .map((site) => site.slice(0, site.lastIndexOf(':')))
      .filter((file) => !files.has(file))
      .sort()
    expect(
      orphaned,
      'renumbered upstream, or already retired - either way the entry excuses nothing',
    ).toEqual([])
  })
})

describe('the writer never emits a whitespace-only line', () => {
  const dir = resolve(import.meta.dirname, '../spec/tests/corpus')
  const inputs = readdirSync(dir).filter((f) => f.endsWith('.crv'))

  /**
   * ONE PASS, BOTH DIRECTIONS. The produced set is what the staleness half
   * below reads, so the two questions are answered over the same run rather
   * than over two sweeps that could disagree about what the corpus is.
   */
  const sweep = () => {
    const produced = new Set<string>()
    for (const slug of inputs) {
      const out = carveToCarve(readFileSync(resolve(dir, slug), 'utf8'))
      for (const site of offendingLines(slug, out)) produced.add(site)
    }
    return produced
  }

  it('holds across the whole corpus', () => {
    expect(inputs.length).toBe(expectedCorpusSize(resolve(import.meta.dirname, '../spec')))
    const failures = [...sweep()].filter((site) => !KNOWN_REMAINING.has(site)).sort()
    expect(failures).toEqual([])
  })

  /*
   * A SITE THAT IS NO LONGER PRODUCED IS NOT AN EXEMPTION EITHER.
   *
   * The orphan guard above catches an entry whose FILE is gone - the ordinary
   * way one rots here, since corpus files carry the spec's ordering number. It
   * cannot catch the other way: a file that still exists and stopped emitting
   * the line. `has(site)` only ever suppresses a failure, so such an entry sits
   * here reading as a live carve-out and no run objects.
   *
   * That is not hypothetical. carve-php carried this list's twin with NEITHER
   * guard, and its single entry named a document upstream had renumbered - dead
   * in both directions, reported by nothing (markup-carve/carve-php#1687). The
   * deletion made that ledger honest once; this is what stops it recurring.
   */
  it('is behind only what it is still behind on', () => {
    const produced = sweep()
    const stale = [...KNOWN_REMAINING].filter((site) => !produced.has(site)).sort()
    expect(
      stale,
      `${stale.join(', ')} is no longer emitted: delete the KNOWN_REMAINING entry in the same commit that proves it`,
    ).toEqual([])
  })

  it('emits a blank line inside a list item empty', () => {
    const src = '1. one\n\n    > q\n'
    const out = carveToCarve(src)
    expect(out).toBe('1. one\n   > q\n')
    expect(offendingLines('inline', out)).toEqual([])
    expect(carveToHtml(out)).toBe(carveToHtml(src))
    expect(carveToCarve(out)).toBe(out)
  })

  it('leaves whitespace that is verbatim content alone', () => {
    // Three spaces inside a code block are data, not layout.
    const src = '```\na\n   \nb\n```\n'
    expect(carveToCarve(src)).toBe(src)
  })

  it('leaves trailing whitespace on a line that has content alone', () => {
    // It can be document content: this renders as `<p>a \nb</p>`, so stripping
    // it would break carveToHtml(fmt(x)) == carveToHtml(x) (carve#359).
    const src = 'a \nb\n'
    expect(carveToHtml(carveToCarve(src))).toBe(carveToHtml(src))
  })
})
