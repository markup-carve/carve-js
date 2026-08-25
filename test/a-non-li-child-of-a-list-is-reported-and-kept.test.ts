import { describe, expect, it } from 'vitest'

import { htmlToCarve, parse, renderHtml } from '../src/index.js'

/**
 * A LIST'S NON-`li` CHILDREN LEFT THE DOCUMENT WHOLE AND IN SILENCE
 * (markup-carve/carve-js#1340).
 *
 * The `ul` / `ol` arm of the HTML importer filtered its children down to `<li>`
 * and walked only those, so `<ul><div id="stray">z</div><li>a</li></ul>`
 * imported as one item, the text `z` was gone, and the report was EMPTY - not
 * `element-dropped`, not `element-unwrapped`, nothing. The report is the only
 * place a reader could have learned it happened.
 *
 * Two things are asserted here, and the second is why the first is not enough:
 * the content survives, and the report says the child left its place among the
 * items. A fix that only reported the loss would still lose the words; a fix
 * that only kept them would move a `<div>` out of a list with nothing saying so.
 *
 * The assertions go through the parser as well as the emitted source, because
 * what the fix promises is a document that still holds the content - and source
 * that does not read back as that document would satisfy a string assertion
 * while failing the promise.
 *
 * carve-rs settled the ruling first in markup-carve/carve-rs#1266, and the
 * emitted source, the code and the path below match what it produces.
 */
const imported = (html: string): { src: string; diags: Array<[string, string, string]> } => {
  const r = htmlToCarve(html)
  return {
    src: r.value,
    diags: r.report.diagnostics.map((d) => [d.code, d.message, d.path ?? ''] as [string, string, string]),
  }
}

const reparsed = (src: string): string => renderHtml(parse(src))

