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
      expect(targets[fixture.target](source)).toBe(expected)
    })
  }
})
