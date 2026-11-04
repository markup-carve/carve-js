import { describe, it, expect } from 'vitest'
import { carveToHtml, carveToCarve, parse } from '../src/index.js'
import { renderCarve } from '../src/render-carve.js'
import type { BlockNode, Document, InlineNode } from '../src/ast.js'

/**
 * ONE WHITESPACE DEFINITION, IN EVERY CONSTRUCT (markup-carve/carve#977, PART
 * 7; the ruling on markup-carve/carve#963).
 *
 * Carve's whitespace is FOUR CHARACTERS - U+0020, U+0009, U+000A, U+000D - and
 * EVERY OTHER CHARACTER IS CONTENT. The clause names the two an implementation
 * is likeliest to admit by accident so their absence cannot be read as an
 * oversight:
 *
 *   VERTICAL TAB (U+000B) is CONTENT.
 *   FORM FEED     (U+000C) is CONTENT.
 *
 * WHAT WENT WRONG HERE WAS NOT A WIDER CLASS CHOSEN ON PURPOSE. Every
 * divergent site read the HOST LANGUAGE'S class - a native `.trim()`, a regex
 * `\\s`, or `\\s` with one character carved back out - and each carve-out had
 * been added by its own earlier bug (NBSP, then U+FEFF). A class defined by
 * subtraction from `\\s` can never reach the characters nobody has filed a bug
 * about yet, which is why U+000B and U+000C survived every previous narrowing
 * and why the clause replaces the subtraction with four named characters.
 *
 * THE CHARACTERS ARE BUILT FROM ESCAPES, never typed literally. A literal
 * U+000B does not survive every file write, and a test that lost one asserts
 * nothing while looking like it asserts everything - it reports an engine
 * mishandling a character it never received. Each is checked by code point
 * before it is used.
 */

const VT = '\u000B'
const FF = '\u000C'
const OGHAM = '\u1680'

