import { describe, it, expect } from 'vitest'
import { carveToMarkdown, carveToAstJson, fromAstJson, renderMarkdown } from '../src/index.js'

/**
 * The Markdown target neutralizes embedded HTML everywhere it writes author
 * content.
 *
 * The writer states that invariant next to `escapeMdHtml`: carve's "HTML is
 * text" guarantee holds for this target too, so Markdown re-rendered to HTML
 * cannot execute. Five slots skipped it (markup-carve/carve-js#894).
 */
describe('the Markdown target escapes embedded HTML', () => {
  const PAYLOAD = '<script>alert(1)</script>'
  const ESCAPED = '&lt;script&gt;alert(1)&lt;/script&gt;'

  it('escapes math content', () => {
    const out = carveToMarkdown('a $`<script>alert(1)</script>` b\n')
    expect(out).not.toContain(PAYLOAD)
    expect(out).toContain(ESCAPED)
  })

  it('escapes display math content', () => {
    expect(carveToMarkdown('$$`<script>alert(1)</script>`\n')).not.toContain(PAYLOAD)
  })

  it('escapes the abbreviation definition line', () => {
    // The occurrence's `<abbr title=...>` was already escaped and the
    // definition line one arm away was not - one output disagreeing with itself.
    const out = carveToMarkdown('*[AB]: <script>alert(1)</script>\n\nAB\n')
    expect(out).not.toContain(PAYLOAD)
    expect(out.split(ESCAPED).length - 1).toBe(2)
  })

  it('escapes an ingested abbreviation key', () => {
    // The parser will not accept a `<` in a term, so this slot is only
    // reachable through AST ingest - a caller handing over a tree from a
    // database row or a bridge, which is exactly the input with no parser in
    // front of it.
    const json = JSON.parse(
      JSON.stringify(carveToAstJson('*[AB]: exp\n\nAB\n')).replaceAll('"AB"', '"<script>"'),
    )
    const out = renderMarkdown(fromAstJson(json))
    expect(out).not.toContain('<script>')
    expect(out.split('&lt;script&gt;').length - 1).toBe(2)
  })

  it('escapes a footnote label in both positions', () => {
    // Both positions escape, so the reference still matches its definition in
    // the emitted Markdown.
    const out = carveToMarkdown(
      'x[^<script>alert(1)</script>]\n\n[^<script>alert(1)</script>]: body\n',
    )
    expect(out).not.toContain(PAYLOAD)
    expect(out).toContain(`[^${ESCAPED}]`)
    expect(out).toContain(`[^${ESCAPED}]: `)
  })

  it('escapes an UNRESOLVED footnote label, brackets and all', () => {
    // That branch escaped its brackets, because they are Markdown
    // metacharacters, and skipped the HTML.
    const out = carveToMarkdown('x[^<script>alert(1)</script>]\n')
    expect(out).not.toContain(PAYLOAD)
    expect(out).toContain('\\[^')
  })

  it('escapes an unresolved crossref target', () => {
    // `</#a<script>` is a complete opening tag once the Markdown is rendered.
    const out = carveToMarkdown('</#a<script>alert(1)</script>b>\n')
    expect(out).not.toContain('<script>')
    expect(out).toContain('</#a&lt;script>')
  })

  it('CONTROL: an ordinary unresolved crossref is left as authored', () => {
    // Escaping `</#nope>` whole would turn a marker a reader can act on into
    // noise; only the target inside it is author content.
    expect(carveToMarkdown('text </#nope> more\n')).toContain('</#nope>')
  })

  it('escaping math is transparent, not lossy', () => {
    // A consumer decodes the entity back to the character before its math
    // renderer sees the content, which is what the HTML target has always
    // relied on.
    expect(carveToMarkdown('$`a < b`\n')).toContain('a &lt; b')
  })

  it('CONTROL: ordinary content is unchanged on all of those paths', () => {
    const out = carveToMarkdown('*[HT]: Hypertext\n\nHT and $`x^2`$ and y[^n]\n\n[^n]: note\n')
    expect(out).toContain('*[HT]: Hypertext')
    expect(out).toContain('<abbr title="Hypertext">HT</abbr>')
    expect(out).toContain('[^n]')
    expect(out).toContain('[^n]: note')
    expect(out).not.toContain('&amp;')
  })
})
