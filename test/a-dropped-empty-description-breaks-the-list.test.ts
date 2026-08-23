import { describe, expect, it } from 'vitest'
import { carveToCarve, carveToHtml, fromAstJson, htmlToAst, htmlToCarve, renderCarve } from '../src/index.js'

const NOT_LAST = '<dl><dt>t1</dt><dd></dd><dt>t2</dt><dd>d2</dd></dl>'
const LAST = '<dl><dt>t1</dt><dd>d1</dd><dt>t2</dt><dd></dd></dl>'

/** The tree the shared fixture records: ONE list, four items, empty `<dd>` kept. */
const ingested = () =>
  fromAstJson({
    type: 'document',
    srcByteLength: 0,
    children: [
      {
        type: 'definition_list',
        items: [
          { type: 'definition_term', children: [{ type: 'text', value: 't1' }] },
          { type: 'definition_description', children: [] },
          { type: 'definition_term', children: [{ type: 'text', value: 't2' }] },
          {
            type: 'definition_description',
            children: [{ type: 'paragraph', children: [{ type: 'text', value: 'd2' }] }],
          },
        ],
      },
    ],
  })

/**
 * markup-carve/carve#1636. carve#1627 ruled that an entry writing nothing is
 * dropped and its term written alone, which is right while the dropped entry is
 * the LAST one. Put an entry after it and the same import breaks the ceiling in
 * the other direction.
 *
 * Consecutive `::` lines SHARE the description written below them - that is the
 * `<dl>` model the syntax mirrors - so dropping the empty description and
 * writing both terms into one list gives `t1` the description `d2`, which it
 * never had.
 *
 * AN ADDITION IS NOT A LOSS AND NO ROW CAN DECLARE IT. A loss that stays inside
 * a declared ceiling is acceptable because the reader is told what is missing;
 * an addition changes what the surviving term MEANS, and a reader told the empty
 * description was dropped has been told nothing about `t1` acquiring `d2`. The
 * ceiling therefore binds in both directions: an importer may lose what it
 * declares AND NO MORE, and it may add nothing at all.
 */
