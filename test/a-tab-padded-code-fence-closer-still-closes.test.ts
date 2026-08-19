import { describe, it, expect } from 'vitest'
import { carveToHtml, parse } from '../src/index.js'

/**
 * POSITION DECIDES, NOT THE CONSTRUCT (markup-carve/carve#1295, ruled
 * 2026-08-16). A tab BEFORE content is a separator and disqualifies the
 * construct; a tab at END OF LINE is trailing whitespace, PART 2 drops it, and
 * the construct works normally.
 *
 * A CLOSER TAKES NO CONTENT AFTER ITS MARKER, so a tab there can only ever be
 * trailing. The fence closes.
 *
 * This engine did not close it. The delimiter line was swallowed as content of
 * the block it should have ended, which is not a spelling of anything - the
 * `<pre>` rendered its own closing fence:
 *
 *   code_block.content === "x\n```\t"     before
 *   code_block.content === "x"            after, and in carve-php throughout
 *
 * WHY IT WAS NARROWED IN THE FIRST PLACE. carve#1285 ruled the tab out of the
 * fence's run, and this engine applied it through the doctrine that the opener
 * and the closer are ONE RUN SEEN FROM TWO ENDS (carve-js#805), narrowing both.
 * That doctrine is half right. The clause it came from governs a marker-to-
 * content SEPARATOR; it says nothing about a line ending, and a closer has no
 * content for a separator to stand before. carve#1295 states the split, so the
 * opener and the closer are now held apart on purpose - collapsing them again
 * in either direction reintroduces one of the two defects.
 *
 * THE CLOSER INDEX HAD TO WIDEN WITH THE MATCHER, and the asymmetry is the
 * reason: `RE_ANY_FENCE_CLOSER` only ever REFUTES. Too wide costs a wasted scan
 * and stays correct; too NARROW answers wrong, telling an opener no closer
 * exists when one is really there.
 *
 * That combination - matcher widened, index left narrow - survives every
 * ordinary row here, because the index gates two SIDE paths and not the fence
 * parse itself: the item-loosening pass and the attached scan. It has its own
 * row, on the document where it becomes visible as a list item loosening
 * around a blank line that is really inside the code.
 *
 * carve-php is the reference here and is the only engine that was already
 * correct. Every row was verified against carve-php `8a9dc5c`, built from
 * `origin/main`.
 *
 * THE SEPARATOR ROW IS THE ONE THAT REFUSES, and it is the only one.
 * `` ```<TAB>php `` has content after the tab, so the tab stands between marker
 * and info and cannot be `space`. Every other row - a trailing tab on an
 * opener, on an opener's info string, or on a closer - is trailing whitespace
 * and the fence works normally. All four rows of carve#1295's table are
 * asserted here.
 */

const F = '```'
const T = '\t'

/** The first code block's content, or null when the document has none. */
const codeContent = (src: string): string | null => {
  const cb = parse(src).children.find((n) => n.type === 'code_block')
  return cb ? ((cb as { content: string }).content ?? '') : null
}

