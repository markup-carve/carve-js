/*
 * Denying a definition that renders nothing removes it, rather than injecting a
 * marker into the page (carve-js#702).
 *
 * The profile filter degrades a denied node to its text content. A node with no
 * text content to extract takes a deliberate diagnostic path: it records a
 * `to_text_yielded_nothing` violation and substitutes `[<type>]`, "a marker ugly
 * enough that it cannot pass for intended output". That marker exists to make a
 * missing extractor arm visible, and it is doing its job here - it means
 * `rendersNothing()` should have claimed the node and did not.
 *
 * `rendersNothing()` listed `comment`, `frontmatter` and `abbreviation_def`. The
 * third was added for exactly this symptom, and `link_reference_definition` -
 * the same shape - was left behind, so:
 *
 *   <p>See <a href="/u">x</a>.</p>
 *   <p>[link_reference_definition]</p>
 *
 * `docs/profiles.md` names the two together: "`link_reference_definition` is the
 * `abbreviation_def` case exactly: the definition line renders nothing in HTML".
 *
 * Note what is NOT asserted here: that denying the definition unresolves the
 * link. profiles.md is explicit that "the `link` or `image` it feeds is the node
 * a profile denies", so the link stays - unlike a footnote, whose reference has
 * nowhere to point once its definition is gone.
 */

import { describe, expect, it } from 'vitest'
import { carveToHtml, Profile } from '../src/index.js'

const flat = (html: string): string => html.replace(/\n\s*/g, ' ').trim()

describe('a denied definition that renders nothing', () => {
  it('injects no marker for a link reference definition', () => {
    const src = 'See [x][y].\n\n[y]: /u\n'
    for (const action of ['to_text', 'strip'] as const) {
      const profile = Profile.full().denyBlock(['link_reference_definition']).onDisallowed(action)
      const html = flat(carveToHtml(src, { profile }))
      expect(html, `${action} injected the type name`).not.toContain('[link_reference_definition]')
      expect(html).toBe('<p>See <a href="/u">x</a>.</p>')
    }
  })

  it('still does the same for an abbreviation definition', () => {
    // The arm that was already there. Kept so a repair of one cannot quietly
    // regress the other.
    const src = 'HTML is fine.\n\n*[HTML]: HyperText\n'
    const profile = Profile.full().denyBlock(['abbreviation_def'])
    const html = flat(carveToHtml(src, { profile }))
    expect(html).not.toContain('[abbreviation_def]')
    expect(html).toBe('<p><abbr title="HyperText">HTML</abbr> is fine.</p>')
  })

  it('leaves an undenied document untouched', () => {
    const src = 'See [x][y].\n\n[y]: /u\n'
    expect(flat(carveToHtml(src))).toBe('<p>See <a href="/u">x</a>.</p>')
  })

  it('reports the denial rather than swallowing it', () => {
    // The node is removed, not degraded, so the `to_text_yielded_nothing`
    // diagnostic must not fire - but the denial itself is still a violation the
    // host asked to be told about. Removing quietly would trade one silent
    // failure for another.
    const src = 'See [x][y].\n\n[y]: /u\n'
    const profile = Profile.full()
      .denyBlock(['link_reference_definition'])
      .onDisallowed('error')
    expect(() => carveToHtml(src, { profile })).toThrow(/link_reference_definition/)
  })
})
