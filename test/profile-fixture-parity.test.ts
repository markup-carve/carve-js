import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { carveToHtml, Profile } from '../src/index.js'

/**
 * The shared profile battery, `spec/tests/profile-fixtures.json`.
 *
 * That file names carve-php as the reference and says the other engines assert
 * against it. Nothing in this engine had ever read it, which is part of how all
 * three drifted into the same defect unseen: a profile denied any node type its
 * vocabulary did not list, so a construct the vocabulary predates rendered as
 * NOTHING - not degraded to text, gone (carve#419).
 *
 * The fixtures carry a trailing newline because carve-php's `convert()` emits
 * one; `carveToHtml` does not. That is a long-standing API difference, not a
 * rendering one, so it is normalized here rather than papered over in either
 * engine.
 */
const FIXTURES = resolve(__dirname, '../spec/tests/profile-fixtures.json')

interface Fixture {
  carve: string
  profile: string
  html: string
}

const profiles: Record<string, () => Profile> = {
  full: () => Profile.full(),
  article: () => Profile.article(),
  comment: () => Profile.comment(),
  minimal: () => Profile.minimal(),
}

const fixtures = JSON.parse(readFileSync(FIXTURES, 'utf8')) as Record<string, Fixture>

describe('shared profile battery', () => {
  it('has the fixtures checked out', () => {
    expect(Object.keys(fixtures).length).toBeGreaterThan(10)
  })

  for (const [name, fixture] of Object.entries(fixtures)) {
    it(name, () => {
      const factory = profiles[fixture.profile]
      expect(factory, `unknown profile "${fixture.profile}"`).toBeDefined()

      const got = carveToHtml(fixture.carve, { profile: factory!() })
      expect(got.replace(/\n$/, '')).toBe(fixture.html.replace(/\n$/, ''))
    })
  }
})

describe('a profile that denies nothing is lossless', () => {
  // The property behind the battery's `full-*` cases, stated directly: it must
  // hold for every construct, not only the ones someone thought to add.
  const constructs: Record<string, string> = {
    substitution: 'a {~old~>new~} b\n',
    symbol: 'a :smile: b\n',
    'smart quotes': 'a "quoted" b\n',
    dashes: 'a -- b --- c\n',
    'critic insert': 'a {++ins++} b\n',
    'critic delete': 'a {--del--} b\n',
    highlight: 'a {=mark=} b\n',
    'heading with a cross-reference': '# Title {#t}\n\nSee [](#t).\n',
    table: '| a | b |\n|---|---|\n| c | d |\n',
    'definition list': ':: term\n:  definition\n',
    footnote: 'a[^r]\n\n[^r]: note\n',
    admonition: '::: note\nbody\n:::\n',
  }

  for (const [label, source] of Object.entries(constructs)) {
    it(`full() does not change ${label}`, () => {
      expect(carveToHtml(source, { profile: Profile.full() })).toBe(carveToHtml(source))
    })
  }
})

describe('a disallowed node keeps its words', () => {
  it('degrades a substitution to both texts rather than deleting it', () => {
    // `to_text` promises the words survive and the markup does not. A
    // substitution keeps its text in FIELDS, so the generic child walk returned
    // '' and the node was removed - losing the old wording and the new one.
    const html = carveToHtml('Body with a {~old~>new~} substitution.\n', {
      profile: Profile.comment(),
    })

    expect(html).toContain('oldnew')
    expect(html).not.toContain('<del>')
  })
})

describe('a node that renders nothing is removed, not marked', () => {
  // The `[type]` marker means "this engine has no extractor arm for that
  // payload" - it is a bug report, not a rendering. A node that genuinely
  // renders nothing must be removed instead, or denying it injects the marker
  // into the document as visible text.
  const cases: Record<string, string> = {
    'abbreviation definition': '*[HTML]: HyperText\n\nHTML is fine.\n',
    comment: '%% invisible\n\nBody.\n',
  }

  for (const [label, source] of Object.entries(cases)) {
    it(`removes a denied ${label}`, () => {
      const html = carveToHtml(source, {
        profile: Profile.full().denyBlock(['abbreviation_def', 'comment']),
      })

      expect(html).not.toContain('[abbreviation_def]')
      expect(html).not.toContain('[comment]')
    })
  }
})
