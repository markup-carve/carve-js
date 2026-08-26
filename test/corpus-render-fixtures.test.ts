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
      const ahead = fixture.target === 'fmt' ? CANONICAL_AHEAD_OF_PIN.get(fixture.slug) : undefined
      if (ahead === undefined) {
        expect(targets[fixture.target](source)).toBe(expected)
        return
      }
      expect(targets[fixture.target](source), ahead.reason).toBe(ahead.fmt)
      // The staleness half: when the pin moves past the clause the sidecar is
      // rewritten to exactly this value, and the entry must be deleted.
      expect(
        expected,
        `${fixture.slug} now matches: delete its AHEAD_OF_PIN entry`,
      ).not.toBe(ahead.fmt)
    })
  }
})