describe('a tab-padded code fence closer still closes', () => {
  it('closes the fence and keeps the delimiter out of the content', () => {
    const src = `${F}\nx\n${F}${T}\n`
    expect(carveToHtml(src)).toBe('<pre><code>x\n</code></pre>')
    // The assertion the report was measured on. Checked as well as the HTML
    // because a renderer that merely hid the line would pass the HTML row.
    expect(codeContent(src)).toBe('x')
    expect(codeContent(src)).not.toContain(F)
    expect(codeContent(src)).not.toContain(T)
  })

  it('closes for both fence characters and any run length', () => {
    expect(codeContent(`~~~\nx\n~~~${T}\n`)).toBe('x')
    // A closer may be LONGER than its opener; the tab must not change that.
    expect(codeContent(`${F}\nx\n${F}${F}${T}\n`)).toBe('x')
    expect(codeContent(`${F}js\nx\n${F}${T}\n`)).toBe('x')
  })

  it('accepts any mix of trailing spaces and tabs', () => {
    // PART 2 drops the whole trailing run, so its composition cannot matter.
    for (const tail of [T, `${T}  `, ` ${T}`, `${T}${T}`, '  ', '']) {
      expect(codeContent(`${F}\nx\n${F}${tail}\n`)).toBe('x')
    }
  })

  it('closes a raw fence closer, which shares the producer', () => {
    expect(carveToHtml(`${F}=html\n<b>x</b>\n${F}${T}\n`)).toBe('<b>x</b>')
  })

  it('CONTROL the LEADING run is untouched: an indented closer still does not close', () => {
    // This fix widens the TRAILING run only. A closer for a column-0 opener has
    // to start at column 0, and that holds with a tab, with a space and with
    // nothing - all three engines agree, and none of them closes here. Pinned
    // so the trailing widening is not mistaken for a general loosening.
    expect(codeContent(`${F}\nx\n  ${F}\n`)).toBe(`x\n  ${F}`)
    expect(codeContent(`${F}\nx\n  ${F}${T}\n`)).toBe(`x\n  ${F}${T}`)
    expect(codeContent(`${F}\nx\n  ${F} \n`)).toBe(`x\n  ${F} `)
  })

  it('closes inside a quote, a list item and a div', () => {
    expect(carveToHtml(`> ${F}\n> x\n> ${F}${T}\n`)).toBe(
      '<blockquote>\n  <pre><code>x\n</code></pre>\n</blockquote>',
    )
    expect(carveToHtml(`- ${F}\n  x\n  ${F}${T}\n`)).toContain('<pre><code>x\n</code></pre>')
    expect(carveToHtml(`::: note\n${F}\nx\n${F}${T}\n:::\n`)).toContain('<pre><code>x\n</code></pre>')
  })

  it('the block really ends there, so what follows is parsed as itself', () => {
    // A block after the fence:
    const twoBlocks = `${F}\na\n${F}${T}\n\nafter\n`
    expect(carveToHtml(twoBlocks)).toBe('<pre><code>a\n</code></pre>\n<p>after</p>')
    // A second fence after the first: if the first never closed, the second
    // opener would be its content.
    expect(carveToHtml(`${F}\na\n${F}${T}\n\n${F}\nb\n${F}\n`)).toBe(
      '<pre><code>a\n</code></pre>\n<pre><code>b\n</code></pre>',
    )
    // The definition prepass reads the same index: a definition after the fence
    // must be collected, which it cannot be if the fence swallowed it.
    expect(carveToHtml(`${F}\nx\n${F}${T}\n\n[d]: u\n\nsee [x][d]\n`)).toBe(
      '<pre><code>x\n</code></pre>\n<p>see <a href="u">x</a></p>',
    )
    // Paragraph interruption reaches the closer lookahead too.
    expect(carveToHtml(`p\n${F}\nx\n${F}${T}\n\nafter\n`)).toContain('<p>after</p>')
  })

  it('THE CLOSER INDEX widened with the matcher, so a blank in the fence is not an item blank', () => {
    // The row that catches widening the real matcher and leaving
    // `RE_ANY_FENCE_CLOSER` narrow. That combination survives every other row
    // in this file, because the index gates two side paths rather than the
    // ordinary fence parse - the item-loosening pass and the attached scan.
    //
    // Here it is observable. The pass asks the index whether this fence has a
    // closer ahead, so it can mark the fence's lines opaque and know the blank
    // inside them is CODE and not an item-separating blank. A narrow index
    // refutes, the fence is never marked, the blank loosens the item, and a
    // stray `<p>` appears around the item's text:
    //
    //   <li><p>a</p>   with the index narrow
    //   <li>a          with it widened, and in carve-php
    const src = `- a\n\n  ${F}\n  x\n\n  y\n  ${F}${T}\n`
    expect(carveToHtml(src)).toBe(
      '<ul>\n  <li>a\n    <pre><code>x\n\ny\n</code></pre>\n  </li>\n</ul>',
    )
    expect(carveToHtml(src)).not.toContain('<p>')
    // CONTROL: the same document with a plain closer, which never depended on
    // the widening, renders identically.
    expect(carveToHtml(`- a\n\n  ${F}\n  x\n\n  y\n  ${F}\n`)).toBe(carveToHtml(src))
  })

  it('the DEFINITION PREPASS reads the widened opener the way the block parser does', () => {
    // THE WIDENED OPENER IS INVISIBLE HERE, and that is the point of the row.
    //
    // It was not always. This assertion used to pin the opposite: the prepass
    // opened an opaque region on `` ```<TAB> `` that ran to the end of the
    // document, so the definition below it registered nothing and the reference
    // stayed literal - carve-php's answer, and taken as the reference for the
    // ruling.
    //
    // It was the wrong reading of the disagreement. Look at the first line of
    // the expectation: this engine's BLOCK parser renders the delimiter as an
    // inline code span inside the paragraph it continues, exactly as the
    // executable spec and carve-rs do. A fence interrupts an open paragraph
    // only with a closer ahead (§10 I4), and there is none. So the block parser
    // was right and only the prepass disagreed with it - about a line that both
    // of them read, in the same document (carve-js#1136). carve-php holds the
    // same internal contradiction and is the engine that has to move.
    //
    // What the ruling changed is therefore the CLOSER, and the closer alone.
    const src = `p\n${F}${T}\n\n[d]: u\n\nsee [x][d]\n`
    expect(carveToHtml(src)).toBe('<p>p\n<code></code></p>\n<p>see <a href="u">x</a></p>')
    // CONTROL: the same document with no tab renders identically, which is what
    // "the widened opener is invisible here" means.
    expect(carveToHtml(`p\n${F}\n\n[d]: u\n\nsee [x][d]\n`)).toBe(carveToHtml(src))
    // And with a CLOSER ahead the fence really does open - it interrupts the
    // paragraph, and the definition below its closer is collected as usual.
    expect(carveToHtml(`p\n\n${F}${T}\nx\n${F}\n\n[d]: u\n\nsee [x][d]\n`)).toBe(
      '<p>p</p>\n<pre><code>x\n</code></pre>\n<p>see <a href="u">x</a></p>',
    )
    // The same, with the paragraph left OPEN over the widened opener: the fence
    // closes, so it interrupts, and nothing below it is swallowed.
    expect(carveToHtml(`p\n${F}${T}\nx\n${F}\n\n[d]: u\n\nsee [x][d]\n`)).toBe(
      '<p>p</p>\n<pre><code>x\n</code></pre>\n<p>see <a href="u">x</a></p>',
    )
  })

  it('CONTROL a space-padded and a bare closer are unchanged', () => {
    expect(codeContent(`${F}\nx\n${F} \n`)).toBe('x')
    expect(codeContent(`${F}\nx\n${F}\n`)).toBe('x')
    expect(carveToHtml(`${F}\nx\n${F}\n`)).toBe('<pre><code>x\n</code></pre>')
  })

  it('CONTROL a fence with no tab anywhere is unchanged', () => {
    expect(carveToHtml(`${F}php\nx\n${F}\n`)).toBe('<pre><code class="language-php">x\n</code></pre>')
  })

  it('CONTROL the OPENER with a tab before info still refuses', () => {
    // The separator half of the ruling, which stands and is not this change's
    // to move. `` ```<TAB>php `` is prose.
    const src = `${F}${T}php\nx\n${F}\n`
    expect(codeContent(src)).toBe(null)
    expect(carveToHtml(src)).not.toContain('<pre>')
  })

  it('an opener with a tab and NOTHING after it OPENS, the third row of the table', () => {
    // Nothing follows the tab, so it is trailing rather than a separator and
    // the fence opens as an ordinary one. This row was pinned as a known
    // divergence when only the closer had moved; the opener's trailing case is
    // now narrowed too, so it is a real assertion.
    expect(codeContent(`${F}${T}\nx\n${F}\n`)).toBe('x')
    expect(carveToHtml(`${F}${T}\nx\n${F}\n`)).toBe('<pre><code>x\n</code></pre>')
    // The tilde spelling, and a trailing run of tab-then-space.
    expect(codeContent(`~~~${T}\nx\n~~~\n`)).toBe('x')
    expect(codeContent(`${F}${T} \nx\n${F}\n`)).toBe('x')
  })

  it('an opener whose tab TRAILS an info string opens, and keeps the info', () => {
    // Content precedes the tab, so it is trailing on that side too - and the
    // info string still has to be read rather than dropped with the tab.
    expect(carveToHtml(`${F}php${T}\nx\n${F}\n`)).toBe(
      '<pre><code class="language-php">x\n</code></pre>',
    )
    // The raw fence takes the same shape through its own opener pattern.
    expect(carveToHtml(`${F}=html${T}\n<b>x</b>\n${F}\n`)).toBe('<b>x</b>')
  })
})
