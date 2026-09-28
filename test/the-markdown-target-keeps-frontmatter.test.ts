import { describe, it, expect } from 'vitest'
import { carveToAnsi, carveToHtml, carveToMarkdown, carveToPlainText } from '../src/index.js'

/**
 * PART 11 §10r (markup-carve/carve#2501): the Markdown target emits frontmatter
 * first, with the format token wherever the format is not `yaml`, and the
 * content verbatim. HTML, plain text and the terminal keep omitting it.
 *
 * The importer already preserved frontmatter, so dropping it here made
 * `migrate --from markdown` in and `--markdown` out lossy in the one direction
 * where both ends spell the construct natively.
 */

describe('the Markdown target keeps frontmatter', () => {
  it('emits it first, with a bare opener for yaml', () => {
    expect(carveToMarkdown('---\ntitle: Hi\n---\n\n# H\n\ntext\n'))
      .toBe('---\ntitle: Hi\n---\n\n# H\n\ntext\n')
  })

  it('writes the format token when the format is not yaml', () => {
    expect(carveToMarkdown('---toml\nt = 1\n---\n\nx\n')).toBe('---toml\nt = 1\n---\n\nx\n')
  })

  it('spells a `--- yaml` opener bare, because the token is the format and not the source', () => {
    expect(carveToMarkdown('--- yaml\na: 1\n---\n\nx\n')).toBe('---\na: 1\n---\n\nx\n')
  })

  it('needs no blank line after a document that is only frontmatter', () => {
    expect(carveToMarkdown('---\na: 1\n---\n')).toBe('---\na: 1\n---\n')
  })

  it('keeps the content verbatim, blank lines and metacharacters included', () => {
    const source = '---\nlist:\n\n\n  - "*not emphasis*"\n---\n\nx\n'
    expect(carveToMarkdown(source)).toBe(source)
  })

  it('re-imports as the same frontmatter, which is what the round trip buys', () => {
    const once = carveToMarkdown('---toml\nt = 1\n---\n\nx\n')
    expect(carveToMarkdown(once)).toBe(once)
  })

  it('strips a Trojan-Source control from the metadata like every other byte', () => {
    expect(carveToMarkdown('---\na: ‮b\n---\n\nx\n')).toBe('---\na: b\n---\n\nx\n')
  })

  it('leaves the other three targets omitting it', () => {
    const source = '---\ntitle: Hi\n---\n\ntext\n'
    expect(carveToHtml(source)).not.toContain('title')
    expect(carveToPlainText(source)).toBe('text\n')
    expect(carveToAnsi(source)).toBe('text\n')
  })
})
