import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'
import type { CarveExtension } from '../src/extension.js'

/*
 * A bare fence delimiter on a line that CONTINUES AN OPEN PARAGRAPH is not a
 * fence. §10 I4 is the rule: a verbatim fence interrupts an open paragraph only
 * with a closer ahead, and without one the run is an inline verbatim span
 * inside the paragraph it continues.
 *
 * This engine's BLOCK PARSER already got that right - every expectation below
 * opens with the delimiter rendered as an inline `<code></code>` inside the
 * paragraph. The DEFINITION PREPASS did not: it opened a fence on the line, and
 * an unterminated fence has no closer, so it took the rest of the document as
 * its body and collected nothing from it. Every definition below the line
 * silently stopped resolving (markup-carve/carve-js#1136).
 *
 * The disagreement was therefore INTERNAL, between two passes over the same
 * document in the same engine - which is what settles it, not a count of
 * engines. The executable spec oracle and carve-rs 1ad93f0 agree with the block
 * parser on every row here; carve-php 4610ef8 still swallows them, holding the
 * same contradiction, and is reported separately.
 *
 * The assertions are POSITIVE - a real `href`, a real `<abbr>` - so a prepass
 * that collected nothing at all could not pass them.
 */

const B = '```'
const T = '~~~'
const R = '```=html'
const html = (source: string) => carveToHtml(source).replace(/\s+/g, ' ').trim()

describe('a fence delimiter continuing a paragraph opens no fence in the prepass', () => {
  it('collects the link reference below it', () => {
    const source = `text\n${B}\n\n[r]: /url\n\n[r][]\n`

    expect(html(source)).toBe('<p>text <code></code></p> <p><a href="/url">r</a></p>')
  })

  it('collects the abbreviation below it', () => {
    // The reported shape. An abbreviation is the definition kind with no marker
    // at the use site pointing back, so a dropped one is invisible twice over.
    const source = `text\n${B}\n\n*[A]: expansion\n\nA here\n`

    expect(html(source)).toBe(
      '<p>text <code></code></p> <p><abbr title="expansion">A</abbr> here</p>',
    )
  })

  it('reads the tilde and the =FORMAT spellings the same way', () => {
    // Found by widening the probe past the reported backtick form. The prepass
    // opens a region on all three openers, so all three drop the definition.
    for (const fence of [T, R]) {
      expect(html(`text\n${fence}\n\n[r]: /url\n\n[r][]\n`)).toContain('href="/url"')
    }
  })

  it('holds when the paragraph runs over several lines', () => {
    expect(html(`text\nmore\n${B}\n\n[r]: /url\n\n[r][]\n`)).toContain('href="/url"')
  })

  it('holds for a SECOND delimiter on the line after the first', () => {
    // The first delimiter is paragraph text, so the paragraph is still open on
    // the line below it and the second one is text too - which the pass knows
    // outright, without re-deriving it. Two different spellings, because a
    // repeated one closes its own predecessor.
    const source = `text\n${B}\n${T}\n\n[r]: /url\n\n[r][]\n`

    expect(html(source)).toBe('<p>text <code> ~~~</code></p> <p><a href="/url">r</a></p>')
  })

  it('holds when the paragraph continues past the delimiter', () => {
    expect(html(`text\n${B}\ntail\n\n[r]: /url\n\n[r][]\n`)).toContain('href="/url"')
  })

  it('holds inside a quote and inside a list item', () => {
    // The paragraph the delimiter continues does not have to be at document
    // level. Widening the probe found both, and both dropped the definition.
    expect(html(`> text\n> ${B}\n\n[r]: /url\n\n[r][]\n`)).toContain('href="/url"')
    expect(html(`- text\n  ${B}\n\n[r]: /url\n\n[r][]\n`)).toContain('href="/url"')
  })

  it('holds on a LAZY continuation out of a quote or an item', () => {
    // The worst of the widened rows, because nothing about the delimiter line
    // says it is inside anything: it sits at column 0 and lazily continues the
    // paragraph above it. The block parser folds it in - see the `<code>` in
    // the item and in the quote - and the prepass opened a document-level fence
    // on the very same line.
    expect(html(`- a\n${B}\n\n[r]: /url\n\n[r][]\n`)).toBe(
      '<ul> <li>a <code></code></li> </ul> <p><a href="/url">r</a></p>',
    )
    expect(html(`> q\n${B}\n\n[r]: /url\n\n[r][]\n`)).toBe(
      '<blockquote><p>q <code></code></p></blockquote> <p><a href="/url">r</a></p>',
    )
  })
})

