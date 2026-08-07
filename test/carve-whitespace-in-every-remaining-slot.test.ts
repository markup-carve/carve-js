import { describe, it, expect } from 'vitest'
import { carveToHtml, carveToCarve } from '../src/index.js'
import { renderCarve } from '../src/render-carve.js'
import type { BlockNode, Document } from '../src/ast.js'

/**
 * ONE WHITESPACE DEFINITION, IN EVERY CONSTRUCT (markup-carve/carve#977, PART
 * 7; the ruling on markup-carve/carve#963) - the slots the first pass did not
 * reach.
 *
 * `carve-whitespace-is-four-characters.test.ts` pinned nine sites. This file
 * pins the rest, found by MEASUREMENT rather than by reading: every construct
 * was fed a VERTICAL TAB, a FORM FEED and an ORDINARY CONTENT CHARACTER, and a
 * slot where the first two behave differently from the third is a slot reading
 * the host language's class.
 *
 * THE CONTROL IS U+0001, not a letter. JavaScript's `\s` is Unicode
 * White_Space plus U+FEFF minus U+0085, so it carries U+000B and U+000C and
 * NOT U+0001 - which makes U+0001 the sharpest control available: it is a C0
 * control exactly as the two probes are, it is content exactly as they are,
 * and any construct that treats it differently from them is deciding on the
 * host's class and not on Carve's. A letter would not do: a letter also passes
 * an identifier test, a slug test and an info-string test, so a difference
 * against a letter proves nothing about whitespace.
 *
 * THE CHARACTERS ARE BUILT FROM ESCAPES, never typed literally, and asserted
 * by code point before use. A probe file that loses the character it probes
 * reports the engine as correct - three of them did exactly that on the day
 * this ruling was measured.
 */

const VT = '\u000B'
const FF = '\u000C'
const SOH = '\u0001'
const NBSP = '\u00A0'

/** The document with `@` replaced by `ch`. */
const at = (tpl: string, ch: string) => tpl.split('@').join(ch)

/**
 * Assert that a construct reads U+000B and U+000C exactly as it reads U+0001.
 *
 * The comparison replaces the probe character by a fixed token in the output,
 * so what is compared is the SHAPE of the document, not the byte that varies.
 */
function readsTheSame(tpl: string, render: (src: string) => string): void {
  const shape = (ch: string) => render(at(tpl, ch)).split(ch).join('<X>')
  expect(shape(VT)).toBe(shape(SOH))
  expect(shape(FF)).toBe(shape(SOH))
}

