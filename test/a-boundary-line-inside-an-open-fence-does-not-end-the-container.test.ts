import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'

/**
 * A boundary line inside an open fence does not end the container
 * (markup-carve/carve#983 corpus category 279, markup-carve/carve#986,
 * markup-carve/carve-js#884).
 *
 * PART 9 §17 L3 names the block kinds a `+` continuation marker may attach -
 * "ONE block of ANY kind (paragraph, list, fenced code, table, block quote,
 * div, ...)" - and bounds the attachment "up to the next blank line, sibling
 * marker, or a further `+`". Those bound THE BLOCK. A fenced block ends at its
 * CLOSER, which is what makes it one block, so a boundary line written between
 * an opener and its closer is fence content and ends nothing. Reading the blank
 * as reaching INSIDE the fence makes "fenced code" unattachable the moment its
 * body holds one, which is the kind L3 goes out of its way to name.
 *
 * SEVEN COLLECTORS ASKED THE SAME QUESTION AND FIVE ANSWERED IT WRONG. The `+`
 * marker is collected in six separate loops in this engine - a footnote body,
 * a `dd` twice (`:  +` and the mid-body form), a block quote, and a list item
 * twice (`- +` and the mid-item form) - and NONE of them consulted a fence at
 * all, so every one severed, each on its own boundary set. The seventh, the
 * item's INDENTED body, consulted two of the three fence kinds and not the
 * colon depth its own tracker already keeps, so a `:::` body severed on a
 * marker where a code fence's body did not.
 *
 * ONE SPELLING FOR EVERY CONTAINER. `collectAttachedBlock` takes the boundary
 * set as `isBoundary`, which is the only per-container part; the fence rule is
 * `fencedBlockEnd`'s and is shared. A mutation reverting ONE caller fails only
 * that caller's rows; a mutation removing ONE fence kind from `fencedBlockEnd`
 * fails that kind across EVERY caller. That pair of opposite results is what
 * "one spelling" means here, and it is the reason the rows below are written as
 * a cross product rather than as one example per bug.
 */

// A code fence whose body holds a blank line: `a` and `b` are one code block.
const CODE = ['```', 'a', '', 'b', '```']
// A colon fence whose body holds a blank line: `a` and `b` are two paragraphs
// of ONE admonition.
const COLON = ['::: note', 'a', '', 'b', ':::']
// A comment fence whose body holds a blank line. It renders nothing at all.
const COMMENT = ['%%%', 'a', '', 'b', '%%%']

const doc = (...lines: string[]): string => lines.join('\n') + '\n'
const html = (src: string): string =>
  carveToHtml(src)
    .replace(/\s+/g, ' ')
    .replace(/> </g, '><')
    .trim()

const CODE_HTML = '<pre><code>a b </code></pre>'
const COLON_HTML = '<aside class="admonition note"><p>a</p><p>b</p></aside>'

const REF = '<p>see<a id="fnref1" href="#fn1" role="doc-noteref"><sup>1</sup></a></p>'
const BACKLINK = '<a href="#fnref1" role="doc-backlink">↩</a>'
const note = (body: string): string =>
  `${REF}<section role="doc-endnotes"><hr><ol><li id="fn1"><p>n</p>${body}<p>${BACKLINK}</p></li></ol></section>`

