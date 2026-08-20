import { describe, expect, it } from 'vitest'
import { carveToHtml, parse, resolve } from '../src/index.js'
import type { FootnoteRef, InlineFootnote, InlineNode, Paragraph } from '../src/ast.js'

/**
 * PART 9R R2, `A NOTE INSIDE AN UNRESOLVED REFERENCE IS NOT A REFERENCE`
 * (markup-carve/carve#1198).
 *
 * R1 degrades an unresolved reference to its literal SOURCE, so the link text
 * built for it is discarded rather than written into the document. A `[^label]`
 * use or an `^[content]` note sitting in that text therefore references
 * nothing: it draws no number from `footnoteSeq`, a definition it was the only
 * use of stays unreferenced and is dropped, and no endnotes section is written
 * on its account.
 *
 * The engine used to count it, because it numbered footnotes before it knew
 * whether the reference had resolved. The numbering said so out loud: the note
 * a reader can see was numbered `fnref1-2`, a repeat of a reference the
 * document does not contain, and a lone one left an endnote whose backlink
 * named an id no element carries.
 *
 * WHAT IS COUNTED IS WHAT THE OUTPUT HOLDS, so the two neighbours of this rule
 * go the other way and are asserted here as controls: a note in a reference
 * that DOES resolve is ordinary (PART 9 §16), and a note in a bracketed run
 * that never carried a tail is ordinary too, because PART 9 §14 renders that
 * run's content. A fix keyed on brackets rather than on whether the text
 * reached the reader passes the rule and breaks both controls.
 */

/** The endnotes region, byte for byte, holding a single note with one backlink. */
const loneEndnote = (body: string): string =>
  [
    '<section role="doc-endnotes">',
    '  <hr>',
    '  <ol>',
    '    <li id="fn1">',
    `      <p>${body}<a href="#fnref1" role="doc-backlink" aria-label="Back to reference">↩</a></p>`,
    '    </li>',
    '  </ol>',
    '</section>',
  ].join('\n')

/** The `<sup>` anchor a live first reference renders as. */
const noteref = '<a id="fnref1" href="#fn1" role="doc-noteref"><sup>1</sup></a>'

/** Every footnote node in a document's first paragraph, in source order. */
function notesInFirstParagraph(source: string): (FootnoteRef | InlineFootnote)[] {
  const doc = resolve(parse(source))
  const found: (FootnoteRef | InlineFootnote)[] = []
  const walk = (nodes: InlineNode[]): void => {
    for (const n of nodes) {
      if (n.type === 'footnote_ref' || n.type === 'inline_footnote') found.push(n)
      const kids = (n as { children?: InlineNode[] }).children
      if (Array.isArray(kids)) walk(kids)
    }
  }
  walk((doc.children[0] as Paragraph).children)
  return found
}

