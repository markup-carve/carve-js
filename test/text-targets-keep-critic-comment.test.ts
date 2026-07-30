import { describe, expect, it } from 'vitest'
import { carveToAnsi, carveToHtml, carveToMarkdown, carveToPlainText } from '../src/index.js'

/**
 * A critic comment is VISIBLE content: the HTML target renders it as
 * `<span class="critic-comment"> note </span>`. Dropping it in the text targets
 * made two targets of one engine disagree about whether the document says it -
 * the same class of inconsistency as the unresolved footnote reference
 * (carve#352, corpus 33-editorial-markup).
 *
 * carve-php kept it; this engine and carve-rs dropped it.
 */
describe('the text targets keep a critic comment', () => {
  it('keeps it in plain text', () => {
    expect(carveToPlainText('b{# note #}\n')).toBe('b note\n')
  })

  it('keeps it in ANSI', () => {
    expect(carveToAnsi('b{# note #}\n')).toContain('note')
  })

  it('agrees with the HTML target about the content being there', () => {
    const src = 'b{# note #}\n'
    expect(carveToHtml(src)).toContain('note')
    expect(carveToPlainText(src)).toContain('note')
    expect(carveToAnsi(src)).toContain('note')
  })

  it('keeps it alongside the other editorial marks', () => {
    const src = 'a {+ins+} {-del-} {~old~>new~} b{# note #}\n'
    expect(carveToPlainText(src)).toBe('a ins ~del~ ~old~new b note\n')
  })
})

describe('the Markdown target keeps a critic comment', () => {
  it('keeps it as text, since Markdown has no critic syntax', () => {
    expect(carveToMarkdown('b{# note #}\n')).toBe('b note\n')
  })

  it('escapes it like any other text landing in a Markdown document', () => {
    // A comment carrying Markdown metacharacters must not become live markup when
    // the output is re-rendered.
    expect(carveToMarkdown('b{# *not emphasis* #}\n')).toContain('\\*not emphasis\\*')
  })
})
