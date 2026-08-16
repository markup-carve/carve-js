import { describe, expect, it } from 'vitest'

import { carveToHtml, fromAstJson, htmlToAst, htmlToCarve, toAstJson } from '../src/index.js'

/**
 * A `<tbody>`'s and a `<tr>`'s own attributes reach the slots the model has for
 * them, and the sections with no slot are named on the way out.
 *
 * Nothing read any of them before. A `<tbody id="totals">` and a
 * `<tr class="warn">` fell into the empty `attrs` slot with no diagnostic at
 * all - the exact silent loss `markup-carve/carve#1210` exists to kill - even
 * though `table_row.attrs` is spelled by the writer on the closing pipe and
 * `rowGroups.bodies[].attrs` is in PART 12's table model.
 *
 * Only a BODY has a section slot. The head and the foot are stated as row
 * COUNTS, so attributes on `<thead>` or `<tfoot>` cannot be represented at all
 * and are reported instead.
 */

const ast = (html: string): Record<string, unknown> =>
  htmlToAst(html, { mode: 'semantic' }).value.children[0] as unknown as Record<string, unknown>
const groups = (html: string): unknown => ast(html).rowGroups
const report = (html: string): string[] =>
  htmlToCarve(html, { mode: 'semantic' }).report.diagnostics.map(
    (diagnostic) => `${diagnostic.code}: ${diagnostic.message}`,
  )

describe('a table section keeps the attributes it has a slot for', () => {
  it('puts a `<tbody>`\'s attributes on its body group', () => {
    // The counts alone are what a reader derives from the rows, so this table
    // used to emit no `rowGroups` at all. The attributes are not derivable, so
    // the field is what carries them.
    const html =
      '<table><thead><tr><th>a</th></tr></thead><tbody id="body" class="x"><tr><td>1</td></tr></tbody></table>'
    expect(groups(html)).toEqual({
      headRows: 1,
      bodies: [{ headRows: 0, bodyRows: 1, attrs: { id: 'body', classes: ['x'] } }],
      footRows: 0,
    })
    // Only the field's own unspellability in Carve SOURCE is reported: the
    // attributes themselves are represented, so they are not a loss.
    expect(report(html)).toEqual([
      'structure-unspellable: A table with an explicit head/body/foot grouping has no Carve spelling; the written table keeps only the structure a reader derives from its rows',
    ])
  })

  it('gives each of two bodies its own', () => {
    const html =
      '<table><tbody id="b1"><tr><td>1</td></tr></tbody><tbody id="b2" class="c"><tr><td>2</td></tr></tbody></table>'
    expect(groups(html)).toEqual({
      headRows: 0,
      bodies: [
        { headRows: 0, bodyRows: 1, attrs: { id: 'b1' } },
        { headRows: 0, bodyRows: 1, attrs: { id: 'b2', classes: ['c'] } },
      ],
      footRows: 0,
    })
  })

  it('carries them through the AST-JSON round trip', () => {
    const html = '<table><thead><tr><th>a</th></tr></thead><tbody id="body"><tr><td>1</td></tr></tbody></table>'
    const back = fromAstJson(toAstJson(htmlToAst(html, { mode: 'semantic' }).value))
    expect((back.children[0] as unknown as Record<string, unknown>).rowGroups).toEqual(groups(html))
  })

  it('keeps a body group that has nothing but attributes', () => {
    // Its rows are all header rows and the head absorbs them, which leaves the
    // group with both counts at zero. Dropping it there would take the
    // attributes with it.
    const html = '<table><tbody id="x"><tr><th>a</th></tr></tbody></table>'
    expect(groups(html)).toEqual({
      headRows: 1,
      bodies: [{ headRows: 0, bodyRows: 0, attrs: { id: 'x' } }],
      footRows: 0,
    })
  })

  it('puts a `<tr>`\'s attributes on the row, and writes them', () => {
    const html = '<table><tr id="r1" class="hi"><td>a</td></tr></table>'
    expect((ast(html).rows as Array<Record<string, unknown>>)[0]!.attrs).toEqual({
      id: 'r1',
      classes: ['hi'],
    })
    // Carve spells a row's attributes on the closing pipe, so this one survives
    // the written source and comes back on the `<tr>`.
    expect(htmlToCarve(html, { mode: 'semantic' }).value).toBe('| a |{#r1 .hi}\n')
    expect(carveToHtml('| a |{#r1 .hi}\n')).toContain('<tr id="r1" class="hi">')
    expect(report(html)).toEqual([])
  })
})

