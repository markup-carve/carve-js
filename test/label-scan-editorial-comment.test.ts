import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

/**
 * A link label's closing `]` is found by a scan that skips spans whose content
 * is LITERAL, because a `]` there is content and no escape can spell it
 * otherwise (PART 9, `link_text`).
 *
 * Code spans were already skipped. An editorial comment was not, so a `]`
 * inside one ended the label early — and since `{# ... #}` resolves no escapes,
 * writing `\]` did not help: it put a real backslash in the comment. The author
 * had no correct spelling available (carve#403).
 */
describe('a link label scans past an editorial comment', () => {
  it('finds the label close after a comment containing ]', () => {
    const out = carveToHtml('[{#a]b#}](u)\n')

    expect(out).toContain('<a href="u">')
    expect(out).toContain('<span class="critic-comment">a]b</span>')
  })

  it('keeps the comment text exactly, backslash and all', () => {
    // The content is literal, so `\]` is a backslash followed by a bracket —
    // not an escape. This is the spelling authors were forced into before.
    expect(carveToHtml('[{#a\\]b#}](u)\n')).toContain('a\\]b')
  })

  it('still skips code spans', () => {
    expect(carveToHtml('[`a]b`](u)\n')).toContain('<a href="u">')
  })

  it('does not treat an unclosed {# as a comment', () => {
    // No `#}` follows, so there is no span to skip and the scan is unchanged.
    const out = carveToHtml('[{#unclosed](u)\n')

    expect(out).not.toContain('critic-comment')
  })

  it('leaves an ordinary bare ] closing the label', () => {
    expect(carveToHtml('[a]b](u)\n')).not.toContain('<a')
  })

  it('handles a comment that is the whole label', () => {
    expect(carveToHtml('[{#note#}](u)\n')).toContain('<a href="u">')
  })
})
