import { describe, expect, it } from 'vitest'

import {
  Profile,
  ProfileViolationError,
  applyProfile,
  carveToHtml,
  parse,
} from '../src/index.js'

/**
 * `profiles.md` lists `frontmatter` and `footnote` in the normative Block
 * vocabulary, so a profile can name them. This engine keeps both on the
 * Document rather than in `children`, and the filter walked only `children` -
 * so naming either did nothing at all: no violation, no change (carve#422).
 *
 * The rendered HTML is unchanged either way, because neither renders. That is
 * exactly why these tests do not stop at comparing output.
 */
describe('a profile can deny the types this engine keeps on the root', () => {
  const withFrontmatter = '---\ntitle: Secret\napi_key: sk-123\n---\n\nBody.\n'
  const withFootnote = 'Body[^a].\n\n[^a]: note\n'

  it('removes frontmatter rather than ignoring the deny', () => {
    const doc = parse(withFrontmatter)
    expect(doc.frontmatter).toBeDefined()

    const { violations } = applyProfile(doc, Profile.full().denyBlock(['frontmatter']))

    expect(doc.frontmatter).toBeUndefined()
    expect(violations.map((v) => v.nodeType)).toEqual(['frontmatter'])
  })

  it('removes footnote definitions rather than ignoring the deny', () => {
    const doc = parse(withFootnote)
    expect(doc.footnoteDefs).toBeDefined()

    const { violations } = applyProfile(doc, Profile.full().denyBlock(['footnote']))

    expect(doc.footnoteDefs).toBeUndefined()
    expect(violations.map((v) => v.nodeType)).toEqual(['footnote'])
  })

  it('raises under the error action, like any other denied type', () => {
    const profile = Profile.full().denyBlock(['frontmatter']).onDisallowed('error')
    expect(() => carveToHtml(withFrontmatter, { profile })).toThrow(ProfileViolationError)
  })

  it('keeps both when the profile denies nothing', () => {
    const doc = parse(withFrontmatter)
    const { violations } = applyProfile(doc, Profile.full())

    expect(doc.frontmatter).toBeDefined()
    expect(violations).toEqual([])
  })

  it('leaves rendered output identical, since neither type renders', () => {
    // Deliberate, and the reason the assertions above look at the tree and the
    // violations instead. A caller who denies one of these and diffs the HTML
    // sees nothing change - documented in profiles.md.
    for (const source of [withFrontmatter, withFootnote]) {
      expect(carveToHtml(source, { profile: Profile.full().denyBlock(['frontmatter']) })).toBe(
        carveToHtml(source),
      )
    }
  })
})
