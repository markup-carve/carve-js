import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

/*
 * A zero-width character is content, so it does not indent a marker.
 *
 * The marker patterns spell their leading indentation `[^\S ]` - `\s`
 * minus NBSP - and JavaScript's `\s` contains U+FEFF where Rust's
 * `char::is_whitespace` and PCRE's `\s` do not. So a mark before a bullet was
 * skipped as indentation here and treated as content by carve-php and
 * carve-rs, which keep the line literal (carve-js#790).
 *
 * The rule is not a vote. PART 9 states that zero-width characters are NOT
 * whitespace and ARE ordinary characters, and the corpus pins the narrow
 * exception - `docs/examples/edge-cases.md`, "Line endings and a byte order
 * mark": a mark at the START of a document is not content. Everywhere else it
 * is, and content before a marker means the marker does not open a block.
 *
 * This engine also contradicted itself: the same mark survives into a
 * paragraph's text, so it was content in one position and absent in another.
 */

const BOM = '﻿'
const ZWSP = '​'

describe('a zero-width character does not indent a block marker', () => {
  const markers: Array<[string, string]> = [
    ['bullet', '- a'],
    ['star bullet', '* a'],
    ['ordered', '1. a'],
    ['task', '- [ ] a'],
    ['blockquote', '> q'],
  ]

  for (const [label, line] of markers) {
    it(`keeps the line literal: ${label}`, () => {
      const withMark = carveToHtml(`para\n\n${BOM}${line}\n`)
      const plain = carveToHtml(`para\n\n${line}\n`)

      expect(withMark).not.toBe(plain)
      expect(withMark).toContain(BOM)
    })
  }

  it('a definition line is literal AND registers nothing', () => {
    // Two halves, and the second is the one that hid. The line rendered
    // literally while the definition was still collected, so a reference
    // resolved against a line the renderer prints verbatim - the collector
    // matches a container-stripped view, and the strip ate the mark before the
    // pattern ever saw it.
    const out = carveToHtml(`para\n\n${BOM}[r]: /u\n\nsee [x][r]\n`)

    expect(out).toContain(`${BOM}[r]: /u`)
    expect(out).not.toContain('href="/u"')
  })

  it('a footnote definition behaves the same way', () => {
    const out = carveToHtml(`para\n\n${BOM}[^f]: n\n\nsee[^f]\n`)

    expect(out).toContain(`${BOM}[^f]: n`)
    expect(out).not.toContain('doc-noteref')
  })

  it('a marker-prefixed definition line registers nothing either', () => {
    // One level in, and it survived the first fix: the definition prepass
    // strips container prefixes before matching, and those prefix patterns had
    // their own copy of the class. So the line rendered literally while the
    // definition still registered - the same contradiction, one call deeper.
    for (const prefix of ['- ', '> ']) {
      const out = carveToHtml(`para\n\n${BOM}${prefix}[r]: /u\n\nsee [x][r]\n`)

      expect(out).not.toContain('href="/u"')
    }

    // The control: without the mark these DO register, so the assertion above
    // is about the mark rather than about marker-prefixed definitions.
    expect(carveToHtml('para\n\n- [r]: /u\n\nsee [x][r]\n')).toContain('href="/u"')
  })

  it('a definition at the document start still resolves', () => {
    // The strip carries this case, not the character class - which is what the
    // old carve-out was actually measuring when it said all three engines skip
    // a mark before the `[`.
    expect(carveToHtml(`${BOM}[r]: /u\n\nsee [x][r]\n`)).toContain('href="/u"')
  })

  it('a mark at the START of the document is still not content', () => {
    // The one exception the corpus pins. Narrowing the class must not take
    // this with it.
    expect(carveToHtml(`${BOM}- a\n`)).toBe(carveToHtml('- a\n'))
  })

  it('ordinary indentation still indents', () => {
    // The control. A change that stopped treating anything as indentation
    // would satisfy every assertion above.
    expect(carveToHtml('- a\n  - b\n')).toContain('<ul>')
    expect(carveToHtml('para\n\n  - a\n')).toContain('<ul>')
  })

  it('a no-break space is still content, as it already was', () => {
    const withNbsp = carveToHtml('para\n\n - a\n')

    expect(withNbsp).not.toBe(carveToHtml('para\n\n- a\n'))
  })

  it('a zero-width space behaves the same as the mark', () => {
    // ZWSP is not in JavaScript's `\s`, so it was already content here. Pinned
    // so the two zero-width characters cannot drift apart later.
    expect(carveToHtml(`para\n\n${ZWSP}- a\n`)).toContain(ZWSP)
  })
})