describe('Carve whitespace is four characters', () => {
  it('has the probe characters it thinks it has', () => {
    // The guard for the failure mode above. Everything below is meaningless
    // without it.
    expect(VT.charCodeAt(0)).toBe(0x0b)
    expect(FF.charCodeAt(0)).toBe(0x0c)
    expect(VT).toHaveLength(1)
    expect(FF).toHaveLength(1)
  })

  describe('MARKER REQUIRES CONTENT is satisfied by one', () => {
    it('a heading whose only content is a form feed is a heading', () => {
      // The heading's content lookahead read `[ \t\f]*[^ \t\n\r\f]`, so a
      // form feed was not content here while a vertical tab was - two answers
      // from one class, for two characters the grammar does not distinguish.
      expect(carveToHtml(`# ${FF}` + '\n')).toContain('<h1>')
      expect(carveToHtml(`# ${VT}` + '\n')).toContain('<h1>')
    })

    it('a caption whose only content is a form feed is a caption', () => {
      // Two spellings of the same rule, and each has its own class. A caption
      // under a TABLE or a FENCE is recognized by `RE_CAPTION`; a caption
      // folded into a block image's paragraph is recognized by
      // `RE_HAS_CONTENT` in the resolver. Both read `[^ \t\n\r\f]`, and a
      // document that exercises only one of them leaves the other free to
      // drift - which is how the two came to disagree in the first place.
      expect(carveToHtml(`| a |\n^ ${FF}\n`)).toContain(`<caption>${FF}</caption>`)
      expect(carveToHtml('```\nx\n```\n^ ' + FF + '\n')).toContain(`<figcaption>${FF}</figcaption>`)
      expect(carveToHtml(`![a](i.png)\n^ ${FF}\n`)).toContain(`<figcaption>${FF}</figcaption>`)
      expect(carveToHtml(`![a](i.png)\n^ ${VT}\n`)).toContain(`<figcaption>${VT}</figcaption>`)
    })

    it('a bullet whose only content is a vertical tab is a list item', () => {
      expect(carveToHtml(`- ${VT}` + '\n').trim()).toBe(`<ul>\n  <li>${VT}</li>\n</ul>`)
    })

    it('an inline footnote holding one is a footnote, not literal text', () => {
      // The emptiness test was `\s` minus NBSP, so `^[<NBSP>]` was a footnote
      // and `^[<VT>]` was literal text.
      expect(carveToHtml(`t^[${VT}]` + '\n')).toContain('doc-noteref')
      expect(carveToHtml(`t^[${FF}]` + '\n')).toContain('doc-noteref')
    })

    it('CONTROL: a truly empty or space-only one is still literal text', () => {
      expect(carveToHtml('t^[]\n').trim()).toBe('<p>t^[]</p>')
      expect(carveToHtml('t^[ ]\n').trim()).toBe('<p>t^[ ]</p>')
    })
  })

  describe('it is not indentation', () => {
    it('a vertical tab before a bullet leaves a paragraph', () => {
      // The marker regexes read `\s` minus NBSP minus U+FEFF for the indent,
      // so this was a LIST and `carve fmt` wrote the character away entirely.
      expect(carveToHtml(`${VT}- a` + '\n').trim()).toBe(`<p>${VT}- a</p>`)
      expect(carveToCarve(`${VT}- a` + '\n')).toContain(VT)
    })

    it('a form feed and an OGHAM SPACE MARK do the same', () => {
      expect(carveToHtml(`${FF}- a` + '\n').trim()).toBe(`<p>${FF}- a</p>`)
      expect(carveToHtml(`${OGHAM}- a` + '\n').trim()).toBe(`<p>${OGHAM}- a</p>`)
    })

    it('CONTROL: a space and a tab still are indentation', () => {
      expect(carveToHtml(' - a\n').trim()).toBe('<ul>\n  <li>a</li>\n</ul>')
      expect(carveToHtml('\t- a\n').trim()).toBe('<ul>\n  <li>a</li>\n</ul>')
    })
  })

  describe('a line holding one is not blank', () => {
    it('a lone vertical-tab line keeps one paragraph', () => {
      expect(carveToHtml(`a\n${VT}\nb\n`).trim()).toBe(`<p>a\n${VT}\nb</p>`)
    })

    it('a quote line holding one holds a paragraph, so a lazy line folds', () => {
      // `isEmptyQuoteLine` asked with a native `.trim()`, so `- > <VT>` held
      // no paragraph and the line below it left the item.
      // The whole document, not a substring: with the wide class the quote
      // held no paragraph, `z` left the item, and a `<p>z</p>` SIBLING still
      // satisfies a `toContain('z</p>')`.
      expect(carveToHtml(`- > ${VT}\nz\n`).trim()).toBe(
        `<ul>\n  <li>\n    <blockquote><p>${VT}\nz</p></blockquote>\n  </li>\n</ul>`,
      )
    })

    it('CONTROL: a space-only line is blank and a bare quote holds nothing', () => {
      expect(carveToHtml('a\n \nb\n').trim()).toBe('<p>a</p>\n<p>b</p>')
      expect(carveToHtml('- >\nz\n')).toContain('<p>z</p>')
    })
  })

  describe('a verbatim span measures its padding in it', () => {
    it('strips the padding around a lone vertical tab', () => {
      // The all-space guard was a native `.trim()`, which called ` <VT> `
      // all-space and left the padding on the page.
      expect(carveToHtml('a ` ' + VT + ' ` b\n').trim()).toBe(`<p>a <code>${VT}</code> b</p>`)
      expect(carveToCarve('a ` ' + VT + ' ` b\n')).toBe('a `' + VT + '` b\n')
    })

    it('the WRITER pads by the same definition, on an AST source cannot reach', () => {
      // The writer's half of one reversible operation. A code span whose
      // content both begins and ends with a space is padded UNLESS the content
      // is entirely spaces - and that test read a native `.trim()`, which
      // called ` <VT> ` entirely spaces.
      //
      // Source cannot reach this node: the parser strips the padding on the
      // way in, so ` <VT> ` only ever arrives from a hand-built tree or an
      // AST-JSON ingest. That is exactly why the branch has to be pinned
      // directly - a document-level test cannot fail on it, which is how the
      // two halves came to spell one rule two ways.
      const doc: Document = {
        type: 'document',
        children: [
          {
            type: 'paragraph',
            children: [{ type: 'code', value: ` ${VT} ` } as InlineNode],
          } as BlockNode,
        ],
      }
      // Padded, so the parser's strip gives the content back. Written
      // UNPADDED - which is what a native `.trim()` decides here - the same
      // parser reads the content as a bare `${VT}` and the two spaces the AST
      // carried are gone.
      expect(renderCarve(doc)).toBe('`  ' + VT + '  `\n')
      expect(carveToHtml(renderCarve(doc)).trim()).toBe(`<p><code> ${VT} </code></p>`)
    })

    it('CONTROL: content that IS entirely spaces keeps its padding', () => {
      expect(carveToHtml('a `   ` b\n').trim()).toBe('<p>a <code>   </code> b</p>')
      expect(carveToCarve('a `   ` b\n')).toBe('a `   ` b\n')
    })
  })

  describe('a numbered caption label keys on it', () => {
    it('a label ending in a form feed is a different label', () => {
      // Both trims - the counter KEY and the crossref auto-text - read `\s+$`,
      // so `^ Figure<FF> #` and `^ Figure #` shared a counter and the second
      // figure came out "Figure 2" with no "Figure 1" beside it.
      const html = carveToHtml(
        `![a](i.png)\n^ Figure${FF} #\n\n![b](j.png)\n^ Figure #\n`,
      )
      expect(html).toContain(`Figure${FF} 1`)
      expect(html).toContain('Figure 1')
      expect(html).not.toContain('Figure 2')
    })

    it('CONTROL: two identical labels still share one counter', () => {
      const html = carveToHtml('![a](i.png)\n^ Figure #\n\n![b](j.png)\n^ Figure #\n')
      expect(html).toContain('Figure 1')
      expect(html).toContain('Figure 2')
    })
  })

  describe('a comment line separates with it', () => {
    it('keeps a vertical tab that follows the marker', () => {
      // The separator was `/^\s/`, so `%%<VT>note` lost the character and
      // `carve fmt` wrote a SPACE back in its place.
      expect(parse(`%%${VT}note` + '\n').children[0]).toMatchObject({
        type: 'comment',
        content: `${VT}note`,
      })
      // The writer normalizes the separator to one space, which is the
      // canonical form - so the assertion is that the CONTENT survives the
      // round trip, not that the bytes do.
      const written = carveToCarve(`%%${VT}note` + '\n')
      expect(written).toBe(`%% ${VT}note` + '\n')
      expect(parse(written).children[0]).toMatchObject({ content: `${VT}note` })
    })

    it('CONTROL: one space after the marker is still the separator', () => {
      expect(parse('%% note\n').children[0]).toMatchObject({ type: 'comment', content: 'note' })
    })
  })

  it('renders and round-trips every one of these unchanged', () => {
    for (const src of [
      `# h${VT}` + '\n',
      `p${FF}` + '\n',
      `${VT}- a` + '\n',
      `a\n${VT}\nb\n`,
      `t^[${VT}]` + '\n',
      `%%${VT}note` + '\n',
      `- ${VT}` + '\n',
    ]) {
      const written = carveToCarve(src)
      expect(carveToHtml(written)).toBe(carveToHtml(src))
      expect(carveToCarve(written)).toBe(written)
    }
  })
})