describe('the boundaries the fix must not move', () => {
  it('a delimiter with a CLOSER ahead does interrupt, and its body stays a sample', () => {
    // The other half of §10 I4, and the reason "a paragraph is open" cannot be
    // the whole test. Suppressing every opener under an open paragraph would
    // leave this fence unopened and collect the definition written INSIDE the
    // code sample - a reference resolving against text the reader sees as code.
    const source = `text\n${B}\n[r]: /url\n${B}\n\n[r][]\n`

    expect(html(source)).toBe('<p>text</p> <pre><code>[r]: /url </code></pre> <p>[r][]</p>')
    // Every fence spelling, since the closer lookahead is shared.
    for (const [open, close] of [
      [T, T],
      [R, B],
    ]) {
      expect(html(`text\n${open}\n[r]: /url\n${close}\n\n[r][]\n`)).not.toContain('href="/url"')
    }
    // And through a container prefix, which the prepass's closer view has to
    // see past - a closer index anchored after indentation alone reads `> ``` `
    // as no closer at all and would collect this one.
    expect(html(`> text\n> ${B}\n> [r]: /url\n> ${B}\n\n[r][]\n`)).not.toContain('href="/url"')
    expect(html(`- text\n  ${B}\n  [r]: /url\n  ${B}\n\n[r][]\n`)).not.toContain('href="/url"')
  })

  it('a delimiter after a BLANK line opens a fence and swallows the definition', () => {
    const source = `text\n\n${B}\n\n[r]: /url\n\n[r][]\n`

    expect(html(source)).toBe('<p>text</p> <pre><code> [r]: /url [r][] </code></pre>')
  })

  it('a delimiter after a HEADING opens a fence, which a blank-line test would reject', () => {
    // The state is "is a paragraph open", not "was the previous line blank".
    expect(html(`# h\n${B}\n\n[r]: /url\n\n[r][]\n`)).not.toContain('href="/url"')
  })

  it('an INVISIBLE block opener leaves no paragraph open, so the fence still opens', () => {
    // THE USE SITE SITS ABOVE THE CONSTRUCT ON PURPOSE. Written below it, the
    // reference is swallowed by the same code block as the definition, and the
    // document renders identically whether the prepass collected or not - a
    // check that cannot fail. Resolution is order-independent (§6), so a
    // reference above the fence sees a definition the prepass wrongly collected
    // from inside it, and only that arrangement can tell the two apart.
    //
    // Each `pre` below renders nothing at all, so no paragraph continues across
    // it. `lineOpensBlock` already knows the link and footnote forms; the
    // document-level abbreviation is the one it leaves out, because its other
    // caller is never at document level.
    for (const pre of [
      '*[Q]: q\n',
      '[q]: /q\n',
      '[^q]: q\n',
      // Raised by codex review, and both are real: `lineOpensBlock` carries the
      // `%%%` BLOCK comment and not the `%%` line form, and knows nothing about
      // a standalone block-attribute line at all.
      '%% c\n',
      '  %% c\n',
      '{.x}\n',
      '{#y}\n',
      '{.x}\n{#y}\n',
      'text\n{.x}\n',
      // The same two seen through a container prefix, which the prepass strips
      // before it asks.
      '> {.x}\n',
      '- %% c\n',
      '- {.x}\n',
    ]) {
      expect(html(`[r][]\n\n${pre}${B}\n\n[r]: /url\n`)).not.toContain('href="/url"')
    }
  })

  it('a FLUSH delimiter has left a footnote body, whose paragraph it does not continue', () => {
    // A footnote body's content column is §16's own, so a column-0 line is out
    // of the body and the fence below it opens with no closer - unlike a list
    // item, two rows above, whose paragraph a flush line really does continue.
    // The prepass reads the body's lines with their indentation stripped, so
    // the two look alike here and the difference has to be stated (raised by
    // codex review).
    const source = `[r][]\n\n[^f]: note\n  continuation\n${B}\n\n[r]: /url\n`

    expect(html(source)).not.toContain('href="/url"')
  })

  it('a `+` ATTACHES the fence below it, which then opens with no closer', () => {
    // §17 L3/L4. The attached fence is a block of the item, and the definition
    // written inside it is a code sample.
    expect(html(`[r][]\n\n- a\n+\n${B}\n[r]: /url\n`)).not.toContain('href="/url"')
    expect(html(`[r][]\n\n- a\n\n+\n${B}\n[r]: /url\n`)).not.toContain('href="/url"')
  })

  it('an abbreviation ENDS the list above it, so the fence below opens', () => {
    // This pass still holds the item's content column here while the block
    // parser has already closed the item at the flush definition, so gating the
    // abbreviation on "document level" answered no on a line the parser reads
    // as a definition (raised by codex review).
    const source = `[r][]\n\n- # h\n*[Q]: q\n${B}\n\n[r]: /url\n`

    expect(html(source)).not.toContain('href="/url"')
  })

  it('a table row, a `:::` opener and a `>` with no content open a block', () => {
    // Same arrangement, same reason. The bare `>` is the row that pins the
    // empty-container arm: the raw line is not blank, so the blank test above
    // misses it, and its stripped form is the empty string.
    for (const pre of ['| a | b |\n', ':::\n:::\n', '>\n']) {
      expect(html(`[r][]\n\n${pre}${B}\n\n[r]: /url\n`)).not.toContain('href="/url"')
    }
  })

  it('a table CONTINUATION row belongs to the table, not to a paragraph', () => {
    // `parseTable` consumes `+ ... |` itself, so the row reaches no dispatcher
    // entry and `lineOpensBlock` has no reason to carry it - which left a
    // paragraph open over a table and suppressed the fence below it (raised by
    // codex review).
    for (const pre of ['| a |\n+ b |\n', '| a |\n| b |\n+ c |\n']) {
      expect(html(`[r][]\n\n${pre}${B}\n\n[r]: /url\n`)).not.toContain('href="/url"')
    }
  })

  it('a MULTI-LINE block-attribute run is invisible on every one of its lines', () => {
    // Only the first line carries the brace, so without the run being tracked
    // the continuation read as prose and reopened a paragraph over a construct
    // the block parser consumes whole (raised by codex review).
    for (const pre of ['{.a\n.b}\n', '{.a\n.b\n.c}\n', '{#i\n.c}\n']) {
      expect(html(`[r][]\n\n${pre}${B}\n[r]: /url\n`)).not.toContain('href="/url"')
      expect(html(`[r][]\n\n${pre}${B}\n\n[r]: /url\n`)).not.toContain('href="/url"')
    }
  })

  it('a registered BLOCK MATCHER turns the paragraph state off entirely', () => {
    // An extension may claim any line at a block boundary, and a claimed line
    // is prose to every line-shape test this pass can run - so it would keep a
    // paragraph open over a real fence and collect the definitions inside it.
    // The pass falls back to its pre-carve-js#1136 behavior instead: the fence
    // opens, and nothing written inside a code sample goes live.
    const banner: CarveExtension = {
      name: 'banner',
      matchBlock(lines, start) {
        const line = lines[start]
        if (!line || !line.startsWith('^^^ ')) return null

        return {
          node: { type: 'paragraph', children: [{ type: 'text', value: `BANNER:${line.slice(4)}` }] },
          linesConsumed: 1,
        }
      },
    }
    const source = `[r][]\n\n^^^ x\n${B}\n[r]: /url\n`

    expect(carveToHtml(source, { extensions: [banner] })).not.toContain('href="/url"')
    // CONTROL: with no extension registered the same line is ordinary prose, a
    // paragraph really is open, and the fix applies as everywhere else.
    expect(html(source)).toContain('href="/url"')
  })
})