describe('a dropped empty description breaks the list', () => {
  it('writes two lists, separated by a comment line', () => {
    expect(htmlToCarve(NOT_LAST).value).toBe(':: t1\n\n%%\n\n:: t2\n:  d2\n')
  })

  it('gives the surviving term no description it never had', () => {
    expect(carveToHtml(htmlToCarve(NOT_LAST).value)).toBe(
      '<dl>\n  <dt>t1</dt>\n</dl>\n<dl>\n  <dt>t2</dt>\n  <dd>d2</dd>\n</dl>',
    )
  })

  /**
   * A BLANK LINE IS NOT THE BREAK. It neither ends a definition list nor loosens
   * one, so the blank-line spelling is ONE list with two terms sharing `d2` -
   * the outcome the rule forbids - and the writer removes the blank line again.
   * Both halves are asserted, because either one alone would let the blank-line
   * spelling look adequate.
   */
  it('cannot use a blank line: it neither ends the list nor survives the writer', () => {
    expect(carveToHtml(':: t1\n\n:: t2\n:  d2\n')).toBe(
      '<dl>\n  <dt>t1</dt>\n  <dt>t2</dt>\n  <dd>d2</dd>\n</dl>',
    )
    expect(carveToCarve(':: t1\n\n:: t2\n:  d2\n')).toBe(':: t1\n:: t2\n:  d2\n')
  })

  it('is a fixed point of the writer', () => {
    const written = htmlToCarve(NOT_LAST).value
    expect(carveToCarve(written)).toBe(written)
  })

  /**
   * TWO ROWS, IN DOCUMENT ORDER OF THE LOSING ELEMENT. `structure-split` is not
   * folded into `structure-unspellable`: that code is for a shape the syntax
   * cannot spell at all, and here every part is spellable, present and exact -
   * what the source cannot say is that they were one list.
   */
  it('declares the split and the dropped description, in that order', () => {
    const codes = htmlToCarve(NOT_LAST).report.diagnostics.map((d) => [d.code, d.path])
    expect(codes).toEqual([
      ['structure-split', '/dl[1]'],
      ['structure-unspellable', '/dl[1]/dd[2]'],
    ])
  })

  it('reports nothing on the AST exit, which loses nothing', () => {
    const result = htmlToAst(NOT_LAST)
    expect(result.report.diagnostics).toEqual([])
    expect(result.value.children[0]).toMatchObject({
      type: 'definition_list',
      items: [
        { terms: [[{ type: 'text', value: 't1' }]], definitions: [[]] },
        { definitions: [[{ type: 'paragraph', children: [{ type: 'text', value: 'd2' }] }]] },
      ],
    })
  })

  /**
   * THE CONTROL carve#1627 already ruled. A dropped LAST entry has nothing after
   * it to lend a description to, so the term is written alone, the list is not
   * split, and no `structure-split` row is owed.
   */
  it('does not split when the dropped entry is last', () => {
    expect(htmlToCarve(LAST).value).toBe(':: t1\n:  d1\n:: t2\n')
    expect(htmlToCarve(LAST).report.diagnostics.map((d) => d.code)).toEqual(['structure-unspellable'])
  })

  it('does not split a list with nothing dropped', () => {
    expect(htmlToCarve('<dl><dt>t1</dt><dd>d1</dd><dt>t2</dt><dd>d2</dd></dl>').value).toBe(
      ':: t1\n:  d1\n:: t2\n:  d2\n',
    )
    expect(htmlToCarve('<dl><dt>t1</dt><dd>d1</dd><dt>t2</dt><dd>d2</dd></dl>').report.diagnostics).toEqual([])
  })

  /**
   * THREE PATHS REACH THIS WRITER and only the written result is common to
   * them, which is why the rule is written over "this entry writes nothing"
   * rather than over "the description is empty": an ingested tree and a parsed
   * one do not agree on what an empty description looks like.
   */
  it('takes the same branch on an ingested tree', () => {
    expect(renderCarve(ingested())).toBe(':: t1\n\n%%\n\n:: t2\n:  d2\n')
  })

  /**
   * A DESCRIPTION THAT WRITES NOTHING IS NOT ONLY AN EMPTY ONE. An invisible
   * paragraph and an empty list write nothing too, and the writer drops all
   * three alike - a fix written over "the description is empty" passes the
   * fixture and misses these.
   */
  it('takes the same branch on a description whose blocks write nothing', () => {
    expect(htmlToCarve('<dl><dt>t1</dt><dd><p>  </p></dd><dt>t2</dt><dd>d2</dd></dl>').value).toBe(
      ':: t1\n\n%%\n\n:: t2\n:  d2\n',
    )
    expect(htmlToCarve('<dl><dt>t1</dt><dd><ul></ul></dd><dt>t2</dt><dd>d2</dd></dl>').value).toBe(
      ':: t1\n\n%%\n\n:: t2\n:  d2\n',
    )
  })

  /**
   * EVERY dropped entry breaks, not just the first. Spending one separator for a
   * run of them would leave `:: t2` / `:: t3` / `:  d3` in the second list, and
   * `t2` would acquire `d3` - the same addition one list further along. One
   * `structure-split` row still covers it: the row is about the `<dl>`, and the
   * grouping it lost is one fact however many pieces the list came out in.
   */
  it('breaks at every dropped entry, not only the first', () => {
    const html = '<dl><dt>t1</dt><dd></dd><dt>t2</dt><dd></dd><dt>t3</dt><dd>d3</dd></dl>'
    expect(htmlToCarve(html).value).toBe(':: t1\n\n%%\n\n:: t2\n\n%%\n\n:: t3\n:  d3\n')
    expect(carveToHtml(htmlToCarve(html).value)).toBe(
      '<dl>\n  <dt>t1</dt>\n</dl>\n<dl>\n  <dt>t2</dt>\n</dl>\n<dl>\n  <dt>t3</dt>\n  <dd>d3</dd>\n</dl>',
    )
    expect(htmlToCarve(html).report.diagnostics.map((d) => d.code)).toEqual([
      'structure-split',
      'structure-unspellable',
      'structure-unspellable',
    ])
  })
})
