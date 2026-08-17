import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

/*
 * The definition prepass models containers per line and had NO NOTION OF ONE
 * ENDING. Every tracker it opened - a code fence, a `:::` depth entry, a verse
 * region - stayed open for the rest of the document once the container that
 * held it was gone, while the block parser left the container and read the
 * following lines afresh.
 *
 * Each tracker turned that into its own silent failure, and all of them end the
 * same way: a definition written perfectly well OUTSIDE the container stops
 * resolving, with no diagnostic.
 *
 *   - THE FENCE (markup-carve/carve-js#1135). An unterminated fence has no
 *     closer, so the rest of the document was its body and nothing in it was
 *     collected.
 *   - THE DEPTH STACK (markup-carve/carve-js#1139). A quoted `> :::` pushed and
 *     nothing popped, so the stack stayed non-empty and the abbreviation
 *     branch - which recognizes a definition only at document level, PART 12 §7
 *     - declined everything below it.
 *   - THE VERSE REGION, the same shape in the third tracker, found by widening
 *     the probe past both reports.
 *
 * ONE RECORD AND ONE TEST now serve all three: where the tracker was opened,
 * and whether the line still reaches there. Spelling it three times is what let
 * the fence acquire a container test while the other two never got one.
 *
 * Rows are measured against the executable spec oracle at the pinned corpus,
 * carve-rs 1ad93f0 and carve-php 4610ef8, both built from origin/main. Where an
 * engine disagrees the row says so - carve-rs renders some of these definitions
 * as visible paragraphs rather than collecting them, so this is nowhere a case
 * of two engines against one.
 *
 * The assertions are POSITIVE - a real `href`, a real `<abbr>` - so a prepass
 * that collected nothing at all could not pass them.
 */

const B = '```'
const T = '~~~'
const R = '```=html'
const html = (source: string) => carveToHtml(source).replace(/\s+/g, ' ').trim()