describe('a boundary line inside an open fence does not end the container', () => {
  describe('the list item `+` collector', () => {
    it('keeps a code fence whole', () => {
      expect(html(doc('- x', '+', ...CODE, '', 'z'))).toBe(
        `<ul><li>x ${CODE_HTML}</li></ul><p>z</p>`,
      )
    })

    it('keeps a colon fence whole', () => {
      expect(html(doc('- x', '+', ...COLON, '', 'z'))).toBe(
        `<ul><li>x ${COLON_HTML}</li></ul><p>z</p>`,
      )
    })

    it('keeps a comment fence whole', () => {
      // The whole span is invisible, so the item holds only its lead text and
      // nothing escapes to document level.
      expect(html(doc('- x', '+', ...COMMENT, '', 'z'))).toBe('<ul><li>x</li></ul><p>z</p>')
    })
  })

  describe('the first-block `- +` collector', () => {
    it('keeps a code fence whole', () => {
      expect(html(doc('- +', ...CODE, '', 'z'))).toBe(`<ul><li>${CODE_HTML}</li></ul><p>z</p>`)
    })

    it('keeps a colon fence whole', () => {
      expect(html(doc('- +', ...COLON, '', 'z'))).toBe(`<ul><li>${COLON_HTML}</li></ul><p>z</p>`)
    })

    it('keeps a comment fence whole', () => {
      expect(html(doc('- +', ...COMMENT, '', 'z'))).toBe('<ul><li></li></ul><p>z</p>')
    })
  })

  describe('the block quote `+` collector', () => {
    it('keeps a code fence whole', () => {
      expect(html(doc('> q', '+', ...CODE, '', 'z'))).toBe(
        `<blockquote><p>q</p>${CODE_HTML}</blockquote><p>z</p>`,
      )
    })

    it('keeps a colon fence whole', () => {
      expect(html(doc('> q', '+', ...COLON, '', 'z'))).toBe(
        `<blockquote><p>q</p>${COLON_HTML}</blockquote><p>z</p>`,
      )
    })

    it('keeps a comment fence whole', () => {
      expect(html(doc('> q', '+', ...COMMENT, '', 'z'))).toBe(
        '<blockquote><p>q</p></blockquote><p>z</p>',
      )
    })
  })

  describe('the footnote body `+` collector', () => {
    it('keeps a code fence whole', () => {
      expect(html(doc('[^f]: n', '+', ...CODE, '', 'see[^f]'))).toBe(note(CODE_HTML))
    })

    it('keeps a colon fence whole', () => {
      expect(html(doc('[^f]: n', '+', ...COLON, '', 'see[^f]'))).toBe(note(COLON_HTML))
    })

    it('keeps a comment fence whole', () => {
      // Invisible, so the note body is its definition line and the backlink,
      // and `b` no longer escapes to document level.
      //
      // The note comes out LOOSE where the oracle renders it tight. That is a
      // SEPARATE divergence and not this class: it reproduces byte-for-byte
      // with a comment fence holding no blank at all (`[^f]: n` / `+` / `%%%` /
      // `a` / `%%%`), which is untouched here, because the footnote body has no
      // analogue of the list's `+`-separator looseness exemption. Recorded on
      // markup-carve/carve-php#1047 rather than folded into this fix.
      expect(html(doc('[^f]: n', '+', ...COMMENT, '', 'see[^f]'))).toBe(
        `${REF}<section role="doc-endnotes"><hr><ol><li id="fn1"><p>n</p><p>${BACKLINK}</p></li></ol></section>`,
      )
    })
  })

  describe('the definition body `+` collector', () => {
    it('keeps a code fence whole', () => {
      expect(html(doc(':: t', ':  d', '+', ...CODE, '', 'z'))).toBe(
        `<dl><dt>t</dt><dd><p>d</p>${CODE_HTML}</dd></dl><p>z</p>`,
      )
    })

    it('keeps a colon fence whole', () => {
      expect(html(doc(':: t', ':  d', '+', ...COLON, '', 'z'))).toBe(
        `<dl><dt>t</dt><dd><p>d</p>${COLON_HTML}</dd></dl><p>z</p>`,
      )
    })

    it('keeps a comment fence whole', () => {
      // Loose for the same separate reason the footnote row above is, and
      // likewise unchanged by this fix: `:: t` / `:  d` / `+` / `%%%` / `a` /
      // `%%%` already renders this way. What this row pins is that `b` stays
      // inside the comment instead of becoming a document-level paragraph.
      expect(html(doc(':: t', ':  d', '+', ...COMMENT, '', 'z'))).toBe(
        '<dl><dt>t</dt><dd><p>d</p></dd></dl><p>z</p>',
      )
    })
  })

  describe('the first-block `:  +` collector', () => {
    it('keeps a code fence whole', () => {
      expect(html(doc(':: t', ':  +', ...CODE, '', 'z'))).toBe(
        `<dl><dt>t</dt><dd>${CODE_HTML}</dd></dl><p>z</p>`,
      )
    })

    it('keeps a colon fence whole', () => {
      expect(html(doc(':: t', ':  +', ...COLON, '', 'z'))).toBe(
        `<dl><dt>t</dt><dd>${COLON_HTML}</dd></dl><p>z</p>`,
      )
    })

    it('keeps a comment fence whole', () => {
      expect(html(doc(':: t', ':  +', ...COMMENT, '', 'z'))).toBe(
        '<dl><dt>t</dt><dd></dd></dl><p>z</p>',
      )
    })
  })

  describe("the list item's indented body", () => {
    // Not a `+` path: the indented body is collected line by line against a
    // running tracker, and the boundary at issue is the sibling marker rather
    // than the blank. Two of the three fence kinds were already guarded here.
    it('keeps a colon fence whole across a marker at the body column', () => {
      expect(html(doc('- x', '  :::', '  a', '  - m', '  b', '  :::'))).toBe(
        '<ul><li>x <div><p>a - m b</p></div></li></ul>',
      )
    })

    it('keeps a code fence whole across a marker at the body column', () => {
      expect(html(doc('- x', '  ```', '  a', '  - m', '  b', '  ```'))).toBe(
        '<ul><li>x <pre><code>a - m b </code></pre></li></ul>',
      )
    })

    it('keeps a comment fence whole across a marker at the body column', () => {
      expect(html(doc('- x', '  %%%', '  a', '  - m', '  b', '  %%%'))).toBe('<ul><li>x</li></ul>')
    })
  })

  describe('the looseness scan reads the same three kinds', () => {
    // A blank inside a fenced block is that block's content, not an interior
    // block separator, so it must not loosen the item. This scan knew only the
    // code fence, which is the same one-kind-of-three read - and it surfaced
    // here, because the blank inside a `+`-attached `:::` or `%%%` body only
    // reaches the item's collected lines once the collectors keep it.
    it('keeps an item tight around a blank inside a `+`-attached colon fence', () => {
      expect(html(doc('- x', '+', ...COLON, '- y'))).toBe(
        `<ul><li>x ${COLON_HTML}</li><li>y</li></ul>`,
      )
    })

    it('keeps an item tight around a blank inside a `+`-attached comment fence', () => {
      expect(html(doc('- x', '+', ...COMMENT, '- y'))).toBe('<ul><li>x</li><li>y</li></ul>')
    })

    it('is not latched by an unterminated opener above a closed fence', () => {
      // An opener with no closer ahead opens nothing, so it must not swallow
      // the rest of the scan: the CLOSED code fence below the unterminated
      // `%%%` is still a fenced block and its blank still must not loosen.
      // Raised by codex review on this change.
      expect(html(doc('- x', '  %%%', '  ```', '  a', '', '  b', '  ```'))).toBe(
        '<ul><li>x <pre><code>a b </code></pre></li></ul>',
      )
    })
  })

  describe('controls', () => {
    // Each of these holds byte-identically before the fix. They pin the part of
    // L3 the fix must NOT move, so a mutation that reverts one collector leaves
    // them green while that collector's own rows go red.

    it('still ends a `+`-attached UNFENCED block at the blank line', () => {
      // The boundary rule L3 states is intact; the fix only stops it reaching
      // inside a block. Without this the change could have been "attach
      // everything", which L3 does not say.
      expect(html(doc('- x', '+', 'p', '', 'z'))).toBe('<ul><li>x p </li></ul><p>z</p>')
    })

    it('still ends an UNTERMINATED fence at the blank line', () => {
      // No closer means no fenced block to run through, so the scan falls back
      // to the boundary set - the answer this engine has always given for this
      // shape. Left where it was: no clause names the unterminated case for an
      // attached block, so the fix does not invent one.
      expect(html(doc('- x', '+', '```', 'a', '', 'z'))).toBe(
        '<ul><li>x <pre><code>a </code></pre></li></ul><p>z</p>',
      )
    })

    it('still ends a `+`-attached block at a sibling marker', () => {
      expect(html(doc('- x', '+', 'p', '- y'))).toBe('<ul><li>x p </li><li>y</li></ul>')
    })

    it('still ends a `+`-attached block at a further `+`', () => {
      expect(html(doc('- x', '+', 'p', '+', 'q'))).toBe('<ul><li>x p q </li></ul>')
    })

    it('still ends a quote-attached block at a `>` line', () => {
      expect(html(doc('> q', '+', 'p', '> r'))).toBe('<blockquote><p>q</p><p>p</p><p>r</p></blockquote>')
    })
  })
})
