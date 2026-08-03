import { describe, it, expect } from 'vitest'
import { carveToCarve, carveToHtml, carveToMarkdown, carveToPlainText, parse } from '../src/index.js'

/**
 * A line block is its own AST node (`line_block`), not a div carrying a
 * `.line-block` class.
 *
 * The class alone cannot express the difference: inside a `::: |` fence every
 * newline is a hard break, while a plain div an author gave that class keeps
 * soft breaks. With only the class to go on the writer could not tell which one
 * to emit, so it emitted the generic form and a formatted line block re-parsed
 * as an ordinary div - `parse(fmt(x)) == parse(x)` did not hold (issue 359).
 * The spec's profiles.md block vocabulary lists `line_block` for the same
 * reason: a profile denying it has to be able to name it.
 */
describe('line_block', () => {
  const source = '::: |\nRoses are red,\n  Violets are blue.\n:::\n'

  it('parses to its own node type', () => {
    const doc = parse(source)
    expect(doc.children[0]?.type).toBe('line_block')
  })

  it('still renders as a div carrying the line-block class', () => {
    // The class is part of the output contract, not of the AST.
    expect(carveToHtml(source)).toContain('<div class="line-block">')
  })

  it('keeps an author attribute alongside the structural class', () => {
    // The structural class trails the author's attributes, matching carve-php
    // and carve-rs.
    expect(carveToHtml(`{#verse}\n${source}`)).toContain('<div id="verse" class="line-block">')
    expect(carveToHtml(`{.foo #v}\n${source}`)).toContain('<div class="foo line-block" id="v">')
  })

  it('round-trips through the writer byte for byte', () => {
    expect(carveToCarve(source)).toBe(source)
  })

  it('preserves the leading indentation as spaces, not as a literal nbsp', () => {
    // The parser records the indent with the U+E000 placeholder, which the
    // writer used to resolve to a real nbsp - and a real nbsp re-parses as
    // literal text rather than as indentation.
    const out = carveToCarve(source)
    expect(out).toContain('\n  Violets')
    expect(out).not.toContain(' ')
  })

  it('is idempotent', () => {
    const once = carveToCarve(source)
    expect(carveToCarve(once)).toBe(once)
  })

  it('leaves a plain div that happens to carry the class as a div', () => {
    const div = '{.line-block}\n:::\nRoses are red,\n:::\n'
    expect(parse(div).children[0]?.type).toBe('div')
  })
})

/**
 * A medial gap is the inline alignment a caesura or a column of aligned text is
 * made of, and a line block preserves it for the same reason it preserves the
 * indent: the author's per-line layout IS the content. Collapsing it left Old
 * English verse and address blocks rendering as ordinary prose spacing.
 *
 * Only a run of two or more columns counts. A lone inner space stays an
 * ordinary collapsible space so a long line can still wrap between words, which
 * is what keeps this from being "every space is nbsp".
 *
 * carve-php has rendered it this way since its #127; this brings carve-js to
 * the same output.
 */
describe('line_block medial gaps', () => {
  const NBSP = '\u00a0'
  const nbsp = (n: number) => NBSP.repeat(n)

  it('preserves an inner run of two or more spaces', () => {
    const html = carveToHtml('::: |\nTwo roads    diverged\n:::\n')
    expect(html).toContain(`Two roads${'&nbsp;'.repeat(4)}diverged`)
  })

  it('leaves a single inner space collapsible', () => {
    const html = carveToHtml('::: |\nTwo roads diverged\n:::\n')
    expect(html).toContain('Two roads diverged')
    expect(html).not.toContain('&nbsp;')
  })

  it('preserves a trailing run', () => {
    expect(carveToHtml('::: |\nword   \n:::\n')).toContain(`word${'&nbsp;'.repeat(3)}`)
  })

  it('keeps the indent and the gap on the same line', () => {
    const html = carveToHtml('::: |\n  indented    gapped\n:::\n')
    expect(html).toContain(`${'&nbsp;'.repeat(2)}indented${'&nbsp;'.repeat(4)}gapped`)
  })

  it('expands a medial tab to its column stop', () => {
    // Same tab-stop arithmetic as the indent: a tab advances to the next
    // multiple of four, counted from the column the run starts at.
    expect(carveToHtml('::: |\nab\tcd\n:::\n')).toContain(`ab${'&nbsp;'.repeat(2)}cd`)
  })

  it('parses inline content on both sides of a gap', () => {
    const html = carveToHtml('::: |\n*bold*    /em/\n:::\n')
    expect(html).toContain(`<strong>bold</strong>${'&nbsp;'.repeat(4)}<em>em</em>`)
  })

  it('resolves the sentinel per renderer, never leaking U+E000', () => {
    const source = '::: |\nTwo roads    diverged\n:::\n'
    // Markdown gets real non-breaking spaces, plain text ordinary ones.
    expect(carveToMarkdown(source)).toContain(`Two roads${nbsp(4)}diverged`)
    expect(carveToPlainText(source)).toContain('Two roads    diverged')
    for (const out of [carveToHtml(source), carveToMarkdown(source), carveToPlainText(source)]) {
      expect(out).not.toContain('\ue000')
    }
  })

  it('round-trips a gapped line through the writer byte for byte', () => {
    const source = '::: |\nTwo roads    diverged\nAnd looked   down\n:::\n'
    expect(carveToCarve(source)).toBe(source)
  })
})