describe('a fence ends with the container that holds it', () => {
  it('a quoted fence does not swallow the definition below the quote', () => {
    // The reported shape. The oracle and carve-php agree; carve-rs renders
    // `[r]: /url` as a visible paragraph, which is wrong in its own direction.
    const source = `> ${B}\n\n[r]: /url\n\n[r][]\n`

    expect(html(source)).toBe(
      '<blockquote> <pre><code> </code></pre> </blockquote> <p><a href="/url">r</a></p>',
    )
  })

  it('nor the abbreviation, through a div closer as well', () => {
    const source = `:::\n> ${B}\n:::\n\n*[A]: expansion\n\nA here\n`

    expect(html(source)).toBe(
      '<div> <blockquote> <pre><code> </code></pre> </blockquote> </div> ' +
        '<p><abbr title="expansion">A</abbr> here</p>',
    )
  })

  it('every container spelling, and every fence spelling', () => {
    // Widening the probe past the reported quote-and-list forms found the same
    // failure in fifteen container spellings and all three fence openers - the
    // `=FORMAT` raw fence included, which is a separate opener pattern in this
    // pass and was equally affected.
    const containers = [
      (f: string) => `> ${f}\n`,
      (f: string) => `> > ${f}\n`,
      (f: string) => `- ${f}\n`,
      (f: string) => `* ${f}\n`,
      (f: string) => `1. ${f}\n`,
      (f: string) => `1) ${f}\n`,
      (f: string) => `> - ${f}\n`,
      (f: string) => `- > ${f}\n`,
      (f: string) => `- - ${f}\n`,
      (f: string) => `- a\n  ${f}\n`,
      (f: string) => `:::\n> ${f}\n:::\n`,
      (f: string) => `:::\n- ${f}\n:::\n`,
      (f: string) => `> :::\n> ${f}\n> :::\n`,
      (f: string) => `[^n]: note\n  ${f}\n`,
      (f: string) => `:: term\n:  ${f}\n`,
    ]
    for (const container of containers) {
      for (const fence of [B, T, R]) {
        expect(html(`${container(fence)}\n[r]: /url\n\n[r][]\n`)).toContain('href="/url"')
      }
    }
  })

  it('a fence ON A MARKER LINE ends with that item, not with the document', () => {
    // The row the reordering turns on: the content-column stack used to be
    // maintained under a guard that skipped every line an open fence held, so
    // the line that ENDS the fence was skipped too and the stack still held the
    // item's column. A definition on that very line then read as below the
    // column and was rejected - the fix surviving its own repair.
    expect(html(`- ${B}\n\n[r]: /url\n\n[r][]\n`)).toBe(
      '<ul> <li> <pre><code> </code></pre> </li> </ul> <p><a href="/url">r</a></p>',
    )
    for (const marker of ['*', '1.', '1)', '- -']) {
      expect(html(`${marker} ${B}\n\n[r]: /url\n\n[r][]\n`)).toContain('href="/url"')
    }
  })

  it('a DIV closer ends it, which no quote depth and no column can see', () => {
    // A div adds no per-line prefix and no content column, so a fence inside
    // one is held by every other test and outlived the div too. Its closer is
    // the div's own: a bare colon run of the width that was open when the fence
    // opened.
    expect(html(`:::\n${B}\n:::\n\n[r]: /url\n\n[r][]\n`)).toContain('href="/url"')
    expect(html(`::::\n${B}\n::::\n\n[r]: /url\n\n[r][]\n`)).toContain('href="/url"')
  })

  it('CONTROL: a colon run that is not the enclosing div closer stays fence content', () => {
    // THE REFERENCE SITS ABOVE THE CONSTRUCT, and it has to. Written below,
    // both it and the definition land inside the same unterminated code block,
    // so the document renders identically whether the pass collected or not -
    // a check that cannot fail, and the first cut of this row was one.
    // Resolution is order-independent (§6), so a reference above sees a
    // definition wrongly collected from inside the fence.
    //
    // A run NARROWER than the div that was open, and one with trailing text.
    // The block parser reads both as code and so must this pass.
    expect(html(`[r][]\n\n::::\n${B}\n:::\n\n[r]: /url\n`)).not.toContain('href="/url"')
    expect(html(`[r][]\n\n:::\n${B}\n::: note\n\n[r]: /url\n`)).not.toContain('href="/url"')
    // And with no div open at all, a `:::` is just a line of code.
    expect(html(`[r][]\n\n${B}\n:::\n\n[r]: /url\n`)).not.toContain('href="/url"')
    // The positive half of the same rule, in the same arrangement: an EXACT
    // match is the enclosing div's closer, and the fence ends there.
    expect(html(`[r][]\n\n:::\n${B}\n:::\n\n[r]: /url\n`)).toContain('href="/url"')
  })

  it('CONTROL: a line the container DOES hold is still verbatim', () => {
    // The row that keeps the fix from becoming "the fence never holds
    // anything". A quoted `:::` inside a quoted fence is fence content and must
    // not move the depth stack; an indented definition inside an item's fence
    // is a code sample.
    expect(html(`> ${B}\n> :::\n> ${B}\n\n*[A]: expansion\n\nA here\n`)).toContain(
      '<abbr title="expansion">A</abbr>',
    )
    expect(html(`- ${B}\n  [r]: /url\n  ${B}\n\n[r][]\n`)).not.toContain('href="/url"')
    expect(html(`:: t\n:  ${B}\n   [r]: /url\n   ${B}\n\n[r][]\n`)).not.toContain('href="/url"')
  })

  it('CONTROL: a fence that DOES close is opaque past the div closer', () => {
    // Only an unterminated fence degrades at its container's boundary. With a
    // closer ahead the fence is opaque all the way to it, so a same-width
    // `:::` written inside the sample is CODE - the block parser renders it -
    // and ending the fence there collected the definitions below it out of a
    // visible `<pre>` (raised by codex review).
    const source = `[r][]\n\n:::\n${T}\n:::\n[r]: /url\n${T}\n:::\n`

    expect(html(source)).not.toContain('href="/url"')
    expect(html(source)).toContain('<pre><code>::: [r]: /url </code></pre>')
    // The same document with NO closer really does degrade, which is the row
    // this one is the boundary of.
    expect(html(`[r][]\n\n:::\n${T}\n:::\n[r]: /url\n:::\n`)).toContain('href="/url"')
  })

  it('CONTROL: the div closer follows the parser whitespace rule, not `trim`', () => {
    // A no-break space is CONTENT, not trailing whitespace (PART 7), so
    // `:::` + U+00A0 is an ordinary line the parser keeps inside the sample.
    // `trim()` ate it and read the line as the div's closer (raised by codex
    // review); the parser's own colon-closer pattern does not.
    // NO CLOSER AHEAD, which is what makes the row discriminating: with one,
    // the fence is opaque either way and the whitespace class never gets asked.
    const source = `[r][]\n\n:::\n${T}\n:::\u00a0\n[r]: /url\n:::\n`

    expect(html(source)).not.toContain('href="/url"')
    expect(html(source)).toContain('<pre><code>:::&nbsp; [r]: /url </code></pre>')
    // A trailing SPACE and a trailing TAB are trailing whitespace, and those
    // lines ARE the closer.
    for (const pad of [' ', '\t']) {
      expect(html(`[r][]\n\n:::\n${T}\n:::${pad}\n[r]: /url\n:::\n`)).toContain('href="/url"')
    }
  })

  it('CONTROL: an INDENTED colon run inside the body is code, not the div closer', () => {
    // Read on the fully stripped line, an indented `:::` written inside the
    // sample matched the enclosing div's width and ended the fence, so the
    // definition below it in the same sample went live - a reference resolving
    // against text the reader sees inside a `<pre>` (raised by codex review).
    // The closer is not indented past the fence's own base column.
    const source = `[r][]\n\n:::\n${B}\n  :::\n[r]: /url\n:::\n`

    expect(html(source)).not.toContain('href="/url"')
    // And the whole sample really is code, which is what makes the row a defect
    // rather than a preference.
    expect(html(source)).toContain('<pre><code> ::: [r]: /url </code></pre>')
  })

  it('CONTROL: a fence behind BOTH a marker and a quote still holds its body', () => {
    // `- > ``` ` records the ITEM's content column, while the quote-prefix
    // pattern admits a leading indentation run - so `  > [r]: /url` lost that
    // indentation along with its `> ` and scored zero against a column of two.
    // The fence ended on its own first body line and the sample was collected
    // (raised by codex review).
    for (const source of [
      `[r][]\n\n- > ${B}\n  > [r]: /url\n  > ${B}\n`,
      `[r][]\n\n- > ${B}\n  > [r]: /url\n`,
      `[r][]\n\n> - ${B}\n>   [r]: /url\n>   ${B}\n`,
    ]) {
      expect(html(source)).not.toContain('href="/url"')
    }
  })

  it('CONTROL: a flush colon fence ends the item, so its scope is not the item', () => {
    // A flush `:::` under an unblanked item opens a SIBLING container - the
    // parser renders the div next to the list, not inside it. Recording the
    // item's content column on it made the scope release at the next blank
    // line, and an abbreviation written INSIDE a visibly rendered div then
    // registered and expanded, inside its own definition text (raised by codex
    // review).
    expect(html('- item\n:::\n\n*[A]: expansion\n\nA\n:::\n')).toBe(
      '<ul> <li>item</li> </ul> <div> <p>*[A]: expansion</p> <p>A</p> </div>',
    )
    // The verse tracker records a scope the same way and had the same hole.
    expect(html('- item\n::: |\n\n[r]: /url\n\n[r][]\n:::\n')).not.toContain('href="/url"')
  })

  it('CONTROL: a MALFORMED colon line decides nothing about a fence or an item', () => {
    // `:::note` is prose - the parser renders it as a paragraph - but this
    // pass's depth tracker takes any run of three colons, so a phantom level
    // sat on the stack. Two decisions had to stop reading it (both raised by
    // codex review): which width a fence takes as its enclosing div's closer,
    // and whether a flush colon line ends an open item.
    //
    // Left alone, the phantom level let a `:::` inside a code sample end the
    // fence and publish the sample's definition.
    expect(html(`[r][]\n\n:::note\n\n${B}\n:::\n[r]: /url\n`)).not.toContain('href="/url"')
    // And popped a column the parser keeps, so the definition folded into the
    // item was rejected as top-level indentation.
    expect(html('-   item\n  :::note\n    [r]: /url\n\n[r][]\n')).toContain('href="/url"')
    // The line really is prose in both.
    expect(html(':::note\n')).toBe('<p>:::note</p>')
  })

  it("CONTROL: a description's body column is §16's own, not the separator's width", () => {
    // A wider `:   ` still puts the body at column three, so measuring the
    // marker made a canonical body line look dedented and ended the fence on it
    // (raised by codex review).
    const source = `:: term\n:   ${B}\n   :::\n   ${B}\n\n*[A]: expansion\n\nA here\n`

    expect(html(source)).toContain('<abbr title="expansion">A</abbr>')
  })

  it('CONTROL: reach is measured in VISUAL COLUMNS, so a tab is worth up to four', () => {
    // A tab-indented body line reaches column four, past a description's column
    // of three. Counted as one character it looked dedented, ended the fence,
    // and published the definition the renderer keeps inside the `<pre>`
    // (raised by codex review).
    const source = `[r][]\n\n:: term\n:  ${B}\n\t- [r]: /url\n`

    expect(html(source)).not.toContain('href="/url"')
    expect(html(source)).toContain('<pre><code> - [r]: /url </code></pre>')
  })

  it('CONTROL: a blank line is transparent to a column but ends a quote', () => {
    // Both halves are the block parser's. A blank line inside an item's fence
    // is code; a blank line ends the quote, and with it the fence.
    expect(html(`- ${B}\n\n  [r]: /url\n  ${B}\n\n[r][]\n`)).not.toContain('href="/url"')
    expect(html(`> ${B}\n\n[r]: /url\n\n[r][]\n`)).toContain('href="/url"')
  })
})

