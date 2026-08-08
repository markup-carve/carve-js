import { describe, it, expect } from 'vitest'
import { carveToMarkdown, carveToPlainText, carveToAnsi, carveToHtml } from '../src/index.js'
import type { Document } from '../src/ast.js'
import { renderMarkdown, renderPlainText, renderAnsi } from '../src/index.js'
import { blankDeniedDestination } from '../src/deny-listed-destination.js'
import { SCHEME_PROBE_STRIP_RE } from '../src/render-html.js'

/**
 * PART 9 section 29, `C0 CONTROLS ON THE RENDER TARGETS`.
 *
 * After markup-carve/carve#963 the whitespace of this language is exactly
 * U+0020, U+0009, U+000A and U+000D. EVERY OTHER C0 CONTROL is content, and the
 * targets answer separately: HTML, Markdown and plain EMIT it; ANSI STRIPS it.
 *
 * This engine stripped the whole `\p{Cc}` block on all three non-HTML targets,
 * which made Carve the lossy party: four Markdown readers were measured - the
 * CommonMark reference implementation and markdown-it in default, commonmark
 * and typographer modes - and all four KEEP these characters
 * (markup-carve/carve-js#896).
 *
 * Every probe character is built from an escape rather than written literally,
 * because a source file carrying a literal control is easy to mangle in review,
 * and the assertions are on bytes for the same reason.
 */

/** U+0000..U+0008, U+000B, U+000C, U+000E..U+001F - the whole class. */
const SECTION_29_CLASS: number[] = [
  ...Array.from({ length: 9 }, (_, i) => i),
  0x0b,
  0x0c,
  ...Array.from({ length: 18 }, (_, i) => 0x0e + i),
]

/** Not in the class, and each for its own reason. */
const WHITESPACE = [0x09, 0x0a, 0x0d]
const OUTSIDE_SECTION_29 = [0x7f, 0x80, 0x9b, 0x9d, 0x9f]

const has = (s: string, cp: number) => [...s].some((c) => c.codePointAt(0) === cp)

