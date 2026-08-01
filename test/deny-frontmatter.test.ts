import { describe, it, expect } from 'vitest'
import { applyProfile, parse, Profile } from '../src/index.js'

/**
 * `denyBlock(['frontmatter'])` was a silent no-op here while carve-php stripped
 * the node and reported the violation.
 *
 * profiles.md lists `frontmatter` as a nameable block type, so a host naming it
 * must be honoured - and a silent no-op is exactly what a normative vocabulary
 * exists to prevent. The cause was structural rather than a missing case:
 * frontmatter is a plain field on the runtime document, so the child walk the
 * filter runs never reached it (carve-js#473).
 */
const source = '---\ntitle: x\n---\n\nBody\n'

describe('denying frontmatter', () => {
  it('reports the violation and drops the block', () => {
    const result = applyProfile(parse(source), Profile.full().denyBlock(['frontmatter']))

    expect(result.violations.map((v) => v.nodeType)).toEqual(['frontmatter'])
    expect((result.doc as { frontmatter?: unknown }).frontmatter).toBeUndefined()
  })

  it('leaves it alone when the profile does not name it', () => {
    const result = applyProfile(parse(source), Profile.full())

    expect(result.violations).toEqual([])
    expect((result.doc as { frontmatter?: unknown }).frontmatter).toBeDefined()
  })

  it('does not change the rendered output either way', () => {
    // Frontmatter renders nothing, so this is about what the tree and the
    // violation list say - not about the HTML. Asserted so the fix is not
    // mistaken for one that changes a document.
    const denied = applyProfile(parse(source), Profile.full().denyBlock(['frontmatter']))
    expect(denied.doc.children.map((c) => c.type)).toEqual(['paragraph'])
  })
})
