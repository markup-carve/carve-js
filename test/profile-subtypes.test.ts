import { describe, it, expect } from 'vitest'
import { Profile, carveToHtml } from '../src/index.js'

/**
 * `profiles.md` requires `autolink` and `admonition` to be nameable on their
 * own: an autolink is not a `link` (folding it in loses the authored form a
 * round trip has to restore), and an admonition is not a `div` (a profile that
 * wants to deny callouts while allowing generic containers cannot say so if the
 * kind lives in a class string).
 *
 * Both folded into the broader name before the allow/deny check, so naming them
 * was a silent no-op - a host could deny autolinks, get no error and no
 * violation, and still emit them (issue 362).
 *
 * They stay COVERED BY the broader name: unfolding them without that would
 * quietly widen every profile already relying on `link` or `div`.
 */
describe('profile subtypes', () => {
  const autolink = 'See <https://example.com> here.\n'
  const admonition = '::: note\ncallout\n:::\n'
  const generic = '{.wrap}\n:::\ngeneric\n:::\n'

  const html = (src: string, profile?: Profile) =>
    carveToHtml(src, profile ? { profile } : {})

  it('denies an autolink when the profile names it', () => {
    expect(html(autolink, Profile.full().denyInline(['autolink']))).not.toContain('<a ')
  })

  it('still denies an autolink when the profile names link', () => {
    expect(html(autolink, Profile.full().denyInline(['link']))).not.toContain('<a ')
  })

  it('keeps ordinary links when only autolink is denied', () => {
    const out = html('A [real](https://a.example) and <https://b.example>.\n', Profile.full().denyInline(['autolink']))
    expect(out).toContain('href="https://a.example"')
    expect(out).not.toContain('href="https://b.example"')
  })

  it('denies an admonition when the profile names it', () => {
    expect(html(admonition, Profile.full().denyBlock(['admonition']))).not.toContain('<aside')
  })

  it('still denies an admonition when the profile names div', () => {
    expect(html(admonition, Profile.full().denyBlock(['div']))).not.toContain('<aside')
  })

  it('keeps generic containers when only admonition is denied', () => {
    // The case profiles.md names: deny callouts, allow generic containers.
    const out = html(admonition + '\n' + generic, Profile.full().denyBlock(['admonition']))
    expect(out).not.toContain('<aside')
    expect(out).toContain('<div class="wrap">')
  })

  it('admits a subtype through an allow list naming its supertype', () => {
    const out = html(autolink, Profile.full().allowInline(['text', 'link']))
    expect(out).toContain('<a ')
  })
})
