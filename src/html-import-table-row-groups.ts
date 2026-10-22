import type { Attrs, TableBodyGroup, TableRow, TableRowGroups } from './ast.js'
import { domChildren, domTag, type P5Node } from './html-import-dom.js'
import type { HtmlImportReportCollector } from './html-import-report.js'

export type UnspellableTablePart = { node: P5Node; path: string; message: string }

/** Converts DOM table sections into the retained row partition. Consumes claimed sectionAttrs entries and appends source losses to unspellable in encounter order. */
export class TableRowGroupStage {
  constructor(
    private readonly report: HtmlImportReportCollector,
    private readonly unspellable: UnspellableTablePart[],
  ) {}

  /**
   * `<thead>/<tbody>/<tfoot>` -> `table.rowGroups`, when the partition says
   * something a reader cannot derive (carve#1210 D1, ruled as (b)).
   *
   * Every renderer already derives a structure from the rows alone: the leading
   * run of all-header rows is the head, everything after it is one body, there
   * is no foot and there are no row-head columns. A `<thead>` over a `<tbody>`
   * is exactly that, so emitting the field for it would put structure into
   * every imported table that the source form cannot spell and hand-written
   * Carve never carries - which is what (a) was and what (b) rejects.
   *
   * So it is emitted only where the two DISAGREE: a `<tfoot>`, a second
   * `<tbody>`, a body with its own intermediate header rows, a body with
   * row-head columns, or a `<thead>` whose rows are not all header cells (Word
   * and pandoc both emit `<thead><tr><td>`), where the derived head is empty
   * and the stated one is not.
   *
   * A `<tbody>`'s own attributes are one of those disagreements: the derived
   * structure has no way to say them, so a body carrying any is not derivable
   * and the field is emitted to hold them in the body group's `attrs`. Only a
   * BODY has that slot - the head and the foot are stated as counts - so a
   * `<thead>` or `<tfoot>` that carries attributes is reported by the caller,
   * along with a `<tbody>` whose group was dropped for another reason.
   *
   * The counts are not checked against `rows.length` here. They are built from
   * the same row list the rows are built from, so a check at this point cannot
   * fail; PART 12 §15's MUST is enforced where a payload arrives from
   * elsewhere, in `fromAstJson`.
   */
  run(
    node: P5Node,
    tr: P5Node[],
    rows: TableRow[],
    group: Map<P5Node, P5Node>,
    leadingHeaderRows: number,
    path: string,
    sectionAttrs: Map<P5Node, { attrs: Attrs; path: string }>,
  ): TableRowGroups | undefined {
    const sectionOf = (row: P5Node): string => domTag(group.get(row)) ?? 'tbody'
    const isHeaderRow = (row: P5Node): boolean => {
      const cells = (domChildren(row) ?? []).filter((n) => domTag(n) === 'td' || domTag(n) === 'th')
      return cells.length > 0 && cells.every((n) => domTag(n) === 'th')
    }
    // The head is a PREFIX of `rows` and the foot a SUFFIX, which is what the
    // field can express. A `<thead>` that is not first, or a `<tfoot>` with
    // rows after it, is a table this cannot describe.
    const sections = tr.map(sectionOf)
    const headRows = sections.findIndex((name) => name !== 'thead') === -1 ? tr.length : sections.findIndex((name) => name !== 'thead')
    let footRows = 0
    while (footRows < tr.length - headRows && sections[tr.length - 1 - footRows] === 'tfoot') footRows += 1
    const middle = tr.slice(headRows, tr.length - footRows)
    if (middle.some((row) => sectionOf(row) === 'thead' || sectionOf(row) === 'tfoot')) {
      this.report.add(
        'table-degraded',
        'Dropped the row grouping of a table whose <thead> or <tfoot> is not at the edge of its rows: the head is a prefix of the rows and the foot a suffix',
        'warning',
        path,
        node,
      )
      return undefined
    }

    const takeSectionAttrs = (tag: string): Attrs | undefined => {
      const sections = (domChildren(node) ?? []).filter(section => domTag(section) === tag)
      if (sections.length !== 1) return undefined
      const section = sections[0]!
      const own = sectionAttrs.get(section)
      if (!own) return undefined
      sectionAttrs.delete(section)
      this.unspellable.push({ node: section, path: own.path, message: `Dropped rowGroups.${tag === 'thead' ? 'headAttrs' : 'footAttrs'} because Carve source cannot spell section attributes` })
      return own.attrs
    }
    const headAttrs = takeSectionAttrs('thead')
    const footAttrs = takeSectionAttrs('tfoot')
    const bodyPaths = new Map([...sectionAttrs].map(([section, own]) => [section, own.path]))
    const headers: boolean[][] = []
    for (const row of rows) {
      const previous = headers[headers.length - 1]
      headers.push(row.cells.map((cell, column) => cell.span === 'rowspan'
        ? previous?.[column] ?? false
        : cell.header))
    }
    let bodies: TableBodyGroup[] = []
    let bodySections: Array<P5Node | undefined> = []
    let index = 0
    while (index < middle.length) {
      const section = group.get(middle[index]!)
      const groupRows: P5Node[] = []
      while (index < middle.length && group.get(middle[index]!) === section) groupRows.push(middle[index++]!)
      let groupHead = 0
      while (groupHead < groupRows.length && isHeaderRow(groupRows[groupHead]!)) groupHead += 1
      // A group whose rows are ALL header rows is an intermediate header with
      // nothing under it, which is what the counts say and not something to
      // reinterpret.
      const first = headRows + index - groupRows.length + groupHead
      const rowHeadColumns = groupHead < groupRows.length
        ? this.rowHeadColumns(rows.slice(first, first + groupRows.length - groupHead), headers, first)
        : 0
      // The `<tbody>`'s own attributes: the body group is where the exchanged
      // model puts them, and it is the only section with a slot.
      const own = section ? sectionAttrs.get(section) : undefined
      bodySections.push(section)
      bodies.push({ headRows: groupHead, bodyRows: groupRows.length - groupHead, ...(rowHeadColumns > 0 ? { rowHeadColumns } : {}), ...(own ? { attrs: own.attrs } : {}) })
      // Claimed here rather than after the return below, because a body
      // carrying attributes is never DERIVABLE - that is what the clause on
      // `derivable` says - so the field is returned whenever one was claimed,
      // and the only return that skips this point is the one before the loop.
      // A deferral for it was here and no mutation of it could change an
      // output.
      if (section && own) {
        sectionAttrs.delete(section)
      }
    }

    const orderedSections = domChildren(node) ?? []
    const sectionIndices = new Map<P5Node, number>(orderedSections.map((section, index) => [section, index]))
    const sectionsWithRows = new Set(group.values())
    // Empty bodies retain their position among the groups with rows.
    const emptyBodies: Array<{ section: P5Node; index: number; body: TableBodyGroup }> = []
    for (const section of orderedSections) {
      const own = sectionAttrs.get(section)
      if (domTag(section) !== 'tbody' || sectionsWithRows.has(section)) continue
      emptyBodies.push({ section, index: sectionIndices.get(section)!, body: { headRows: 0, bodyRows: 0, ...(own ? { attrs: own.attrs } : {}) } })
      sectionAttrs.delete(section)
    }
    if (emptyBodies.length > 0) {
      const mergedBodies: TableBodyGroup[] = []
      const mergedSections: Array<P5Node | undefined> = []
      let empty = 0
      const appendEmpty = (): void => {
        const entry = emptyBodies[empty++]!
        mergedBodies.push(entry.body)
        mergedSections.push(entry.section)
      }
      for (let i = 0; i < bodies.length; i++) {
        const section = bodySections[i]
        if (section !== undefined) {
          const at = sectionIndices.get(section) ?? -1
          while (empty < emptyBodies.length && emptyBodies[empty]!.index < at) appendEmpty()
        }
        mergedBodies.push(bodies[i]!)
        mergedSections.push(section)
      }
      while (empty < emptyBodies.length) appendEmpty()
      bodies = mergedBodies
      bodySections = mergedSections
    }

    // No `<thead>` at all: the leading run of header rows is what every renderer
    // reads as the head, so it is counted as one here too. Without this, the
    // ORDINARY table - a header row and some data rows, with only the implicit
    // `<tbody>` the HTML parser inserts - came out with an intermediate header
    // and no head, which is a different statement about the same table and puts
    // the field on nearly every document. That is exactly what (b) rejects.
    let headRows2 = headRows
    // ONE body only. With a second one, the header-only first body is a
    // BOUNDARY the field exists to record, and absorbing it away left a single
    // ordinary body that the derivation reproduces - so the two bodies went
    // silently, which is the opposite of the point.
    if (headAttrs === undefined && headRows2 === 0 && bodies.length === 1 && leadingHeaderRows > 0 && bodies[0]!.headRows > 0) {
      const absorbed = Math.min(leadingHeaderRows, bodies[0]!.headRows)
      headRows2 = absorbed
      bodies[0] = { ...bodies[0]!, headRows: bodies[0]!.headRows - absorbed }
      // A group carrying attributes is not empty, whatever its counts say:
      // dropping it here would drop them with it.
      if (bodies[0]!.headRows === 0 && bodies[0]!.bodyRows === 0 && bodies[0]!.rowHeadColumns === undefined && bodies[0]!.attrs === undefined) bodies.shift()
    }

    for (const [i, body] of bodies.entries()) {
      const section = bodySections[i]
      if (body.attrs && section) this.unspellable.push({ node: section, path: bodyPaths.get(section) ?? path, message: `Dropped rowGroups.bodies[${i}].attrs because Carve source cannot spell section attributes` })
    }
    const derivable =
      headAttrs === undefined && footAttrs === undefined &&
      headRows2 === leadingHeaderRows &&
      footRows === 0 &&
      bodies.length <= 1 &&
      // A single body's row-head count is read off its cells' own header flags,
      // so it states nothing the rows do not (PART 12 §15, CARVE-P12-034).
      bodies.every((body) => body.headRows === 0 && body.bodyRows > 0 && body.attrs === undefined)
    if (derivable) return undefined
    return { headRows: headRows2, bodies, footRows, ...(headAttrs ? { headAttrs } : {}), ...(footAttrs ? { footAttrs } : {}) }
  }