describe('the depth stack and the verse region end with their container too', () => {
  it('a one-line quoted div opener releases the abbreviation below it', () => {
    // The reported shape of markup-carve/carve-js#1139, and the whole document
    // is three constructs long. Both the oracle and this engine's own renderer
    // put the div INSIDE the quote and close it at the end of the quote; only
    // the prepass thought it was still open three lines later.
    const source = '> :::\n\n*[A]: expansion\n\nA here\n'

    expect(html(source)).toBe(
      '<blockquote> <div> </div> </blockquote> <p><abbr title="expansion">A</abbr> here</p>',
    )
  })

  it('a fence at quote depth two exposes an opener at depth one', () => {
    // The shape the review found it through. The `> :::` has left the inner
    // quote, so it is a real opener at depth one, and it too must not outlive
    // the outer quote.
    const source = `> > ${T}\n> :::\n> ${T}\n\n*[A]: expansion\n\nA here\n`

    expect(html(source)).toContain('<abbr title="expansion">A</abbr>')
  })

  it('every container spelling of a bare opener', () => {
    for (const pre of [
      '> :::\n',
      '> > :::\n',
      '> - :::\n',
      '- > :::\n',
      '- a\n  :::\n',
      '> :::\ntext\n',
      '> ::: |\n',
      '- a\n  ::: |\n',
      // ON THE MARKER LINE, which is the row the recorded COLUMN turns on: the
      // marker is stripped before the opener is matched, so the line's own
      // indent is zero and recording that would put the opener back at document
      // level, where it holds every line again. The enclosing content column is
      // what it belongs to.
      //
      // These three diverge from the executable spec, which reads the whole
      // document as one list item and opens no div at all. That divergence is
      // in the BLOCK structure and predates this change - carve-js, carve-rs
      // 1ad93f0 and carve-php 4610ef8 all put a `<div>` inside the item, and
      // after this change all three also agree on the abbreviation, byte for
      // byte. Before it, carve-js dropped the abbreviation alone.
      '- :::\n',
      '1. :::\n',
      '- ::: |\n',
    ]) {
      expect(html(`${pre}\n*[A]: expansion\n\nA here\n`)).toContain(
        '<abbr title="expansion">A</abbr>',
      )
    }
  })

  it('CONTROL: a document-level div really does hold the definition below it', () => {
    // The boundary that must not move. An unclosed `:::` at document level
    // reaches the end of the document, so the definition inside it is not at
    // document level and defines nothing - it renders as the text the author
    // typed, which is PART 12 §7's own answer.
    const source = ':::\n\n*[A]: expansion\n\nA here\n'

    expect(html(source)).toBe('<div> <p>*[A]: expansion</p> <p>A here</p> </div>')
  })

  it('CONTROL: a doc-level verse region still hides what is written in it', () => {
    expect(html(`::: |\n\n[r]: /url\n\n[r][]\n`)).not.toContain('href="/url"')
  })

  it('CONTROL: a closed quoted div leaves the stack where it found it', () => {
    expect(html('> :::\n> :::\n\n*[A]: expansion\n\nA here\n')).toContain(
      '<abbr title="expansion">A</abbr>',
    )
  })
})