describe('PART 9R R2: a footnote inside an unresolved reference is not a reference', () => {
  it('writes no endnotes section for a note only an unresolved reference used', () => {
    const html = carveToHtml('a [t[^1]][nope] b\n\n[^1]: n\n')
    expect(html).toBe('<p>a [t[^1]][nope] b</p>')
    // Asserted as an ABSENCE too: the exact-bytes assertion above would also
    // pass if the section had merely moved somewhere else in the output.
    expect(html).not.toContain('doc-endnotes')
    expect(html).not.toContain('fnref1')
  })

  it('writes no endnotes section for an inline note in an unresolved reference', () => {
    const html = carveToHtml('a [t^[n]][nope] b\n')
    expect(html).toBe('<p>a [t^[n]][nope] b</p>')
    expect(html).not.toContain('doc-endnotes')
  })

  it('leaves the surviving reference as the FIRST one, not a repeat', () => {
    const html = carveToHtml('a [t[^1]][nope] b [^1] c\n\n[^1]: n\n')
    expect(html).toBe(`<p>a [t[^1]][nope] b ${noteref} c</p>\n${loneEndnote('n')}`)
    // The defect this rule names: the one noteref a reader can see used to be
    // `fnref1-2`, and the endnote carried a second backlink to a `#fnref1`
    // nothing in the document is.
    expect(html).not.toContain('fnref1-2')
  })

  it('numbers a live inline note from 1 when an earlier one was discarded', () => {
    const html = carveToHtml('a [t^[x]][nope] b ^[y] c\n')
    expect(html).toBe(`<p>a [t^[x]][nope] b ${noteref} c</p>\n${loneEndnote('y')}`)
    // The discarded note's content must not reach the endnotes either.
    expect(html).not.toContain('>x<')
  })

  it('does not count the use inside a COLLAPSED reference with no definition', () => {
    const html = carveToHtml('a [t[^1]][] b\n\n[^1]: n\n')
    expect(html).toBe('<p>a [t[^1]][] b</p>')
    expect(html).not.toContain('doc-endnotes')
  })

  it('does not count a use inside an unresolved reference nested in a resolved one', () => {
    const html = carveToHtml('a [x[b[^1]][nope] y][r] z\n\n[r]: /u\n\n[^1]: n\n')
    expect(html).toBe('<p>a <a href="/u">x[b[^1]][nope] y</a> z</p>')
    expect(html).not.toContain('doc-endnotes')
  })

  it('does not count a use inside an unresolved reference in a footnote body', () => {
    const html = carveToHtml('a [^1] b\n\n[^1]: n [t[^2]][nope] m\n\n[^2]: two\n')
    expect(html).toBe(`<p>a ${noteref} b</p>\n${loneEndnote('n [t[^2]][nope] m')}`)
    // The second definition was referenced only from discarded text, so it is
    // unreferenced and dropped: no `fn2` list item, no `two`.
    expect(html).not.toContain('fn2')
    expect(html).not.toContain('two')
  })

  it('counts only the resolved use when the same label is used both ways', () => {
    const html = carveToHtml('a [t[^1]][r] b [u[^1]][nope] c\n\n[r]: /u\n\n[^1]: n\n')
    expect(html).toBe(
      `<p>a <a href="/u">t${noteref}</a> b [u[^1]][nope] c</p>\n${loneEndnote('n')}`,
    )
    // One use reached the reader, so the endnote carries ONE backlink and the
    // numbered-backlink form (`↩<sup>1</sup>`) is not used at all.
    expect(html).not.toContain('fnref1-2')
  })

  it('holds in every container the reference can sit in', () => {
    expect(carveToHtml('# h [t[^1]][nope]\n\n[^1]: n\n')).toBe(
      '<section id="h-t">\n  <h1>h [t[^1]][nope]</h1>\n</section>',
    )
    expect(carveToHtml('- [t[^1]][nope]\n\n[^1]: n\n')).toBe(
      '<ul>\n  <li>[t[^1]][nope]</li>\n</ul>',
    )
    expect(carveToHtml('> [t[^1]][nope]\n\n[^1]: n\n')).toBe(
      '<blockquote><p>[t[^1]][nope]</p></blockquote>',
    )
    expect(carveToHtml('| a |\n| --- |\n| [t[^1]][nope] |\n\n[^1]: n\n')).toBe(
      [
        '<table>',
        '  <thead>',
        '    <tr><th scope="col">a</th></tr>',
        '  </thead>',
        '  <tbody>',
        '    <tr><td>[t[^1]][nope]</td></tr>',
        '  </tbody>',
        '</table>',
      ].join('\n'),
    )
  })

  describe('the resolved AST agrees with the rendering', () => {
    it('carries no number on a use inside an unresolved reference', () => {
      const [discarded] = notesInFirstParagraph('a [t[^1]][nope] b\n\n[^1]: n\n')
      expect(discarded!.type).toBe('footnote_ref')
      // PART 12 §5 keeps `number` a resolution result, so `resolve()` has to
      // land on the same answer `renderHtml()` does rather than leave a number
      // no rendering will ever use.
      expect(discarded!.number).toBeUndefined()
    })

    it('numbers the surviving use 1 while the discarded one carries nothing', () => {
      const [discarded, live] = notesInFirstParagraph('a [t[^1]][nope] b [^1] c\n\n[^1]: n\n')
      expect(discarded!.number).toBeUndefined()
      expect(live!.number).toBe(1)
    })
  })

  describe('controls: text that DOES reach the reader still counts', () => {
    it('a bracketed run that never carried a tail is not a reference (PART 9 §14)', () => {
      expect(carveToHtml('a [t[^1]] b\n\n[^1]: n\n')).toBe(
        `<p>a [t${noteref}] b</p>\n${loneEndnote('n')}`,
      )
    })

    it('a note in a reference that DOES resolve is an ordinary reference (§16)', () => {
      expect(carveToHtml('a [t[^1]][r] b\n\n[r]: /u\n\n[^1]: n\n')).toBe(
        `<p>a <a href="/u">t${noteref}</a> b</p>\n${loneEndnote('n')}`,
      )
    })

    it('a note in an inline link is an ordinary reference', () => {
      expect(carveToHtml('a [t[^1]](/u) b\n\n[^1]: n\n')).toBe(
        `<p>a <a href="/u">t${noteref}</a> b</p>\n${loneEndnote('n')}`,
      )
    })
  })
})
