import { describe, expect, it } from 'vitest'

import { htmlToCarve } from '../src/index.js'

/**
 * A TABLE `<caption>` IS NUMBERED AMONG THE TABLE'S CHILD NODES
 * (markup-carve/carve#1560).
 *
 * PART 12 §16 grants exactly three exemptions from counting among all of the
 * parent's child nodes, and closes the list with a MUST NOT: an `<li>` among
 * the list's items, a `<tr>` among the table's rows, a cell among the cells of
 * its row. The importer reads those three parents through a shape of its own
 * and renumbers them, which is what earns the exemption.
 *
 * A `<caption>` earns none. A table has at most one, so "among the captions"
 * can only ever be `[1]` - there is nothing to renumber, and the step this
 * engine printed was not a basis at all but a hard-coded index that never
 * consulted a position.
 *
 * IT AGREED WITH THE RIGHT ANSWER ONLY FOR A TABLE WRITTEN WITH NO WHITESPACE,
 * which is why no fixture caught it: every caption case in the suite spelled
 * the table on one line, where the caption really is the first child. Put
 * `<table>` on its own line and the newline is a text node, so the caption is
 * the second child and `caption[1]` named a node the reader does not have.
 *
 * `caption[1]` is also what a reader gets from resolving the path as XPath, so
 * a wrong step here does not read as wrong - it reads as the answer to a
 * different question. That is the reading §16 exists to head off, and it is why
 * this is pinned rather than fixed quietly.
 */
describe('a table caption is numbered among the children of its table', () => {
  const paths = (html: string): Array<string | undefined> =>
    htmlToCarve(html)
      .report.diagnostics.filter((d) => d.code === 'attribute-dropped')
      .map((d) => d.path)

  it('counts the whitespace text node a pretty-printed table starts with', () => {
    // The ticket's own input. The newline after `<table>` is the first child,
    // so the caption is the second - the reading carve-php already printed.
    const html = '<table>\n<caption onclick="x()">C</caption>\n<tr><td>a</td></tr>\n</table>'
    expect(paths(html)).toEqual(['/table[1]/caption[2]'])
  })

  it('still says caption[1] where the caption really is the first child', () => {
    // The compact spelling, where the old literal happened to be right. It has
    // to stay right, or the fix would be a second wrong answer.
    const html = '<table><caption onclick="x()">C</caption><tr><td>a</td></tr></table>'
    expect(paths(html)).toEqual(['/table[1]/caption[1]'])
  })

  it('counts every child kind before it, not just whitespace', () => {
    // A `<colgroup>` is dropped whole and contributes no step of its own, but
    // it is still a child of the table, so it still moves the caption's index.
    const html = '<table><colgroup><col></colgroup><caption id="c">C</caption><tr><td>a</td></tr></table>'
    expect(paths(html)).toContain('/table[1]/caption[2]')
  })

  it('numbers the first caption on the same basis as the second one', () => {
    /*
     * The tell that this was a defect rather than a spelling latitude: the
     * second-caption diagnostic went through the child-index helper and the
     * first one through a literal, so one element kind spoke under two bases in
     * a single document. Both are child indices now.
     */
    const html =
      '<table>\n<caption onclick="x()">A</caption>\n<caption id="b">B</caption>\n<tr><td>a</td></tr>\n</table>'
    const result = htmlToCarve(html)
    expect(paths(html)).toContain('/table[1]/caption[2]')
    expect(
      result.report.diagnostics.filter((d) => d.code === 'table-degraded').map((d) => d.path),
    ).toEqual(['/table[1]/caption[4]'])
  })

  it('reports the same path whichever attribute it drops', () => {
    const html = '<table>\n<caption id="tc" class="k">C</caption>\n<tr><td>a</td></tr>\n</table>'
    expect(paths(html)).toEqual(['/table[1]/caption[2]'])
  })
})
