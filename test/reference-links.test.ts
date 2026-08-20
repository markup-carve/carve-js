import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'

const html = (s: string) => carveToHtml(s).trim()

describe('reference-link resolution (grammar §6)', () => {
  it('resolves a forward reference (definition after use)', () => {
    expect(html('See [the site][s].\n\n[s]: https://example.com')).toBe(
      '<p>See <a href="https://example.com">the site</a>.</p>',
    )
  })

  it('resolves a backward reference (definition before use)', () => {
    expect(html('[s]: https://example.com\n\nGo [there][s].')).toBe(
      '<p>Go <a href="https://example.com">there</a>.</p>',
    )
  })

  it('resolves the collapsed form [text][] using the text as label', () => {
    expect(html('[Carve][] rocks.\n\n[Carve]: https://example.com')).toBe(
      '<p><a href="https://example.com">Carve</a> rocks.</p>',
    )
  })

  it('carries the optional definition title (double or single quoted)', () => {
    expect(html('[a][r]\n\n[r]: /u "Tip"')).toBe(
      '<p><a href="/u" title="Tip">a</a></p>',
    )
    expect(html("[a][r]\n\n[r]: /u 'Tip'")).toBe(
      '<p><a href="/u" title="Tip">a</a></p>',
    )
  })

  it('matches labels EXACTLY - no whitespace folding, case-sensitive', () => {
    // This test previously asserted the opposite of the spec: it pinned
    // whitespace folding, which is the behaviour §6 and PART 9R R1 both forbid
    // in the same words - "case-sensitive, no whitespace folding". Rewritten to
    // pin the rule rather than the engine (carve-js#673); the executable spec and
    // carve-rs both leave these literal.
    //
    // Differing whitespace does NOT resolve, in either direction.
    expect(html('[Foo][  bar  baz ]\n\n[bar baz]: /u')).toBe(
      '<p>[Foo][  bar  baz ]</p>',
    )
    expect(html('[Foo][bar baz]\n\n[  bar  baz ]: /u')).toBe(
      '<p>[Foo][bar baz]</p>',
    )
    // IDENTICAL whitespace does resolve, including padding and doubled internal
    // spaces - exact means exact, not stripped.
    expect(html('[Foo][ bar  baz ]\n\n[ bar  baz ]: /u')).toBe(
      '<p><a href="/u">Foo</a></p>',
    )
    // Case is NOT normalized either (djot: "no case normalization on reference
    // definitions"); this half was always right.
    expect(html('[Foo][BAR baz]\n\n[bar baz]: /u')).toBe(
      '<p>[Foo][BAR baz]</p>',
    )
  })

  it('leaves an unresolved reference as literal text', () => {
    expect(html('[x][nope] y')).toBe('<p>[x][nope] y</p>')
  })

  it('does not render the definition line as content', () => {
    expect(html('[s]: https://example.com')).toBe('')
  })

  it('still parses inline links normally', () => {
    expect(html('[t](https://e.com)')).toBe(
      '<p><a href="https://e.com">t</a></p>',
    )
  })

  it('resolves references inside other inline constructs', () => {
    expect(html('*see [d][r]*\n\n[r]: /x')).toBe(
      '<p><strong>see <a href="/x">d</a></strong></p>',
    )
  })

  it('resolves a reference used inside a blockquote', () => {
    expect(html('> quote [d][r]\n\n[r]: /x')).toBe(
      '<blockquote><p>quote <a href="/x">d</a></p></blockquote>',
    )
  })

  it('ignores definition syntax shown inside a fenced code block', () => {
    const src = ['```', '[ref]: /should-not-resolve', '```', '', '[x][ref]'].join(
      '\n',
    )
    expect(html(src)).toBe(
      '<pre><code>[ref]: /should-not-resolve\n</code></pre>\n<p>[x][ref]</p>',
    )
  })

  it('a definition right after prose (no blank line) still interrupts as a block (§10)', () => {
    // Reference definitions are invisible metadata, so unlike a visible block
    // they still interrupt a paragraph with no blank line — the def is parsed
    // as a (hidden) block, not rendered as literal text.
    expect(html('See [x][r].\n[r]: /u')).toBe('<p>See <a href="/u">x</a>.</p>')
  })

  it('collects a definition that lives inside the same blockquote', () => {
    expect(html('> use [d][r]\n>\n> [r]: /x')).toBe(
      '<blockquote><p>use <a href="/x">d</a></p></blockquote>',
    )
  })

  it('resolves a top-level ref whose definition is in a later blockquote', () => {
    expect(html('See [x][r].\n\n> [r]: /u')).toBe(
      '<p>See <a href="/u">x</a>.</p>\n<blockquote>\n\n</blockquote>',
    )
  })

  it('collects a definition that is a list item', () => {
    expect(html('Use [x][r].\n\n- [r]: /u')).toContain('<a href="/u">x</a>')
  })

  it('ignores a definition inside list-item fenced code', () => {
    const src = ['- ```', '  [r]: /nope', '  ```', '', '[x][r]'].join('\n')
    expect(html(src)).toContain('[x][r]')
    expect(html(src)).not.toContain('href="/nope"')
  })

  it('does not collect a definition from YAML frontmatter', () => {
    const src = ['---', '[r]: /from-yaml', '---', '', '[x][r]'].join('\n')
    expect(html(src)).toBe('<p>[x][r]</p>')
  })

  it('does not collect a definition from typed (toml) frontmatter', () => {
    const src = ['---toml', '[r]: /from-toml', '---', '', '[x][r]'].join('\n')
    expect(html(src)).toBe('<p>[x][r]</p>')
  })

  it('resolves a ref whose definition is in a later admonition body', () => {
    expect(html('Use [x][r].\n\n::: note\n[r]: /u\n:::')).toBe(
      '<p>Use <a href="/u">x</a>.</p>\n<aside class="admonition note" aria-label="Note">\n\n</aside>',
    )
  })
})
