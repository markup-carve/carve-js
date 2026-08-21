import { describe, it, expect } from 'vitest'
import { carveToHtml, parse, resolve } from '../src/index.js'

/**
 * A LINE BLOCK HOLDS ORDINARY BLOCKS, and its inlines are numbered like any
 * other block's (markup-carve/carve-js#1117, ruled 2026-08-16). It differs from
 * a div only in that its newlines are hard breaks (§4.4).
 *
 * `numberFootnotes`' block walk had no `line_block` case, so the node fell to
 * `default: break` and none of its child paragraphs were ever visited. Nothing
 * inside a line block was assigned a number, and nothing entered the endnote
 * order.
 *
 * THE NOTE WAS NOT DEGRADED, IT WAS DELETED. An inline footnote carries no
 * `id`, so the unnumbered branch of the renderer emitted the literal `[^]` -
 * not a spelling of anything - and, because the note never entered the order,
 * no endnotes section was emitted at all. The body was gone from the document
 * rather than merely unlinked. That is why the rows below assert the SECTION
 * AND THE BODY and not the absence of `[^]`: a fix that silently dropped the
 * footnote would also remove `[^]` and pass.
 *
 * THE REFERENCE FORM WAS BROKEN THE SAME WAY, and shows the shared cause
 * rather than an inline-footnote quirk: `[^x]` inside a line block rendered as
 * its own literal source with its definition stranded, because the walk that
 * failed to reach it is the one that numbers both spellings.
 *
 * THIS IS NOT markup-carve/carve-js#1127. That fix made a stanza one inline
 * run so an unclosed run reaches the stanza's end; it is in the line block's
 * PARSER, and the footnote parsed correctly both before and after it. This one
 * is in the post-parse numbering walk, and #1117 was confirmed still present
 * once #1127 had landed.
 *
 * Every expectation was verified byte-for-byte against carve-rs `69e456e` and
 * carve-php `e140311`, both built from `origin/main`.
 */

/** The `id`s of the endnote list items a document emits, in document order. */
const endnotes = (src: string): string[] =>
  [...carveToHtml(src).matchAll(/<li id="(fn\d+)">/g)].map((m) => m[1]!)