describe('Carve whitespace is four characters, in the remaining slots', () => {
  it('has the probe characters it thinks it has', () => {
    expect(VT.charCodeAt(0)).toBe(0x0b)
    expect(FF.charCodeAt(0)).toBe(0x0c)
    expect(SOH.charCodeAt(0)).toBe(0x01)
    expect(NBSP.charCodeAt(0)).toBe(0xa0)
    for (const c of [VT, FF, SOH, NBSP]) expect(c).toHaveLength(1)
  })

  describe('a marker whose content is one control character has content', () => {
    it('a definition term holding one vertical tab is a term', () => {
      // `RE_DEFLIST_TERM` gated the term on `(?=\S)`, so `:: <VT>` was a
      // content-less marker and the whole list stayed a paragraph, while
      // `:: <SOH>` made the list.
      expect(carveToHtml(at(':: @\n:  d\n', VT))).toContain('<dl>')
      expect(carveToHtml(at(':: @\n:  d\n', FF))).toContain('<dl>')
      readsTheSame(':: @\n:  d\n', carveToHtml)
    })
  })

  describe('a line tail is padding of four characters, and of nothing else', () => {
    it('a trailing attribute block is not reached across a vertical tab', () => {
      // `splitTrailingAttrBlock` trimmed with `\s+$`, so the `{...}` on a link
      // definition still counted as trailing even behind a vertical tab.
      readsTheSame('[r]: /u {#q}@\n\n[r]\n', carveToHtml)
      readsTheSame('[r]: /u {#q}@\n\n[r]\n', carveToCarve)
    })

    it('a table continuation row ends at the pipe, not past a control', () => {
      readsTheSame('| a |\n+-----|@\n| b |\n', carveToHtml)
    })

    it("a block image's line tail is padding of four characters", () => {
      readsTheSame('![alt](/u)@\n', carveToHtml)
    })

    it('an attribute LINE is only attributes and padding', () => {
      // `{#x}<VT>` was an attribute line and `{#x}<SOH>` was a paragraph.
      readsTheSame('{#x}@\np\n', carveToHtml)
      readsTheSame('{#x}@\np\n', carveToCarve)
    })
  })

  describe('one separator run, spelled once', () => {
    it('two attribute blocks are separated by whitespace only', () => {
      readsTheSame('{#a}@{.b}\np\n', carveToHtml)
    })

    it('an unquoted attribute value runs to whitespace', () => {
      // `{k=v<VT>w}` was two attributes - `k="v"` and a boolean `w` - where
      // `{k=v<SOH>w}` was one attribute whose value held the control.
      readsTheSame('{k=v@w}\np\n', carveToHtml)
      readsTheSame('{k=v@w}\np\n', carveToCarve)
    })

    it('a value that IS one control character is a value', () => {
      // The separator run has three producers and the row above only reaches
      // the one that PARSES. This shape reaches the two that VALIDATE: under
      // `\S+` the `key=value` alternative could take no value at all here, so
      // `{k=<VT>}` was an invalid attribute block whose braces stayed on the
      // page, while `{k=<SOH>}` set the attribute.
      readsTheSame('{k=@}\np\n', carveToHtml)
      expect(carveToHtml(at('{k=@}\np\n', VT))).toContain('<p k=')
    })

    it('...and the fast path agrees with the regex it stands in for', () => {
      // The THIRD producer: `spanAttrProvablyInvalid` short-circuits an inline
      // span's payload so RE_SPAN_TAIL does not rescan at every `[`. It is
      // only allowed to say NO where the regex would, and with `/\s/` it said
      // no to `[x]{k=<VT>}` - a payload the regex accepts - so the span stayed
      // literal while `[x]{k=<SOH>}` became a `<span>`. A fast path that
      // disagrees with the slow one is the shape this clause is about.
      readsTheSame('[x]{k=@}\n', carveToHtml)
      expect(carveToHtml(at('[x]{k=@}\n', VT))).toContain('<span k=')
    })
  })

  describe('a label and an id are bounded by whitespace', () => {
    it('a footnote label keeps a control character', () => {
      readsTheSame('[^@f]: d\n\nx[^@f]\n', carveToCarve)
    })

    it('a cross-reference id ends at whitespace, not at the host class', () => {
      // The id is spelled by TWO producers - the parser's `RE_CROSSREF` and
      // the Markdown writer's unresolved-crossref scan - and both read
      // `[^>\s]`. A reference whose id held a vertical tab resolved in one and
      // not the other.
      readsTheSame('# H {#a@b}\n\n</#a@b>\n', carveToHtml)
    })

    it('a block comment opener tail of one control is a non-empty tail', () => {
      readsTheSame('%%%@\nbody\n%%%\n\np\n', carveToCarve)
    })
  })

  describe('an inline gate reads content as content', () => {
    it('bold-italic opens and closes around a control character', () => {
      // The gates required a non-`\s` character after `/*` and before `*/`, so
      // `/*<VT>a*/` was not bold-italic and `/*<SOH>a*/` was.
      readsTheSame('x /*@a*/ y\n', carveToHtml)
      readsTheSame('x /*a@*/ y\n', carveToHtml)
    })

    it('an unclosed code span keeps its trailing control character', () => {
      readsTheSame('x `code@\n', carveToHtml)
      readsTheSame('x `code@\n', carveToCarve)
    })
  })

  describe('the canonical writer spells the same class', () => {
    it('an info token ends at whitespace', () => {
      // Reached from a TREE, not from source: the parser's info-string class
      // already refuses a control character, so the only way into
      // `escapeFenceToken` with one is an ingested or hand-built AST - which
      // `fromAstJson` accepts from the other engines. It split on `\s`, so a
      // language name was truncated at a vertical tab and survived around any
      // other control character.
      const doc = (lang: string): Document => ({
        type: 'document',
        children: [{ type: 'code_block', lang, content: 'x\n' } as BlockNode],
      })
      expect(renderCarve(doc(`js${VT}x`))).toContain(`js${VT}x`)
      expect(renderCarve(doc(`js${FF}x`))).toContain(`js${FF}x`)
      expect(renderCarve(doc(`js${SOH}x`))).toContain(`js${SOH}x`)
    })
  })

  describe('what is deliberately NOT narrowed', () => {
    it('a link destination still ends at UNICODE whitespace', () => {
      // PART 3 marks `unicode_url_char` WHITESPACE HERE IS UNICODE WHITESPACE,
      // and U+000B and U+000C are in the White_Space property. So a block
      // image whose destination holds one is NOT an image, while the same
      // destination holding U+0001 is. This row is the marked exception, and
      // it is asserted so a later sweep does not "finish the job" by removing
      // a distinction the grammar writes down.
      expect(carveToHtml(at('![alt](/u@v)\n', VT))).not.toContain('<img')
      expect(carveToHtml(at('![alt](/u@v)\n', FF))).not.toContain('<img')
      expect(carveToHtml(at('![alt](/u@v)\n', SOH))).toContain('<img')
    })

    it('a quote after a NO-BREAK SPACE still opens', () => {
      // Quote flanking picks a GLYPH for a character that is already content;
      // it decides no construct and bounds no content, so it is not a
      // whitespace slot in PART 7's sense (the distinction PART 9 §29 draws
      // between what the language READS and what a target then does). A
      // no-break space is a space to the reader, and the escaped spelling
      // (`\ `) has always opened here. What came out of the class is the rest
      // of the host's `\s`.
      expect(carveToHtml(at('a@"x"\n', NBSP))).toBe('<p>a&nbsp;“x”</p>')
      expect(carveToHtml('a\\ "x"\n')).toBe('<p>a&nbsp;“x”</p>')
      // ...and a quote after a vertical tab closes, exactly as one after a
      // letter or after U+0001 does.
      readsTheSame('a@"q"\n', carveToHtml)
    })
  })
})
