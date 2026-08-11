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
 * A fenced block inside a list item has its indentation sentinel-protected so
 * normalization cannot eat real code indentation, which also hides the
 * structural indent on a line whose verbatim content is empty. carve-rs and
 * carve-php have the same site. Listed rather than filtered out of the sweep, so
 * it stays visible.
 */
const KNOWN_REMAINING = new Set(['73-list-nesting-and-looseness-5.crv:3'])

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

describe('the writer never emits a whitespace-only line', () => {
  const dir = resolve(import.meta.dirname, '../spec/tests/corpus')
  const inputs = readdirSync(dir).filter((f) => f.endsWith('.crv'))

  it('holds across the whole corpus', () => {
    expect(inputs.length).toBe(expectedCorpusSize(resolve(import.meta.dirname, '../spec')))
    const failures: string[] = []
    for (const slug of inputs) {
      const out = carveToCarve(readFileSync(resolve(dir, slug), 'utf8'))
      for (const site of offendingLines(slug, out)) {
        if (!KNOWN_REMAINING.has(site)) failures.push(site)
      }
    }
    expect(failures).toEqual([])
  })

  it('emits a blank line inside a list item empty', () => {
    const src = '1. one\n\n    > q\n'
    const out = carveToCarve(src)
    expect(out).toContain('\n\n')
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