describe('the non-HTML targets answer section 29 separately', () => {
  it('the class is the whole class, and it is 29 characters wide', () => {
    expect(SECTION_29_CLASS).toHaveLength(29)
    expect(SECTION_29_CLASS).not.toContain(0x09)
    expect(SECTION_29_CLASS).not.toContain(0x0a)
    expect(SECTION_29_CLASS).not.toContain(0x0d)
  })

  it('Markdown and plain emit every character of the class', () => {
    // U+0000 is set aside: the reader replaces it with U+FFFD before any target
    // sees it, in every engine, so no target can emit it. Asserted below rather
    // than quietly skipped.
    for (const cp of SECTION_29_CLASS.filter((c) => c !== 0x00)) {
      const src = `a${String.fromCodePoint(cp)}b\n`
      expect(has(carveToMarkdown(src), cp), `markdown U+${cp.toString(16)}`).toBe(true)
      expect(has(carveToPlainText(src), cp), `plain U+${cp.toString(16)}`).toBe(true)
      expect(has(carveToHtml(src), cp), `html U+${cp.toString(16)}`).toBe(true)
    }
  })

  it('NUL never reaches a target, because the reader replaced it', () => {
    const src = `a${String.fromCodePoint(0x00)}b\n`
    for (const render of [carveToMarkdown, carveToPlainText, carveToHtml, carveToAnsi]) {
      expect(has(render(src), 0x00)).toBe(false)
    }
    expect(carveToPlainText(src)).toContain('\ufffd')
  })

  it('the terminal target strips the whole class', () => {
    for (const cp of SECTION_29_CLASS.filter((c) => c !== 0x00)) {
      const src = `a${String.fromCodePoint(cp)}b\n`
      expect(has(carveToAnsi(src), cp), `ansi U+${cp.toString(16)}`).toBe(false)
    }
  })

  it('DEL and the C1 controls stay refused on all three non-HTML targets', () => {
    // Section 29 T5 puts them outside the section, and CSI (U+009B) and OSC
    // (U+009D) are single-character forms of the sequences section 25 exists to
    // stop. Narrowing the strip to "every C0 control" would have taken these
    // with it, which is the regression this row exists to catch.
    for (const cp of OUTSIDE_SECTION_29) {
      const src = `a${String.fromCodePoint(cp)}b\n`
      for (const render of [carveToMarkdown, carveToPlainText, carveToAnsi]) {
        expect(has(render(src), cp), `U+${cp.toString(16)}`).toBe(false)
      }
    }
  })

  it('U+000D is whitespace, not content, so it is not emitted', () => {
    // carve#963 made carriage return whitespace, so section 29 excludes it. The
    // reader normalizes line endings long before a renderer sees one, which is
    // why this holds from source; the strip's own arm is what keeps it holding
    // for a tree built through the API.
    expect(WHITESPACE).toContain(0x0d)
    for (const render of [carveToMarkdown, carveToPlainText, carveToAnsi]) {
      expect(has(render('a\rb\n'), 0x0d)).toBe(false)
    }
  })

  it('a vertical tab does not open a list for the reader downstream', () => {
    // The sharpest measured case: `-<VT>item` opens no list in the CommonMark
    // reference implementation or in markdown-it. If the character were
    // whitespace to that reader, it would - so keeping it is what preserves the
    // meaning across the boundary, and stripping it is what changed it.
    const out = carveToMarkdown(`-${String.fromCodePoint(0x0b)}item\n`)
    expect(out).toContain(`-${String.fromCodePoint(0x0b)}item`)
  })

  it('the class survives across constructs, not only in a paragraph', () => {
    const constructs = [
      'a@b\n',
      '# a@b\n',
      '> a@b\n',
      '- a@b\n',
      '`a@b`\n',
      '```\na@b\n```\n',
      '| a@b |\n|---|\n| c |\n',
      '[a@b](/u)\n',
      '![a@b](i.png)\n',
      't[^f]\n\n[^f]: a@b\n',
      '::: note\na@b\n:::\n',
      '*[H@T]: Hyper a@b\n\nH@T\n',
    ]
    // U+001B is left out of the ANSI arm: the terminal renderer writes its OWN
    // escapes with that byte, so a plain byte scan cannot tell the author's from
    // the renderer's. The paragraph row above probes it in isolation, where the
    // renderer emits no styling.
    for (const cp of [0x01, 0x0b, 0x0c, 0x1f]) {
      for (const tpl of constructs) {
        const src = tpl.replaceAll('@', String.fromCodePoint(cp))
        expect(has(carveToMarkdown(src), cp), `markdown ${tpl}`).toBe(true)
        expect(has(carveToPlainText(src), cp), `plain ${tpl}`).toBe(true)
        expect(has(carveToAnsi(src), cp), `ansi ${tpl}`).toBe(false)
      }
    }
  })

  it('a Markdown destination carries the class too, and still refuses a denied scheme', () => {
    // The destination is content as much as the text is, and carve-php and
    // carve-rs both emit it there. It is safe because the denied-scheme probe
    // still runs on the BROADLY stripped form: stripping only removes
    // characters, so a scheme denied in the authored form is denied in the
    // stripped one, and a consumer that ignores the controls sees exactly the
    // string that was already dismissed.
    expect(carveToMarkdown(`[t](/u${String.fromCodePoint(0x01)}v)\n`)).toContain(`/u${String.fromCodePoint(0x01)}v`)
    // STRIP-THEN-PROBE still holds. U+0001 and U+001F both parse inside a
    // destination, and both forms are blanked because the probe reads the
    // stripped string. U+000B and U+000C are not link destinations at all here,
    // so they arrive as ordinary text with no live URL to blank.
    for (const cp of [0x01, 0x1f]) {
      const out = carveToMarkdown(`[t](java${String.fromCodePoint(cp)}script:alert(1))\n`)
      expect(out, `U+${cp.toString(16)}`).not.toContain('script:alert')
    }
    expect(carveToMarkdown('[t](javascript:alert(1))\n')).not.toContain('javascript:')
  })

  it('U+000D is dropped on a tree built through the API, which is the only door to it', () => {
    // A MUTATION SURVIVED HERE and it was a finding, not a pass: flipping the
    // U+000D arm off changed no test, because the reader normalizes line
    // endings and a carriage return in SOURCE is a newline long before a
    // renderer sees one. The arm is reachable only through a hand-built tree,
    // which is the same door the non-HTML security sweep uses to reach every
    // other leaf.
    const doc: Document = {
      type: 'document',
      children: [{ type: 'paragraph', children: [{ type: 'text', value: 'a\rb' }] }],
    }
    expect(has(renderMarkdown(doc), 0x0d)).toBe(false)
    expect(has(renderPlainText(doc), 0x0d)).toBe(false)
    expect(has(renderAnsi(doc), 0x0d)).toBe(false)
  })

  it('the denied-scheme probe removes the section 29 class itself', () => {
    // WHY THE DESTINATION KEEPS ITS OWN BROAD STRIP even though replacing it
    // with the narrow one changes no output today. The probe's own class -
    // `SCHEME_PROBE_STRIP_RE` - already covers U+0000..U+0008, U+000E..U+001F
    // and, through `\s`, U+000B and U+000C, so the two strips are equivalent
    // AS LONG AS THAT HOLDS. The broad strip is defense in depth against the
    // day it narrows, and this row is the thing that would fail loudly on that
    // day rather than letting an obfuscated scheme through in silence.
    for (const cp of SECTION_29_CLASS) {
      const split = `java${String.fromCodePoint(cp)}script:alert(1)`
      expect(split.replace(SCHEME_PROBE_STRIP_RE, ''), `probe U+${cp.toString(16)}`).toBe(
        'javascript:alert(1)',
      )
      expect(blankDeniedDestination(split), `blank U+${cp.toString(16)}`).toBe('')
    }
    for (const cp of OUTSIDE_SECTION_29) {
      // THIS ROW USED TO ASSERT THE OPPOSITE, and the assertion was the defect
      // written down: the probe did NOT remove DEL or the C1 controls, and the
      // comment here explained that away as "which is exactly why the
      // destination is stripped before it is probed at all". That reasoning
      // held for the Markdown target, which does pre-strip, and for no other
      // caller of the probe - the HTML target has no pre-strip and emitted
      // `java<DEL>script:alert(1)` into an href with the raw byte intact
      // (markup-carve/carve-js#915). The probe class now spans DEL and C1, so
      // the pre-strip is belt-and-braces rather than the only thing holding.
      const split = `java${String.fromCodePoint(cp)}script:alert(1)`
      expect(split.replace(SCHEME_PROBE_STRIP_RE, ''), `probe U+${cp.toString(16)}`).toBe(
        'javascript:alert(1)',
      )
      expect(blankDeniedDestination(split), `blank U+${cp.toString(16)}`).toBe('')
    }
  })

  it('CONTROL: the section 8a sentinels are still not author-writable', () => {
    // The Markdown writer's own private-use sentinels are dropped from author
    // content, which is a different rule from section 29 and is untouched.
    for (const cp of [0xe004, 0xe005, 0xe006]) {
      expect(has(carveToMarkdown(`a${String.fromCodePoint(cp)}b\n`), cp)).toBe(false)
    }
  })
})
