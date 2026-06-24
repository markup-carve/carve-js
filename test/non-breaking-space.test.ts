import { describe, it, expect } from 'vitest'
import { carveToHtml, carveToMarkdown, carveToPlainText, carveToAnsi } from '../src/index.js'

/**
 * Non-breaking-space placeholder (U+E000) handling across renderers.
 *
 * The line-block indent and the escaped space (`\ `) share one private-use
 * sentinel. It renders as `&nbsp;` in HTML, a real non-breaking space (U+00A0)
 * in Markdown (so it survives a round-trip re-render and is not mistaken for an
 * indented code block), and an ordinary space in plain-text and ANSI output. A
 * literal U+00A0 in the author's own text is never altered.
 *
 * Mirrors carve-php's tests/TestCase/Renderer/NonBreakingSpaceTest.php
 * (markup-carve/carve-php#123).
 */

const NBSP = '\u00a0'
const PLACEHOLDER = '\ue000'
const ANSI_CYAN = '\x1b[36m'
const ANSI_DIM = '\x1b[2m'
const ANSI_RESET = '\x1b[0m'

// Strip ANSI SGR escapes so assertions can target the rendered characters.
function stripAnsi(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\[[0-9;]*m/g, '')
}

describe('non-breaking-space handling', () => {
  it('renders the line-block indent as &nbsp; in HTML', () => {
    const html = carveToHtml('::: |\nflush\n  indented\n:::')

    expect(html).toContain('flush<br>\n&nbsp;&nbsp;indented')
    expect(html).not.toContain(PLACEHOLDER)
  })

  it('renders the line-block indent as a real nbsp in Markdown', () => {
    const markdown = carveToMarkdown('::: |\nflush\n  indented\n:::')

    expect(markdown).toContain(`${NBSP}${NBSP}indented`)
    expect(markdown).not.toContain(PLACEHOLDER)
  })

  it('renders the line-block indent as ordinary spaces in plain text', () => {
    const text = carveToPlainText('::: |\nflush\n  indented\n:::')

    expect(text).toContain('flush\n  indented')
    expect(text).not.toContain(PLACEHOLDER)
    expect(text).not.toContain(NBSP)
  })

  it('does not leak the placeholder for an escaped space into non-HTML output', () => {
    expect(carveToMarkdown('a\\ b')).toContain(`a${NBSP}b`)
    expect(carveToPlainText('a\\ b')).toContain('a b')
    expect(stripAnsi(carveToAnsi('a\\ b'))).not.toContain(PLACEHOLDER)
    expect(stripAnsi(carveToAnsi('a\\ b'))).toContain('a b')
  })

  it('preserves a literal non-breaking space in non-HTML output', () => {
    const source = `ice${NBSP}cream`

    expect(carveToPlainText(source)).toContain(`ice${NBSP}cream`)
    expect(carveToMarkdown(source)).toContain(`ice${NBSP}cream`)
  })

  describe('literal non-breaking space is content, not structural whitespace', () => {
    const cases = [
      {
        name: 'leading nbsp',
        source: `${NBSP}x`,
        html: `<p>&nbsp;x</p>`,
        markdown: `${NBSP}x\n`,
        plain: `${NBSP}x\n`,
        ansi: `${NBSP}x\n`,
      },
      {
        name: 'trailing nbsp',
        source: `x${NBSP}`,
        html: `<p>x&nbsp;</p>`,
        markdown: `x${NBSP}\n`,
        plain: `x${NBSP}\n`,
        ansi: `x${NBSP}\n`,
      },
      {
        name: 'double leading nbsp',
        source: `${NBSP}${NBSP}x`,
        html: `<p>&nbsp;&nbsp;x</p>`,
        markdown: `${NBSP}${NBSP}x\n`,
        plain: `${NBSP}${NBSP}x\n`,
        ansi: `${NBSP}${NBSP}x\n`,
      },
      {
        name: 'blockquote content starts with nbsp',
        source: `> ${NBSP}x`,
        html: `<blockquote><p>&nbsp;x</p></blockquote>`,
        markdown: `> ${NBSP}x\n`,
        plain: `"${NBSP}x"\n`,
        ansi: `${ANSI_CYAN}${ANSI_DIM}│${ANSI_RESET} ${NBSP}x\n`,
      },
      {
        name: 'nbsp-only line is a paragraph',
        source: NBSP,
        html: `<p>&nbsp;</p>`,
        markdown: `${NBSP}\n`,
        plain: `${NBSP}\n`,
        ansi: `${NBSP}\n`,
      },
      {
        name: 'list item content starts with nbsp',
        source: `- ${NBSP}x`,
        html: `<ul>\n  <li>&nbsp;x</li>\n</ul>`,
        markdown: `- ${NBSP}x\n`,
        plain: `- ${NBSP}x\n`,
        ansi: `${ANSI_CYAN}•${ANSI_RESET} ${NBSP}x\n`,
      },
    ]

    for (const c of cases) {
      it(c.name, () => {
        expect(carveToHtml(c.source)).toBe(c.html)
        expect(carveToMarkdown(c.source)).toBe(c.markdown)
        expect(carveToPlainText(c.source)).toBe(c.plain)
        expect(carveToAnsi(c.source)).toBe(c.ansi)
      })
    }

    it('keeps regular ASCII spaces structural', () => {
      expect(carveToHtml(' x')).toBe('<p>x</p>')
      expect(carveToMarkdown(' x')).toBe('x\n')
      expect(carveToPlainText(' x')).toBe('x\n')
      expect(carveToAnsi(' x')).toBe('x\n')

      expect(carveToHtml('x ')).toBe('<p>x</p>')
      expect(carveToMarkdown('x ')).toBe('x\n')
      expect(carveToPlainText('x ')).toBe('x\n')
      expect(carveToAnsi('x ')).toBe('x\n')

      expect(carveToHtml(' ')).toBe('')
      expect(carveToMarkdown(' ')).toBe('\n')
      expect(carveToPlainText(' ')).toBe('\n')
      expect(carveToAnsi(' ')).toBe('\n')

      expect(carveToHtml('- x')).toBe('<ul>\n  <li>x</li>\n</ul>')
      expect(carveToMarkdown('- x')).toBe('- x\n')
      expect(carveToPlainText('- x')).toBe('- x\n')
      expect(carveToAnsi('- x')).toBe(`${ANSI_CYAN}•${ANSI_RESET} x\n`)
    })

    it('treats a leading  SP as content, not list indentation', () => {
      // A literal U+00A0 before a marker is content, so the line is a paragraph
      // (matching carve-php / carve-rs); only ASCII indentation opens a list.
      expect(carveToHtml(' - x')).toBe('<p>&nbsp;- x</p>')
      expect(carveToHtml(' 1. x')).toBe('<p>&nbsp;1. x</p>')
      // Regular ASCII indentation still opens a list.
      expect(carveToHtml('  - x')).toBe('<ul>\n  <li>x</li>\n</ul>')
    })

    it('treats a leading NBSP before a reference definition as content', () => {
      // ` [r]: /url` is a paragraph (the NBSP is content), not an
      // invisible link definition, matching carve-php / carve-rs.
      expect(carveToHtml(`${NBSP}[r]: /url`)).toBe('<p>&nbsp;[r]: /url</p>')
    })

    it('keeps an NBSP that directly follows a blockquote marker', () => {
      // `>` + U+00A0 (no ASCII space): the NBSP is content, not marker padding.
      expect(carveToHtml(`>${NBSP}x`)).toBe('<blockquote><p>&nbsp;x</p></blockquote>')
    })

    it('requires real whitespace after a reference-definition colon', () => {
      // `[r]:` + U+00A0 is not a valid definition separator, so the line is a
      // paragraph and the reference stays unresolved (matches carve-php).
      expect(carveToHtml(`[r]:${NBSP}/url\n\n[x][r]`)).toBe(
        '<p>[r]:&nbsp;/url</p>\n<p>[x][r]</p>',
      )
    })

    it('does not collect an NBSP-prefixed reference definition during the prepass', () => {
      // A leading U+00A0 before a container marker keeps the line as content in
      // BOTH the block parser and the ref-definition prepass, so a later
      // reference does not resolve from text that was never a definition.
      expect(carveToHtml(`${NBSP}> [r]: /url\n\n[x][r]`)).toBe(
        '<p>&nbsp;&gt; [r]: /url</p>\n<p>[x][r]</p>',
      )
      expect(carveToHtml(`${NBSP}- [r]: /url\n\n[x][r]`)).toBe(
        '<p>&nbsp;- [r]: /url</p>\n<p>[x][r]</p>',
      )
      // An NBSP as the list item's content (after the marker) is content too:
      // the prepass must not strip it and collect a hidden definition.
      expect(carveToHtml(`- ${NBSP}[r]: /url\n\n[x][r]`)).toBe(
        '<ul>\n  <li>&nbsp;[r]: /url</li>\n</ul>\n<p>[x][r]</p>',
      )
    })

    it('does not let an NBSP on a comment fence desync the closer (no doc-swallow)', () => {
      // A comment delimiter is structural: a stray U+00A0 after the opener must
      // not prevent the `%%%` closer from matching and swallow the rest of the
      // document. (Lookahead loops must also terminate at EOF, not treat the
      // post-EOF "line" as an endless run of blanks.)
      expect(carveToHtml('%%% \ncomment\n%%%\nvisible')).toBe('<p>visible</p>')
    })
  })
})
