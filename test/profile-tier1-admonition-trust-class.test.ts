import { describe, expect, it } from 'vitest'

import { applyProfile, carveToHtml, parse, Profile, resolve, toAstJson } from '../src/index.js'

/**
 * carve issue 431: a fence opened with a non-Tier-1 word is a generic
 * container, not a callout - it must classify as `div` for profiles, not
 * `admonition`. Only the eight Tier-1 kinds (`note`, `tip`, `warning`,
 * `danger`, `info`, `success`, `example`, `quote`) are callouts; carve-php
 * already made this classification (markup-carve/carve-php#513).
 *
 * This is a TRUST-CLASS change only: the serialized AST still publishes every
 * named fence as `{"type":"admonition","kind":"..."}` regardless of kind
 * (matching carve-rs and resources/ast-schema.json), and the HTML renderer's
 * choice of `<aside>` vs `<div>` is unchanged - only the profile
 * classification (and therefore what a deny list matches) changes.
 */
describe('profile: Tier-1 admonition trust class (carve#431)', () => {
  const note = '::: note\ncallout\n:::\n'
  const sidebar = '::: sidebar\ncontent\n:::\n'
  const bare = ':::\ngeneric\n:::\n'

  function violationsFor(src: string, profile: Profile) {
    return applyProfile(resolve(parse(src)), profile, null).violations
  }

  it('deny admonition strips a Tier-1 callout (::: note)', () => {
    const violations = violationsFor(note, Profile.full().denyBlock(['admonition']))
    expect(violations.map((v) => v.nodeType)).toEqual(['admonition'])
    expect(carveToHtml(note, { profile: Profile.full().denyBlock(['admonition']) })).not.toContain('<aside')
  })

  it('deny admonition does NOT strip a generic container (::: sidebar)', () => {
    const violations = violationsFor(sidebar, Profile.full().denyBlock(['admonition']))
    expect(violations).toEqual([])
    expect(carveToHtml(sidebar, { profile: Profile.full().denyBlock(['admonition']) })).toContain(
      '<div class="sidebar">',
    )
  })

  it('deny div strips a generic container (::: sidebar)', () => {
    const violations = violationsFor(sidebar, Profile.full().denyBlock(['div']))
    expect(violations.map((v) => v.nodeType)).toEqual(['div'])
    expect(carveToHtml(sidebar, { profile: Profile.full().denyBlock(['div']) })).not.toContain(
      '<div class="sidebar">',
    )
  })

  it('deny div still strips a Tier-1 callout through the admonition-to-div supertype rule', () => {
    const violations = violationsFor(note, Profile.full().denyBlock(['div']))
    expect(violations.map((v) => v.nodeType)).toEqual(['admonition'])
    expect(carveToHtml(note, { profile: Profile.full().denyBlock(['div']) })).not.toContain('<aside')
  })

  it('::: sidebar still serializes as admonition + kind (pins the AST/trust-class separation)', () => {
    const json = toAstJson(resolve(parse(sidebar)))
    const node = json.children[0] as { type: string; kind: string }
    expect(node.type).toBe('admonition')
    expect(node.kind).toBe('sidebar')
  })

  it('rendering is unchanged for a Tier-1, a non-Tier-1, and a bare fence', () => {
    expect(carveToHtml(note)).toBe('<aside class="admonition note" aria-label="Note">\n  <p>callout</p>\n</aside>')
    expect(carveToHtml(sidebar)).toBe('<div class="sidebar">\n  <p>content</p>\n</div>')
    expect(carveToHtml(bare)).toBe('<div>\n  <p>generic</p>\n</div>')
  })
})
