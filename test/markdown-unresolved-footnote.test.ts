import { describe, expect, it } from 'vitest'
import { carveToMarkdown } from '../src/index.js'

/**
 * A footnote reference with no matching definition did not form a footnote, so
 * what the Markdown target emits is ordinary text - and its brackets are
 * Markdown metacharacters, which PART 11 §8 M1 escapes unconditionally.
 *
 * Emitting them bare handed the re-parser markup the document never had. A GFM
 * processor with footnotes enabled sees `[^a]` and looks for a definition; the
 * escaped form cannot be mistaken for anything.
 */
describe('an unresolved footnote reference is escaped in Markdown', () => {
  it('escapes the brackets when there is no definition', () => {
    expect(carveToMarkdown('Use [^a].\n')).toBe('Use \\[^a\\].\n')
  })

  it('leaves a resolved reference as a real Markdown footnote', () => {
    expect(carveToMarkdown('Use [^a].\n\n[^a]: A real note.\n')).toBe(
      'Use [^a].\n\n[^a]: A real note.\n',
    )
  })

  it('is not confused by a definition for a different label', () => {
    expect(carveToMarkdown('Use [^a].\n\n[^b]: Other.\n')).toContain('\\[^a\\]')
  })

  it('leaves an inline note alone', () => {
    expect(carveToMarkdown('Use ^[a note].\n')).toBe('Use ^[a note].\n')
  })
})