describe('a non-li child of a list is reported and kept', () => {
  /*
   * The measured case from the ticket. The div keeps its own element AND its id -
   * it goes through the ordinary block walk rather than being unwrapped by hand,
   * so nothing about it is lost except its place among the items.
   */
  it('keeps a stray div, its id, and reports it', () => {
    const { src, diags } = imported('<ul><div id="stray">z</div><li>a</li></ul>')
    expect(src).toBe('{#stray}\n:::\nz\n:::\n\n- a\n')
    expect(reparsed(src)).toBe('<div id="stray">\n  <p>z</p>\n</div>\n<ul>\n  <li>a</li>\n</ul>')
    expect(diags).toEqual([
      [
        'element-unwrapped',
        'A <div> inside <ul> kept its content but not its place among the items: it is emitted as blocks ahead of the list',
        '/ul[1]/div[1]',
      ],
    ])
  })

  /*
   * The path is the child's index among the LIST's children, not its index in
   * the filtered array - a stray after the only item is the SECOND child and is
   * reported there (PART 12 §16).
   */
  it('counts the path among the list\'s children', () => {
    const { src, diags } = imported('<ul><li>a</li><p>tail</p></ul>')
    expect(src).toBe('tail\n\n- a\n')
    expect(diags).toHaveLength(1)
    expect(diags[0]![2]).toBe('/ul[1]/p[2]')
  })

  /*
   * Bare text directly inside the list is the same loss without an element to
   * name, so it is reported too and comes back as the paragraph it needs.
   */
  it('keeps and reports bare text directly inside a list', () => {
    const { src, diags } = imported('<ul>z<li>a</li></ul>')
    expect(src).toBe('z\n\n- a\n')
    expect(reparsed(src)).toBe('<p>z</p>\n<ul>\n  <li>a</li>\n</ul>')
    expect(diags).toEqual([
      [
        'element-unwrapped',
        'Text directly inside <ul> kept its content but not its place among the items: it is emitted as a paragraph ahead of the list',
        '/ul[1]/text()[1]',
      ],
    ])
  })

  /*
   * A MARGIN IS NOT A LOSS. Every pretty-printed list carries whitespace text
   * nodes between its items, and reporting those would put a warning on the
   * ordinary shape - which is the way a diagnostic stops being read at all.
   */
  it('reports nothing for the whitespace of a pretty-printed list', () => {
    const { src, diags } = imported('<ul>\n  <li>a</li>\n  <li>b</li>\n</ul>')
    expect(src).toBe('- a\n- b\n')
    expect(diags).toEqual([])
  })

  /*
   * A COMMENT IS KEPT NOW, and it moves, so the move is said
   * (markup-carve/carve#1709). It used to be dropped outright, which is what
   * made "nothing to report" true here; the text of the comment is the
   * document's, Carve can hold it, and losing it was a choice nobody made.
   *
   * `info` rather than the `warning` its text neighbour takes: a comment
   * renders nothing in either language, so the move costs a reader of the
   * OUTPUT nothing and a reader of the SOURCE one position.
   */
  it('keeps a comment between items and says that it moved', () => {
    const { src, diags } = imported('<ul><li>a</li><!--note--><li>b</li></ul>')
    expect(src).toBe('%%%\nnote\n%%%\n\n- a\n- b\n')
    expect(diags).toEqual([
      [
        'element-unwrapped',
        'An HTML comment directly inside <ul> kept its text but not its place among the items: it is emitted as a comment ahead of the list',
        '/ul[1]/comment()[2]',
      ],
    ])
  })

  /*
   * An ACTIVE element is dropped, not kept, and says exactly that. This was a
   * SECOND silence the filtered walk carried: the `<script>` never reached the
   * arm that reports the drop, so it vanished with no diagnostic at all. It
   * gets no position note beside the drop either - reporting it as content
   * emitted ahead of the list would tell the reader the script survived
   * somewhere, and it must not survive anywhere.
   */
  it('drops a script inside a list and no longer does it in silence', () => {
    const { src, diags } = imported('<ul><script>x()</script><li>a</li></ul>')
    expect(src).toBe('- a\n')
    expect(src).not.toContain('x()')
    expect(diags).toEqual([['element-dropped', 'Dropped active <script> element', '/ul[1]/script[1]']])
  })

  /*
   * The list itself is unchanged by the rescue: an `<ol start>` still starts
   * where it said, and the stray sits ahead of it.
   */
  it('leaves the list\'s own semantics alone', () => {
    const { src, diags } = imported('<ol start="3"><div id="s">z</div><li>a</li></ol>')
    expect(src).toBe('{#s}\n:::\nz\n:::\n\n3. a\n')
    expect(reparsed(src)).toBe('<div id="s">\n  <p>z</p>\n</div>\n<ol start="3">\n  <li>a</li>\n</ol>')
    expect(diags[0]![0]).toBe('element-unwrapped')
    expect(diags[0]![2]).toBe('/ol[1]/div[1]')
  })

  /*
   * A misplaced sublist - `<ul>` directly inside `<ul>`, which no valid HTML
   * spells and an editor export does - comes back as a list of its own rather
   * than as nothing.
   */
  it('keeps a sublist with no item around it as a list', () => {
    const { src, diags } = imported('<ul><ul><li>n</li></ul><li>a</li></ul>')
    expect(reparsed(src)).toBe('<ul>\n  <li>n</li>\n</ul>\n<ul>\n  <li>a</li>\n</ul>')
    expect(diags).toHaveLength(1)
    expect(diags[0]![0]).toBe('element-unwrapped')
  })

  /*
   * Severity: a moved child is a WARNING, not an info note. A consumer that
   * filters to warnings is the one that needs to know its document was
   * restructured.
   */
  it('reports a moved child as a warning', () => {
    const r = htmlToCarve('<ul><div>z</div><li>a</li></ul>')
    expect(r.report.diagnostics).toHaveLength(1)
    expect(r.report.diagnostics[0]!.code).toBe('element-unwrapped')
    expect(r.report.diagnostics[0]!.severity).toBe('warning')
  })
})