describe("a line block's footnotes are numbered like any other block's", () => {
  it('numbers an inline footnote and emits its body in an endnotes section', () => {
    // The reported shape, asserted whole: the marker resolves AND the section
    // exists AND the body text is in it.
    expect(carveToHtml('::: |\na ^[note text] b\n:::\n')).toBe(
      '<div class="line-block">\n' +
        '  <p>a <a id="fnref1" href="#fn1" role="doc-noteref"><sup>1</sup></a> b</p>\n' +
        '</div>\n' +
        '<section role="doc-endnotes" aria-label="Footnotes">\n' +
        '  <hr>\n' +
        '  <ol>\n' +
        '    <li id="fn1">\n' +
        '      <p>note text<a href="#fnref1" role="doc-backlink" aria-label="Back to reference">↩</a></p>\n' +
        '    </li>\n' +
        '  </ol>\n' +
        '</section>',
    )
  })

  it('the body SURVIVES - a silent drop is not a fix', () => {
    // Stated separately from the byte comparison above so the intent is
    // legible: the note's text must be somewhere in the output, and the
    // endnotes section must exist. Asserting only that `[^]` is gone passes on
    // an engine that discards the footnote entirely.
    const out = carveToHtml('::: |\na ^[note text] b\n:::\n')
    expect(out).toContain('note text')
    expect(out).toContain('<section role="doc-endnotes" aria-label="Footnotes">')
    expect(endnotes('::: |\na ^[note text] b\n:::\n')).toEqual(['fn1'])
  })

  it('numbers a REFERENCE footnote in a line block too', () => {
    // Same walk, other spelling. This one has an `id`, so its broken form was
    // the literal `[^x]` with the definition stranded.
    const out = carveToHtml('[^x]: body\n\n::: |\na [^x] b\n:::\n')
    expect(out).toContain('<a id="fnref1" href="#fn1" role="doc-noteref"><sup>1</sup></a>')
    expect(out).toContain('body')
    expect(out).not.toContain('[^x]')
    expect(endnotes('[^x]: body\n\n::: |\na [^x] b\n:::\n')).toEqual(['fn1'])
  })

  it('takes its place in DOCUMENT ORDER, not after the blocks that can walk', () => {
    // The row that a fix numbering line blocks in a second pass gets wrong.
    // The note in the line block is the SECOND of three.
    const src = 'p ^[one]\n\n::: |\nl ^[two]\n:::\n\nq ^[three]\n'
    expect(endnotes(src)).toEqual(['fn1', 'fn2', 'fn3'])
    const out = carveToHtml(src)
    expect(/<li id="fn2">\s*<p>two/.test(out)).toBe(true)
    // And the marker inside the line block is the one pointing at fn2.
    expect(/<div class="line-block">[\s\S]*?href="#fn2"[\s\S]*?<\/div>/.test(out)).toBe(true)
  })

  it('numbers both notes when a stanza has one per line', () => {
    const src = '::: |\na ^[one]\nb ^[two]\n:::\n'
    expect(endnotes(src)).toEqual(['fn1', 'fn2'])
    // The hard break between the stanza's lines is still there - the numbering
    // walk must not have flattened the block it now descends into.
    expect(carveToHtml(src)).toContain('<br>')
  })

  it('reaches a line block nested inside other containers', () => {
    // The walk is recursive, so a line block below a div, a quote or a list
    // item must be reached by the same case rather than only at top level.
    for (const src of [
      '::: note\n::: |\na ^[deep]\n:::\n:::\n',
      '> ::: |\n> a ^[q]\n> :::\n',
      '- ::: |\n  a ^[li]\n  :::\n',
    ]) {
      expect(endnotes(src)).toEqual(['fn1'])
      expect(carveToHtml(src)).not.toContain('[^]')
    }
  })

  it('assigns the number on the NODE, not only in the rendered string', () => {
    // `numberFootnotes` mutates the node, and `resolve()` and the profile
    // filter read that rather than the HTML. A renderer-local patch would pass
    // every row above and leave those two consumers broken.
    // `parse()` alone does not number - `resolve()` runs the pass - so the
    // tree under test is the resolved one, which is what the CLI and every
    // `carveToAstJson` caller publishes.
    const doc = resolve(parse('::: |\na ^[note text] b\n:::\n'))
    const lineBlock = doc.children.find((n) => n.type === 'line_block')!
    const para = (lineBlock as { children: Array<Record<string, unknown>> }).children[0]!
    const note = (para as { children: Array<Record<string, unknown>> }).children.find(
      (n) => n.type === 'inline_footnote',
    )
    expect(note).toBeDefined()
    expect(note!.number).toBe(1)
  })

  it('CONTROL the same footnote in an ordinary paragraph is unchanged', () => {
    // The spelling that always worked, and the reason the ticket could scope
    // the defect to the line block.
    expect(carveToHtml('a ^[note text] b\n')).toBe(
      '<p>a <a id="fnref1" href="#fn1" role="doc-noteref"><sup>1</sup></a> b</p>\n' +
        '<section role="doc-endnotes" aria-label="Footnotes">\n' +
        '  <hr>\n' +
        '  <ol>\n' +
        '    <li id="fn1">\n' +
        '      <p>note text<a href="#fnref1" role="doc-backlink" aria-label="Back to reference">↩</a></p>\n' +
        '    </li>\n' +
        '  </ol>\n' +
        '</section>',
    )
  })

  it('CONTROL a line block with no footnote emits no endnotes section', () => {
    // Adding the case must not make an empty section appear on every line
    // block.
    const out = carveToHtml('::: |\na b\nc d\n:::\n')
    expect(out).toBe('<div class="line-block">\n  <p>a b<br>\nc d</p>\n</div>')
    expect(out).not.toContain('doc-endnotes')
  })

  it('CONTROL a note inside a note is still refused', () => {
    // §3.1: no notes inside notes. Descending into the line block must not
    // relax that.
    const out = carveToHtml('::: |\na ^[out ^[in]]\n:::\n')
    expect(endnotes('::: |\na ^[out ^[in]]\n:::\n')).toEqual(['fn1'])
    expect(out).toContain('^[in]')
  })
})
