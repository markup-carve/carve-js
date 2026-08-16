import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

// carve-js#1116, ruled on markup-carve/carve#1282.
//
// `edge-cases.md:2205` is normative: an unclosed inline verbatim run "renders as
// a `<code>` span to the end of the block". A line block is a block like any
// other, so the run reaches the end of the stanza there too. carve-rs is the
// engine that already held it.
//
// This engine parsed each LINE of a stanza on its own and stitched the results
// with a hard break, so a run could not physically reach past the newline: it
// closed at the `<br>` and the rest of the stanza came out as prose. The
// paragraph control - the same two lines with no container - always carried the
// run across, and is unanimous across all three engines.
//
// THE SPAN HOLDS A LITERAL NEWLINE, not a space. The issue body originally said
// `<code>b c d</code>`; that is wrong and was corrected on the ticket. An engine
// fixed toward it would join the lines with a space and diverge from carve-rs on
// the very shape the ruling settles, so every row below is written with the
// newline and was measured byte-exact against carve-rs `9b0bc779`.
//
// The `<br>` DISAPPEARS on the fixed shape. That is not a separate decision: a
// newline swallowed by an open run is not a line break, so there is nothing left
// to render one from.

describe('an unclosed inline run reaches the end of a line block', () => {
  it('carries a verbatim run across the line break, newline and all', () => {
    expect(carveToHtml('::: |\na `b\nc d\n:::\n')).toBe(
      '<div class="line-block">\n  <p>a <code>b\nc d</code></p>\n</div>',
    )
  })

  it('carries an inline math run across it', () => {
    expect(carveToHtml('::: |\na $`b\nc d\n:::\n')).toBe(
      '<div class="line-block">\n  <p>a <span class="math inline">\\(b\nc d\\)</span></p>\n</div>',
    )
  })

  it('carries a literal inline run across it', () => {
    // The `!` prefix stays literal text on an UNCLOSED run, in a line block
    // exactly as in a paragraph - the control below pins the same shape.
    expect(carveToHtml('::: |\na !`b\nc d\n:::\n')).toBe(
      '<div class="line-block">\n  <p>a !<code>b\nc d</code></p>\n</div>',
    )
  })

  it('resolves a two-line inline footnote instead of leaving it literal', () => {
    // The same ruling read from the other side: the footnote's brackets close on
    // the next line, so under per-line parsing the construct was invisible and
    // the source stayed on the page as `a ^[note<br> more] b`.
    //
    // Asserted as "the boundary no longer blocks resolution" rather than against
    // a fixed string, because a single-line inline footnote inside a line block
    // renders as `[^]` and loses its body in this engine - a SEPARATE defect,
    // filed separately, present before this change and unaffected by it. Pinning
    // its HTML here would pin that defect as correct.
    const twoLine = carveToHtml('::: |\na ^[note\nmore] b\n:::\n')
    expect(twoLine).not.toContain('^[')
    expect(twoLine).toBe(carveToHtml('::: |\na ^[note] b\n:::\n'))
  })

  // The paragraph controls. Unanimous across all three engines today and they
  // must stay that way: this change is about making the line block agree with
  // them, so a fix that moved them would have gone the wrong way.
  it('CONTROL: the paragraph form is unchanged for verbatim', () => {
    expect(carveToHtml('a `b\nc d\n')).toBe('<p>a <code>b\nc d</code></p>')
  })

  it('CONTROL: the paragraph form is unchanged for math', () => {
    expect(carveToHtml('a $`b\nc d\n')).toBe(
      '<p>a <span class="math inline">\\(b\nc d\\)</span></p>',
    )
  })

  it('CONTROL: the paragraph form is unchanged for literal inline', () => {
    expect(carveToHtml('a !`b\nc d\n')).toBe('<p>a !<code>b\nc d</code></p>')
  })

  it('CONTROL: a CLOSED run still ends its line with a break', () => {
    // The break is not gone in general - only where a run swallowed the newline.
    expect(carveToHtml('::: |\na `b` c\nd e\n:::\n')).toBe(
      '<div class="line-block">\n  <p>a <code>b</code> c<br>\nd e</p>\n</div>',
    )
  })

  it('PARITY: `::: hardbreaks`, the sibling container, already agreed', () => {
    // It parses the block whole and rewrites the soft break to a hard one after
    // the fact, which is why it already produced this. The line block now has
    // the same shape, so the sibling must not move.
    //
    // Labelled PARITY rather than CONTROL on purpose: on THIS input the run
    // swallows the newline, so no soft break survives to convert and mutating
    // that conversion leaves the row green. It is evidence that the two
    // containers agree, not a check on the mapping.
    expect(carveToHtml('::: hardbreaks\na `b\nc d\n:::\n')).toBe(
      '<div class="hardbreaks">\n  <p>a <code>b\nc d</code></p>\n</div>',
    )
  })

  it('a CLOSED inline construct that spans lines keeps the newline too', () => {
    // Raised as a P1 in review, on the reading that a line block must always
    // render a `<br>` at every line boundary. It must not, and carve-rs is the
    // engine that says so: a newline CONSUMED by an inline construct is not a
    // line break, whether the construct closed or not. Emphasis, a link and a
    // semantic span all agree with carve-rs byte for byte, so the rows are
    // pinned here rather than argued about again.
    expect(carveToHtml('::: |\n*a\nb*\n:::\n')).toBe(
      '<div class="line-block">\n  <p><strong>a\nb</strong></p>\n</div>',
    )
    expect(carveToHtml('::: |\n[a\nb](https://x)\n:::\n')).toBe(
      '<div class="line-block">\n  <p><a href="https://x">a\nb</a></p>\n</div>',
    )
    expect(carveToHtml('::: |\n{+a\nb+}\n:::\n')).toBe(
      '<div class="line-block">\n  <p><ins>a\nb</ins></p>\n</div>',
    )
    expect(carveToHtml('::: |\na *bo\nld* b\n:::\n')).toBe(
      '<div class="line-block">\n  <p>a <strong>bo\nld</strong> b</p>\n</div>',
    )
  })

  it('a stanza break still ends the run: the next stanza starts clean', () => {
    // "To the end of the BLOCK" is the stanza, not the whole line block: a blank
    // line starts a new paragraph, and an unclosed run cannot reach into it.
    expect(carveToHtml('::: |\na `b\nc\n\nd `e\nf\n:::\n')).toBe(
      '<div class="line-block">\n  <p>a <code>b\nc</code></p>\n  <p>d <code>e\nf</code></p>\n</div>',
    )
  })

  it('leaves the layout the container exists for alone', () => {
    // Preserved indentation and medial gaps are what a line block is FOR, and
    // they are rewritten to sentinels before the inline pass. Joining the stanza
    // must not disturb them.
    expect(carveToHtml('::: |\n  abc\n    def\n:::\n')).toBe(
      '<div class="line-block">\n  <p>&nbsp;&nbsp;abc<br>\n&nbsp;&nbsp;&nbsp;&nbsp;def</p>\n</div>',
    )
  })
})
