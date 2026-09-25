import { describe, expect, it } from 'vitest'
import { carveToHtml, lintCarve } from '../src/index.js'

/**
 * A `::: footnotes` marker inside a container draws a lint finding
 * (carve-js#2045).
 *
 * `CARVE-P9-073` is normative: only a marker at document top level places. One
 * inside a block-level container renders §12's typed-div floor where it stands
 * and the endnotes section is appended where an unmarked document puts it, so
 * the output carries no sign that the authored placement was refused. carve-js
 * already renders that shape; what was missing is the report.
 *
 * carve#2292 ruled lint the home for a render-time refusal, both
 * machine-readable enums staying closed: nothing is dropped from the tree, so
 * the render-loss report has nothing to name, and the shape is spelled
 * perfectly well in Carve, so the producer-side channel has nothing to name
 * either. `unattached-block-attribute` already puts the same shape of finding
 * here - a construct that renders nothing and can be written by mistake.
 *
 * Each case asserts the RENDER beside the finding, because the finding is only
 * worth having if the refusal it names is real.
 */

const RULE = 'footnotes-placement-in-container'
const findings = (source: string) => lintCarve(source).filter((warning) => warning.rule === RULE)

/** A document whose one note is placed by the marker `body` spells. */
const withMarker = (body: string) => `Intro[^a].\n\n${body}\n\n[^a]: only note\n`

describe('a footnotes marker that cannot place is linted', () => {
  it('reports the ticket trigger, and the render shows the refusal', () => {
    const source = withMarker('> ::: footnotes\n> :::')
    const found = findings(source)
    expect(found).toHaveLength(1)
    expect(found[0]!.line).toBe(3)
    expect(found[0]!.message).toContain('does not place')
    expect(found[0]!.message).toContain('Move the marker to document level')

    const html = carveToHtml(source)
    // The floor where the marker stands, inside the quote that holds it...
    expect(html).toContain('<div class="footnotes">')
    // ...and the section appended at the end anyway, which is what nothing in
    // the output used to say.
    expect(html).toContain('<section role="doc-endnotes"')
    expect(html.indexOf('<div class="footnotes">')).toBeLessThan(html.indexOf('<section role="doc-endnotes"'))
  })

  // Every container the clause names that Carve source can spell a block into.
  const contained: Array<[string, string, number]> = [
    ['a block quote', '> ::: footnotes\n> :::', 3],
    ['a list item', '- ::: footnotes\n  :::', 3],
    ['a div body', '::: note\n::: footnotes\n:::\n:::', 4],
    ['a definition description', ':: term\n:  ::: footnotes\n   :::', 4],
  ]

  it.each(contained)('reports a marker in %s', (_name, body, line) => {
    const found = findings(withMarker(body))
    expect(found).toHaveLength(1)
    expect(found[0]!.line).toBe(line)
  })

  it('reports a marker inside a footnote definition', () => {
    const source = 'Intro[^a].\n\n[^a]: note\n\n    ::: footnotes\n    :::\n'
    expect(findings(source)).toHaveLength(1)
  })

  it('reports a marker in a table cell a cell-holding list spells', () => {
    // A core pipe-table cell is one line, so this position is reached through a
    // list whose items are cells (`::: list-table`) rather than through `| … |`.
    const source = withMarker('::: list-table\n- - ::: footnotes\n    :::\n  - b\n:::')
    expect(findings(source)).toHaveLength(1)
  })

  it('reports a contained marker in a document with no notes', () => {
    // The clause is about POSITION. A marker that could never place is worth
    // saying so about whether or not the document has a note for it to place.
    expect(findings('> ::: footnotes\n> :::\n')).toHaveLength(1)
  })

  it('reports the fmt-canonical spelling of the same empty container', () => {
    // `carve fmt` writes an empty container in a quote with the quote line
    // between the fences, so the rule has to read the shape a formatted document
    // carries as well as the compact one the ticket spells.
    expect(findings(withMarker('> ::: footnotes\n>\n> :::'))).toHaveLength(1)
  })

  it('says only that the section goes where it would without the marker', () => {
    // Raised by codex review. "Appended at the document end" is false when a
    // top-level marker places the section earlier: the contained marker still
    // refuses, and the message must not claim where the section landed.
    const source =
      'Intro[^a].\n\n> ::: footnotes\n>\n> :::\n\n::: footnotes\n:::\n\nAfter.\n\n[^a]: only note\n'
    const found = findings(source)
    expect(found).toHaveLength(1)
    expect(found[0]!.line).toBe(3)
    expect(found[0]!.message).not.toContain('document end')

    const html = carveToHtml(source)
    expect(html.indexOf('<section role="doc-endnotes"')).toBeLessThan(html.indexOf('<p>After.</p>'))
  })

  it('reports each contained marker separately', () => {
    const source = withMarker('> ::: footnotes\n> :::\n\n- ::: footnotes\n  :::')
    expect(findings(source)).toHaveLength(2)
  })

  describe('the legal case draws nothing', () => {
    it('leaves a top-level marker alone, and it still places', () => {
      // THE CONTROL. Without it a rule that fired on every marker passes every
      // case above.
      const source = withMarker('::: footnotes\n:::')
      expect(findings(source)).toEqual([])

      const html = carveToHtml(source)
      expect(html).toContain('<section role="doc-endnotes"')
      // Placed AT the marker, so the endnotes come before nothing else: a
      // second paragraph after the marker proves the section moved.
      const placed = carveToHtml(`Intro[^a].\n\n::: footnotes\n:::\n\nAfter.\n\n[^a]: only note\n`)
      expect(placed.indexOf('<section role="doc-endnotes"')).toBeLessThan(placed.indexOf('<p>After.</p>'))
    })

    it('leaves a document with no marker alone', () => {
      expect(findings(withMarker('Body.'))).toEqual([])
    })

    it('leaves a contained div of another kind alone', () => {
      expect(findings(withMarker('> ::: note\n> :::'))).toEqual([])
    })

    it('leaves the whole rule out of every other lint case', () => {
      // The rule reads one identity test, so a document with containers and
      // footnotes but no marker must draw nothing from it.
      const source = 'Intro[^a].\n\n> quote\n\n- item\n\n::: note\nbody\n:::\n\n[^a]: only note\n'
      expect(findings(source)).toEqual([])
    })
  })
})
