import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'

const h = (s: string) => carveToHtml(s)

/**
 * A paragraph's FINAL trailing whitespace is stripped before inline parsing
 * (CommonMark / djot / carve-php all do this), so `abc ` is `<p>abc</p>` and a
 * bare `# ` (hash + space, not a heading) is `<p>#</p>`.
 *
 * Only the whitespace at the very END of the paragraph is dropped. Interior
 * line trailing whitespace before a soft break is KEPT verbatim, because in
 * Carve two trailing spaces are NOT a hard break (only a backslash at end of
 * line is). A backslash hard break is never affected. Verified against
 * carve-php (the reference implementation).
 */
describe('paragraph trailing whitespace', () => {
  it('strips a single trailing space', () => {
    expect(h('abc ')).toBe('<p>abc</p>')
  })

  it('strips a trailing tab', () => {
    expect(h('abc\t')).toBe('<p>abc</p>')
  })

  it('treats a bare hash + space as a paragraph and strips the trailing space', () => {
    expect(h('# ')).toBe('<p>#</p>')
  })

  it('leaves a paragraph with no trailing whitespace unchanged', () => {
    expect(h('abc')).toBe('<p>abc</p>')
  })

  it('keeps interior trailing spaces before a soft break (not a hard break in Carve)', () => {
    // Two trailing spaces mid-paragraph are NOT a hard break; the spaces and
    // the soft break are preserved verbatim. Matches carve-php.
    expect(h('a  \nb')).toBe('<p>a  \nb</p>')
  })

  it('strips only the FINAL trailing whitespace, keeping the interior run', () => {
    expect(h('a  \nb  ')).toBe('<p>a  \nb</p>')
  })

  it('preserves a backslash hard break', () => {
    expect(h('a\\\nb')).toBe('<p>a<br>\nb</p>')
  })

  it('leaves leading whitespace handling unchanged', () => {
    expect(h('  abc  ')).toBe('<p>abc</p>')
  })
})
