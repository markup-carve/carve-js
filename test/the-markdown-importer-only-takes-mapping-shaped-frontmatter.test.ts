import { describe, it, expect } from 'vitest'
import { markdownToCarveWithLosses } from '../src/markdown-migrate.js'
import { migrateMarkdown } from '../src/migration.js'
import { carveToHtml } from '../src/index.js'
import { renderCarve } from '../src/render-carve.js'
import { parse } from '../src/parse.js'

const synthesized = (md: string) =>
  markdownToCarveWithLosses(md).losses.some((loss) => loss.code === 'frontmatter-synthesized')

const value = (md: string) => markdownToCarveWithLosses(md).value

describe('the Markdown importer only takes mapping-shaped frontmatter (markup-carve/carve#2799)', () => {
  it('leaves CommonMark example 96 as a break over two setext headings', () => {
    const md = '---\nFoo\n---\nBar\n---\nBaz\n'
    expect(synthesized(md)).toBe(false)
    expect(value(md)).toBe('---\n\n## Foo\n\n## Bar\n\nBaz\n')
  })

  it('renders example 96 with the CommonMark meaning', () => {
    const html = carveToHtml(value('---\nFoo\n---\nBar\n---\nBaz\n'))
    expect(html).toContain('<hr')
    expect(html).toMatch(/<h2[^>]*>Foo<\/h2>/)
    expect(html).toMatch(/<h2[^>]*>Bar<\/h2>/)
    expect(html).toContain('<p>Baz</p>')
  })

  it.each([
    ['a real mapping', '---\ntitle: Hi\n---\nBody\n', true],
    ['a key whose value is on the next line', '---\ntitle:\n  - a\n---\nBody\n', true],
    ['a comment above a real key', '---\n# c\ntitle: Hi\n---\nBody\n', true],
    ['a double-quoted key', '---\n"my key": Hi\n---\nBody\n', true],
    ['a single-quoted key', "---\n'my key': Hi\n---\nBody\n", true],
    // A shape test, not a parse: the three engines have to agree byte for byte.
    ['malformed mapping content', '---\ntitle: [unclosed\n---\nBody\n', true],
    ['a comment-only block', '---\n# just a comment\n---\nBody\n', false],
    ['an empty block', '---\n---\nBody\n', false],
    ['a blank-only block', '---\n\n---\nBody\n', false],
    ['a key holding a colon', '---\na:b: c\n---\nBody\n', false],
    ['a colon with no space after it', '---\nkey:value\n---\nBody\n', false],
    ['a list as the first line', '---\n- a\n---\nBody\n', false],
    ['a toml table header under a bare opener', '---\n[table]\n---\nBody\n', false],
    // The shape test governs the BARE opener only. A typed one says what the
    // block is, so a scalar payload is the author's business.
    ['a scalar under the yaml token', '---yaml\nFoo\n---\nBar\n---\nBaz\n', true],
    ['a scalar under the toml token', '---toml\nFoo\n---\nBody\n', true],
    ['a scalar under an unruled format token', '---json\nFoo\n---\nBody\n', true],
    ['a toml table under the toml token', '---toml\n[table]\nk = 1\n---\nBody\n', true],
    // A typed opener keeps the PRIOR reading, which rejects an empty pair.
    ['an empty block under a typed token', '---yaml\n\n---\nBody\n', false],
  ])('reads %s as frontmatter: %j -> %s', (_name, md, expected) => {
    expect(synthesized(md as string)).toBe(expected as boolean)
  })

  it('reports every conversion on the migration report', () => {
    const report = migrateMarkdown('---\ntitle: Hi\n---\nBody\n').report
    const diagnostic = report.diagnostics.find((d) => d.code === 'frontmatter-synthesized')
    expect(diagnostic).toBeDefined()
    expect(diagnostic!.severity).toBe('info')
    expect(diagnostic!.fidelity).toBe('preserved')
    expect(diagnostic!.confidence).toBe('exact')
  })

  it('reports nothing when the block is not a mapping', () => {
    const codes = migrateMarkdown('---\nFoo\n---\nBar\n').report.diagnostics.map((d) => d.code)
    expect(codes).not.toContain('frontmatter-synthesized')
  })

  it('writes a rejected block in a form that cannot reopen frontmatter', () => {
    for (const md of ['---\nFoo\n---\nBar\n---\nBaz\n', '---\n- a\n---\nBody\n']) {
      const out = value(md)
      expect(parse(out).frontmatter).toBeFalsy()
    }
  })

  it('round-trips a Jekyll-style file through the formatter with no diff', () => {
    const out = value('---\nlayout: post\ntitle: "A post"\ntags:\n  - one\n---\n\n# Heading\n\nText with *bold*.\n')
    expect(out.startsWith('---yaml\nlayout: post\n')).toBe(true)
    expect(renderCarve(parse(out))).toBe(out)
  })
})