  /**
   * Leading COLUMNS that are header cells in every row of the group.
   *
   * Counted over the expanded grid rather than over the source cells, because
   * columns and cells are not the same thing: `<th colspan="2">` is one element
   * and two columns, and a `<th rowspan="2">` leaves the row below it starting
   * with a data ELEMENT while a header still occupies the column. Both made the
   * count wrong in a table that carries them.
   *
   * A continuation resolves the way the renderer resolves it: `<` to the
   * nearest cell to its left that is not one, `^` to the nearest row above
   * whose cell at the same index is not itself a `^`.
   */
  private rowHeadColumns(groupRows: TableRow[], headers: boolean[][], firstIndex: number): number {
    if (groupRows.length === 0) return 0
    // Every slot is exactly one COLUMN: a source cell contributes its origin
    // plus a `<` per further column, and a carried span contributes a `^` per
    // column it covers, so the array index a continuation resolves by IS the
    // grid column here.
    const leading = (row: TableRow, r: number): number => {
      let slot = 0
      while (slot < row.cells.length && headers[r]?.[slot] === true) slot += 1
      // An all-header row would say every column is a row head, which is what
      // an intermediate HEADER row is, not a row-head column.
      return slot === row.cells.length ? 0 : slot
    }
    let minimum = Infinity
    for (let offset = 0; offset < groupRows.length; offset++) minimum = Math.min(minimum, leading(groupRows[offset]!, firstIndex + offset))
    return minimum
  }

}
