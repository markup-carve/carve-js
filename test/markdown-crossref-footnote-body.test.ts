import { describe, expect, it } from 'vitest'
import { carveToMarkdown } from '../src/index.js'

/**
 * The Markdown target emits `{#id}` on a heading only when a cross-reference
 * resolves to it, which keeps the output free of ids nobody links to. Deciding
 * that needs to see EVERY cross-reference in the document, and the prepass
 * walked only `ast.children` - not footnote definition bodies, which render as
 * block content just the same.
 *
 * So a heading referenced only from a footnote lost its id while the reference
 * still rendered as a link, leaving a dangling anchor: the one thing emitting
 * the id exists to prevent (carve#352).
 */
describe('cross-references inside footnote bodies', () => {
  it('gives a heading referenced only from a footnote its id', () => {
    const out = carveToMarkdown('# H\n\nBody[^n]\n\n[^n]: see </#h>\n')

    expect(out).toContain('# H {#H}')
    expect(out).toContain('[H](#H)')
  })

  it('emits no id when nothing references the heading', () => {
    // The suffix is not unconditional - an unreferenced heading stays clean, so
    // the fix must not turn into "always emit ids".
    const out = carveToMarkdown('# H\n\nBody[^n]\n\n[^n]: plain note\n')

    expect(out).toContain('# H\n')
    expect(out).not.toContain('{#')
  })

  it('still sees references in ordinary body text', () => {
    const out = carveToMarkdown('# H\n\nSee </#h>.\n')

    expect(out).toContain('# H {#H}')
    expect(out).toContain('[H](#H)')
  })

  it('links every heading a footnote body references', () => {
    const out = carveToMarkdown('# One\n\n# Two\n\nBody[^n]\n\n[^n]: </#one> and </#two>\n')

    expect(out).toContain('# One {#One}')
    expect(out).toContain('# Two {#Two}')
  })
})
