import { describe, expect, it } from 'vitest'
import { carveToMarkdown } from '../src/index.js'

/**
 * A cross-reference in a footnote body renders as block content like any
 * other, so the Markdown target writes it as a link to the heading's GFM slug
 * (PART 11 section 11). The target never writes a `{#id}` suffix.
 */
describe('cross-references inside footnote bodies', () => {
  it('links a heading referenced only from a footnote', () => {
    const out = carveToMarkdown('# H\n\nBody[^n]\n\n[^n]: see </#h>\n')

    expect(out).toContain('# H\n')
    expect(out).toContain('[H](#h)')
  })

  it('emits no id when nothing references the heading', () => {
    const out = carveToMarkdown('# H\n\nBody[^n]\n\n[^n]: plain note\n')

    expect(out).toContain('# H\n')
    expect(out).not.toContain('{#')
  })

  it('still sees references in ordinary body text', () => {
    const out = carveToMarkdown('# H\n\nSee </#h>.\n')

    expect(out).toContain('# H\n')
    expect(out).toContain('[H](#h)')
  })

  it('links every heading a footnote body references', () => {
    const out = carveToMarkdown('# One\n\n# Two\n\nBody[^n]\n\n[^n]: </#one> and </#two>\n')

    expect(out).toContain('[^n]: [One](#one) and [Two](#two)')
    expect(out).not.toContain('{#')
  })
})