describe('a table section with no slot for them is named', () => {
  it('reports a `<thead>`\'s attributes', () => {
    const html =
      '<table><thead id="h"><tr><th>a</th></tr></thead><tbody><tr><td>1</td></tr></tbody><tfoot><tr><td>f</td></tr></tfoot></table>'
    expect(report(html)).toContain(
      "attribute-dropped: Dropped id on <thead>: a table's head is stated as a row count and has no attribute slot",
    )
    // Reported by `htmlToAst` too: the loss is the import's, not the writer's.
    expect(htmlToAst(html, { mode: 'semantic' }).report.diagnostics.map((d) => d.code)).toEqual([
      'attribute-dropped',
    ])
  })

  it('reports a `<tfoot>`\'s attributes', () => {
    const html =
      '<table><thead><tr><th>a</th></tr></thead><tbody><tr><td>1</td></tr></tbody><tfoot id="f" class="sum"><tr><td>f</td></tr></tfoot></table>'
    expect(report(html)).toContain(
      "attribute-dropped: Dropped id, class on <tfoot>: a table's foot is stated as a row count and has no attribute slot",
    )
  })

  it('reports a section that has no rows at all', () => {
    // A body group IS the run of rows it consumes, so a section with none is
    // not a group. Reading the sections back off the ROWS missed these
    // entirely, which left them as silent as before.
    expect(report('<table><tbody id="a"><tr><td>1</td></tr></tbody><tbody id="empty"></tbody></table>')).toContain(
      'attribute-dropped: Dropped id on <tbody>: a body group is the rows it consumes, and this one has none',
    )
    expect(report('<table><tbody id="empty"></tbody></table>')).toEqual([
      'attribute-dropped: Dropped id on <tbody>: a body group is the rows it consumes, and this one has none',
    ])
    expect(report('<table><thead id="eh"></thead><tbody><tr><td>1</td></tr></tbody></table>')).toEqual([
      "attribute-dropped: Dropped id on <thead>: a table's head is stated as a row count and has no attribute slot",
    ])
  })

  it('reports a `<tbody>`\'s attributes when the grouping itself is dropped', () => {
    // A `<thead>` after the body is not a prefix of the rows, so the field goes
    // - and the body group that was holding the attributes goes with it.
    const html =
      '<table><tbody id="b"><tr><td>1</td></tr></tbody><thead id="h"><tr><th>a</th></tr></thead></table>'
    expect(report(html)).toEqual([
      'table-degraded: Dropped the row grouping of a table whose <thead> or <tfoot> is not at the edge of its rows: the head is a prefix of the rows and the foot a suffix',
      'attribute-dropped: Dropped id on <tbody>: the row grouping this body belongs to was not kept, and nothing else holds it',
      "attribute-dropped: Dropped id on <thead>: a table's head is stated as a row count and has no attribute slot",
    ])
  })
})

describe('the tables this does not change', () => {
  it('emits no grouping and no diagnostic for a plain head over a plain body', () => {
    const html = '<table><thead><tr><th>a</th></tr></thead><tbody><tr><td>1</td></tr></tbody></table>'
    expect(groups(html)).toBeUndefined()
    expect(report(html)).toEqual([])
    expect(htmlToCarve(html, { mode: 'semantic' }).value).toBe('|= a |\n| 1 |\n')
  })

  it('still emits the grouping a `<tfoot>` makes, with no attributes on it', () => {
    const html =
      '<table><thead><tr><th>a</th></tr></thead><tbody><tr><td>1</td></tr></tbody><tfoot><tr><td>f</td></tr></tfoot></table>'
    expect(groups(html)).toEqual({ headRows: 1, bodies: [{ headRows: 0, bodyRows: 1 }], footRows: 1 })
  })

  it('leaves a row with no attributes without an attribute block', () => {
    expect(htmlToCarve('<table><tr><td>a</td></tr></table>', { mode: 'semantic' }).value).toBe('| a |\n')
  })

  it('still puts a cell\'s attributes on the cell, not on its row', () => {
    const html = '<table><tr><td id="c">a</td></tr></table>'
    const rows = ast(html).rows as Array<Record<string, unknown>>
    expect(rows[0]!.attrs).toBeUndefined()
    expect((rows[0]!.cells as Array<Record<string, unknown>>)[0]!.attrs).toEqual({ id: 'c' })
  })

  it('reports an attribute no row can carry, as an ordinary unsupported one', () => {
    expect(report('<table><tr bogus="1"><td>a</td></tr></table>')).toEqual([
      'attribute-dropped: Dropped unsupported attribute bogus on <tr>',
    ])
  })
})
