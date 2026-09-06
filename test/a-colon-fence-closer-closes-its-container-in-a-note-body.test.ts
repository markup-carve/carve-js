import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'

const html = (s: string) => carveToHtml(s).trim()

/**
 * A COLON-FENCE CLOSER CLOSES ITS CONTAINER IN A FOOTNOTE BODY
 * (markup-carve/carve#1948, pinned by corpus section 457; ported as
 * markup-carve/carve-js#1654).
 *
 * A `:::` at its opener's column CLOSES the container regardless of host, so a
 * footnote body reads it exactly as a description body does. When the only
 * thing between the opener and the closer is a definition, the prepass consumes
 * the definition and the closer leaves the container EMPTY - it does not surface
 * as a `<p>:::</p>` paragraph.
 *
 * carve-js#1642 raised the note body's blocks to an authored base to consume a
 * deeper definition, but held the closer BEHIND at its residual column so the
 * `:::` read as body text. That reproduced the then-oracle; carve#1948 flipped
 * it. The closer is now promoted with the block it closes.
 */

const ref = (body: string[]) => 'see[^f]\n\n[^f]: a\n' + body.join('\n') + '\n\n[r][]\n'

// The note opener sits AT the body column (2) or ONE PAST it (3); the answer is
// the same at both. The definition is one column deeper than the opener.
const DOC = (openerCol: number, inner: string[]) =>
  ref([
    ' '.repeat(openerCol) + '::: note',
    ...inner.map((l) => ' '.repeat(openerCol + 1) + l),
    ' '.repeat(openerCol) + ':::',
  ])

describe('a colon-fence closer closes its container in a note body', () => {
  for (const [label, col] of [
    ['at the body column', 2],
    ['one past the body column', 3],
  ] as const) {
    describe(label, () => {
      it('closes the note EMPTY around a consumed definition, and the reference resolves', () => {
        const out = html(DOC(col, ['[r]: /url']))
        // The container closed: no closer text, no literal definition inside.
        expect(out, out).not.toContain('<p>:::</p>')
        expect(out, out).not.toContain('[r]:')
        expect(out, out).toContain('<aside class="admonition note" aria-label="Note">')
        // The definition registered and the document-level reference resolves.
        expect(out, out).toContain('<a href="/url">r</a>')
      })

      it('keeps a visible block, then closes empty after a trailing definition', () => {
        const out = html(DOC(col, ['body', '[r]: /url']))
        expect(out, out).not.toContain('<p>:::</p>')
        expect(out, out).toContain('<p>body</p>')
        expect(out, out).toContain('<a href="/url">r</a>')
      })

      it('closes after a definition that precedes a visible block', () => {
        const out = html(DOC(col, ['[r]: /url', 'body']))
        expect(out, out).not.toContain('<p>:::</p>')
        expect(out, out).toContain('<p>body</p>')
        expect(out, out).toContain('<a href="/url">r</a>')
      })

      /*
       * CONTROL: a plain body already closed the container before this ruling.
       * It must keep doing so - the fix names the CLOSER, not the definition.
       */
      it('closes after a plain body (unchanged)', () => {
        const out = html(DOC(col, ['body']))
        expect(out, out).not.toContain('<p>:::</p>')
        expect(out, out).toContain('<p>body</p>')
      })
    })
  }

  it('renders the corpus section 457 shape', () => {
    const out = html(ref(['    ::: note', '     [r]: /url', '    :::']))
    expect(out).toBe(
      [
        '<p>see<a id="fnref1" href="#fn1" role="doc-noteref"><sup>1</sup></a></p>',
        '<p><a href="/url">r</a></p>',
        '<section role="doc-endnotes" aria-label="Footnotes">',
        '  <hr>',
        '  <ol>',
        '    <li id="fn1">',
        '      <p>a</p>',
        '      <aside class="admonition note" aria-label="Note">',
        '',
        '      </aside>',
        '      <p><a href="#fnref1" role="doc-backlink" aria-label="Back to reference">↩</a></p>',
        '    </li>',
        '  </ol>',
        '</section>',
      ].join('\n'),
    )
  })

  it('answers the same at the body column and one past it', () => {
    for (const inner of [['[r]: /url'], ['body', '[r]: /url'], ['[r]: /url', 'body'], ['body']]) {
      expect(html(DOC(3, inner)), inner.join(' / ')).toBe(html(DOC(2, inner)))
    }
  })
})
