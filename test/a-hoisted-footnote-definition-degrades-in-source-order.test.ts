import { describe, it, expect } from 'vitest'
import { carveToCarve, carveToMarkdown, carveToPlainText, carveToAnsi, carveToHtml, parse, renderMarkdown } from '../src/index.js'

/**
 * A hoisted footnote definition degrades in SOURCE order, not map order.
 *
 * §7 collects the two definition kinds and hoists them to the document, where
 * they are ordered by source position. `Document.footnoteDefs` does NOT record
 * that order: a definition is inserted when its body is finalized, so a
 * definition nested inside another note's body lands in the map FIRST, because
 * the inner body closes first.
 *
 * The HTML writer never saw the difference - it emits endnotes in numbering
 * order - and neither did the canonical writer, which writes each definition
 * back at its own source line. The markdown, plain and ansi writers walked the
 * map directly, so they alone reordered the definitions, and carve-rs and
 * carve-php disagreed with this engine on all three targets
 * (markup-carve/carve#1802, reported by the daily `ast-conformance` run).
 *
 * Ordering by NUMBER would not do: these writers emit every DEFINED footnote,
 * and an unreferenced definition has no number. The last case below is that
 * control.
 */
describe('a hoisted footnote definition degrades in source order', () => {
  // `inner` is authored inside `outer`'s body, so it is hoisted out of a note
  // that is itself a definition - the shape that inverts the map.
  const nested = '[^outer]: intro\n\n     [^inner]: note\n\n     see[^inner]\n\nsee[^outer]\n'

  it('numbers outer first, which is the order the writers must follow', () => {
    const html = carveToHtml(nested)
    expect(html.indexOf('id="fn1"')).toBeLessThan(html.indexOf('id="fn2"'))
    // fn1 is `outer`: its body is the one holding the reference to `inner`.
    expect(html).toContain('<li id="fn1">\n      <p>intro</p>')
  })

  it('writes the canonical form with outer above inner', () => {
    expect(carveToCarve(nested)).toBe('see[^outer]\n\n[^outer]: intro\n\n  see[^inner]\n\n[^inner]: note\n')
  })

  it('degrades to Markdown with outer above inner', () => {
    expect(carveToMarkdown(nested)).toBe('see[^outer]\n\n[^outer]: intro\n\nsee[^inner]\n[^inner]: note\n')
  })

  it('degrades to plain text with outer above inner', () => {
    expect(carveToPlainText(nested)).toBe('see[outer]\n\n[^outer]: intro\n\nsee[inner]\n[^inner]: note\n')
  })

  it('degrades to ANSI with outer above inner', () => {
    // The order is what is under test; the escapes are incidental, so assert on
    // the sequence of the two labels rather than on the whole styled string.
    const out = carveToAnsi(nested)
    expect(out.indexOf('[^outer]')).toBeLessThan(out.indexOf('[^inner]'))
  })

  it('still emits a definition nothing references, which has no number', () => {
    // The control for "order by number instead": `unused` never gets a number,
    // so a numbering-order writer would drop it.
    const src = 'see[^a]\n\n[^a]: one\n\n[^unused]: two\n'
    expect(carveToMarkdown(src)).toBe('see[^a]\n\n[^a]: one\n[^unused]: two\n')
  })

  it('keeps the map order when the tree carries no positions', () => {
    // An AST ingested from JSON has no `footnoteDefPos`; the writer must not
    // reshuffle it, and must not throw reaching for a position that is absent.
    // Parsed, then stripped, so the node shapes are the parser's own.
    const ast = parse('see[^b] and [^a]\n\n[^a]: one\n\n[^b]: two\n')
    expect(Object.keys(ast.footnoteDefs!)).toEqual(['a', 'b'])
    delete ast.footnoteDefPos
    // Reversed on purpose: with no positions the map order is all there is, so
    // this must come back reversed rather than sorted back into source order.
    ast.footnoteDefs = { b: ast.footnoteDefs!['b']!, a: ast.footnoteDefs!['a']! }
    expect(renderMarkdown(ast)).toBe('see[^b] and [^a]\n\n[^b]: two\n[^a]: one\n')
  })
})
