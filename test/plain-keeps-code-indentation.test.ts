import { describe, expect, it } from 'vitest'
import { carveToHtml, carveToPlainText } from '../src/index.js'

/**
 * A document-level trim has no business reaching into code content.
 *
 * The plain renderer trimmed both ends of the whole document, so a document that
 * OPENS with a fenced code block whose first line is indented lost that
 * indentation - a tab the HTML target emits inside `<code>` vanished
 * (carve#352, corpus 11-fenced-code-2). carve-rs was the only engine keeping it.
 *
 * The two ends need different rules: leading whitespace on the first content line
 * is data, trailing whitespace on the last line is layout.
 */
describe('the plain target keeps code indentation', () => {
  it('keeps a leading tab in a code block that opens the document', () => {
    const src = '```\n\tindented with a tab\n```\n'
    expect(carveToPlainText(src)).toBe('\tindented with a tab\n')
  })

  it('agrees with what the HTML target puts inside <code>', () => {
    const src = '```\n\tindented with a tab\n```\n'
    expect(carveToHtml(src)).toContain('\tindented with a tab')
    expect(carveToPlainText(src)).toContain('\tindented with a tab')
  })

  it('keeps space indentation too', () => {
    expect(carveToPlainText('```\n    four spaces\n```\n')).toBe('    four spaces\n')
  })

  it('still trims trailing whitespace at the end of the document', () => {
    // A table row ending in an empty cell renders `x | `; that space is an
    // artifact of the separator, not content.
    expect(carveToPlainText('|= A |= B |\n| x |  |\n')).toBe('A | B\nx |\n')
  })

  it('still drops blank lines around the document', () => {
    expect(carveToPlainText('\n\n\nhello\n\n\n')).toBe('hello\n')
  })
})
