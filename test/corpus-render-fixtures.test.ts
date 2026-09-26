import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  carveToAnsi,
  carveToCarve,
  carveToMarkdown,
  carveToPlainText,
} from '../src/index.js'
import { CANONICAL_AHEAD_OF_PIN } from './canonical-ahead-of-pin.js'

const corpusDir = resolve(dirname(fileURLToPath(import.meta.url)), '../spec/tests/corpus')

const targets = {
  md: carveToMarkdown,
  txt: carveToPlainText,
  ansi: carveToAnsi,
  fmt: carveToCarve,
} as const

type Target = keyof typeof targets

/*
 * Corpus `.md` sidecars this engine has deliberately moved PAST the pinned
 * corpus on, under the same contract as `CANONICAL_AHEAD_OF_PIN`: the value is
 * what the clause states TODAY, so a regression fails here as the sidecar would
 * have caught it, and the pinned bytes must still DIFFER, so the entry goes out
 * with the bump that reaches the re-cut fixture.
 *
 * It is declared in this file rather than beside the `.fmt` map because only
 * this suite reads a `.md` sidecar.
 */
const MARKDOWN_AHEAD_OF_PIN: ReadonlyMap<string, { reason: string; md: string }> = new Map()

/** The bytes this engine is ahead of the pinned sidecar with, if it is. */
const aheadOfPin = (fixture: { slug: string; target: Target }) => {
  if (fixture.target === 'fmt') {
    const entry = CANONICAL_AHEAD_OF_PIN.get(fixture.slug)
    return entry && { reason: entry.reason, bytes: entry.fmt }
  }
  if (fixture.target === 'md') {
    const entry = MARKDOWN_AHEAD_OF_PIN.get(fixture.slug)
    return entry && { reason: entry.reason, bytes: entry.md }
  }
  return undefined
}

const fixtures = readdirSync(corpusDir)
  .flatMap((name) => {
    const match = /^(\d+-.*)\.(md|txt|ansi|fmt)$/.exec(name)
    if (!match) return []
    const [, slug, target] = match as [string, string, Target]
    return [{ slug, target, path: resolve(corpusDir, name) }]
  })
  .sort((a, b) => `${a.target}/${a.slug}`.localeCompare(`${b.target}/${b.slug}`))

describe('spec corpus non-HTML render fixtures', () => {
  it('discovers fixtures and every fixture has a source pair', () => {
    expect(fixtures.length, 'no non-HTML render fixtures were discovered').toBeGreaterThan(0)
    for (const fixture of fixtures) {
      expect(
        existsSync(resolve(corpusDir, `${fixture.slug}.crv`)),
        `${fixture.slug}.${fixture.target} has no .crv source pair`,
      ).toBe(true)
    }
  })

  for (const fixture of fixtures) {
    it(`${fixture.target}: ${fixture.slug}`, () => {
      const source = readFileSync(resolve(corpusDir, `${fixture.slug}.crv`), 'utf8')
      const expected = readFileSync(fixture.path, 'utf8')
      // The `fmt` target reads the SAME sidecars `corpus-canonical-form.test.ts`
      // does, so it honors the same ahead-of-pin declaration rather than a
      // second copy of it. See `canonical-ahead-of-pin.ts`.
      const ahead = aheadOfPin(fixture)
      if (ahead === undefined) {
        expect(targets[fixture.target](source)).toBe(expected)
        return
      }
      expect(targets[fixture.target](source), ahead.reason).toBe(ahead.bytes)
      // The staleness half: when the pin moves past the clause the sidecar is
      // rewritten to exactly this value, and the entry must be deleted.
      expect(
        expected,
        `${fixture.slug} now matches: delete its AHEAD_OF_PIN entry`,
      ).not.toBe(ahead.bytes)
    })
  }
})
