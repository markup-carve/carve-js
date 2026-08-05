import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'

/**
 * A footnote continuation's indent is a COLUMN claim, not a character count.
 *
 * PART 9 §16 asks a continuation line for >= 2 columns, and §24 C1 gives a tab
 * a column value: it advances to the next multiple of 4 from wherever it
 * starts. So a bare tab reaches column 4 and continues the note exactly as two
 * literal spaces do (spec markup-carve/carve#796, corpus
 * `224-a-tab-reaches-a-footnote-body-s-column-just-as-two-spaces-do`).
 *
 * This engine matched characters instead - a space followed by any whitespace -
 * so it accepted `<SPACE><TAB>` and rejected a bare tab. carve-php had the
 * complementary half (two spaces or a bare tab, never the mixture), and
 * carve-rs matched this one. Three engines, three readings, no two agreeing on
 * the pair (carve-js#725).
 *
 * The failure is not cosmetic: a rejected continuation does not render with
 * different spacing, it LEAVES the note and becomes a top-level paragraph
 * above the reference, so the content moves out of the endnote and into the
 * document body.
 */
describe('a footnote continuation is measured in columns', () => {
  const continues = (indent: string, blank = true): boolean => {
    const src = `[^a]: note\n${blank ? '\n' : ''}${indent}more\n\nsee[^a]\n`
    const html = carveToHtml(src)
    // "more" inside the note's <li>, rather than as a document paragraph.
    return !/<p>more<\/p>/.test(html) && /more/.test(html)
  }

  it('takes two spaces, which is the shape everything already agreed on', () => {
    expect(continues('  ')).toBe(true)
  })

  it('takes a bare tab, which reaches column 4', () => {
    expect(continues('\t')).toBe(true)
  })

  it('takes a space then a tab, which also reaches column 4', () => {
    expect(continues(' \t')).toBe(true)
  })

  it('takes a bare tab with no blank line before it', () => {
    expect(continues('\t', false)).toBe(true)
  })

  it('still refuses one space, which reaches only column 1', () => {
    expect(continues(' ')).toBe(false)
  })

  it('still refuses a flush-left line', () => {
    expect(continues('')).toBe(false)
  })

  it('dedents by the column, not by the character count', () => {
    // The body's own column is 2. A tab reaching column 4 leaves two residual
    // columns, which the body's blocks read themselves - so the paragraph text
    // keeps no leading tab and gains no code block.
    const html = carveToHtml('[^a]: note\n\n\tmore\n\nsee[^a]\n')
    expect(html).not.toContain('<pre>')
    expect(html).toMatch(/<p>\s*more/)
  })
})
