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
})
