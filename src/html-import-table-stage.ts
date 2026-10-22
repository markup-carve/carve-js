import type { Admonition, Attrs, BlockNode, InlineNode, ListItem, Table, TableCell, TableRow } from './ast.js'
import { domChildren, domTag, type P5Node } from './html-import-dom.js'
import type { HtmlImportReportCollector } from './html-import-report.js'
import { TableRowGroupStage, type UnspellableTablePart } from './html-import-table-row-groups.js'
import { preservesTableRowGroups, tableSourceAttrs } from './table-source-metadata.js'

export interface TableStageContext {
  report: HtmlImportReportCollector
  unspellable: UnspellableTablePart[]
  cellAlignment: Map<P5Node, { align?: string; valign?: string }>
  writing: boolean
  listTableForBlockCells: boolean
  enter(depth: number): void
  attr(node: P5Node, name: string): string | undefined
  childPath(path: string, node: P5Node, index: number): string
  indexIn(parent: P5Node, node: P5Node): number
  attrs(node: P5Node, path: string): Attrs | undefined
  attrNames(attrs: Attrs): string[]
  captionInlines(node: P5Node, path: string, depth: number): InlineNode[]
  blocks(nodes: P5Node[], path: string, depth: number): BlockNode[]
  blockInlines(nodes: P5Node[], path: string, depth: number): InlineNode[]
  withCellDepth<T>(read: () => T): T
  carrierValue(node: P5Node, name: 'col-widths'): string | undefined
  carriedSeparatorWidths(node: P5Node): number[] | undefined
}

export class TableStage {
  private readonly rowGroups: TableRowGroupStage
  constructor(private readonly context: TableStageContext) {
    this.rowGroups = new TableRowGroupStage(context.report, context.unspellable)
  }
  /**
   * A `colspan`/`rowspan` value, by HTML's rules: a non-negative integer,
   * clamped to the attribute's own maximum, defaulting when it is not one.
   *
   * The clamp is not decoration. Each unit of a span becomes a CELL below, so
   * an unclamped `colspan="1000000000"` is a 30-byte input asking for a billion
   * of them; the generated cells are charged to `maxNodes` on top of this, so
   * the two together bound what a table can cost.
   */
  private spanCount(cell: P5Node, name: 'colspan' | 'rowspan', max: number, min: number): number {
    const raw = this.context.attr(cell, name)
    if (raw === undefined) return 1
    const value = Number(raw.trim())
    if (!/^\d+$/.test(raw.trim()) || !Number.isSafeInteger(value)) return 1
    return Math.min(Math.max(value, min), max)
  }

  /**
   * The imported cells, laid out with the continuation cells Carve spells `^`
   * (this cell continues the one above) and `<` (it continues the one to its
   * left).
   *
   * The model already carried both - `table_cell.span` is in PART 12 and the
   * HTML renderer derives `rowspan`/`colspan` from a run of them - and the
   * import simply threw them away: a spanning cell was written as an ordinary
   * one and the row came up short, so `<td colspan="2">` produced a 1-cell row
   * under a 2-column header, with `table-degraded` as the only trace.
   *
   * The renderer resolves a continuation by POSITION IN THE ROW'S CELL ARRAY,
   * not by grid column - `^` attaches to the nearest row above whose cell at
   * the same index is not itself a continuation - so a carried span occupies
   * ONE array slot however many columns it covers, and the cells after it in
   * the row shift left by the rest. Placing the carried marks first and filling
   * the row's own cells around them is what keeps those indexes aligned.
   */
  private spanGrid(
    tr: P5Node[],
    built: Array<Array<{ cell: TableCell; colspan: number; rowspan: number }>>,
    rowAttrs: Array<Attrs | undefined>,
    path: string,
    depth: number,
  ): TableRow[] {
    let carried: Array<{ index: number; rows: number }> = []
    const rows: TableRow[] = []
    built.forEach((sourceCells, r) => {
      const marks = new Set(carried.map((entry) => entry.index))
      const cells: TableCell[] = []
      const opened: Array<{ index: number; rows: number }> = []
      const continuation = (span: 'rowspan' | 'colspan', header: boolean): TableCell => {
        this.context.enter(depth)
        return { type: 'table_cell', header, span, children: [] }
      }
      const fillMarks = (): void => {
        while (marks.has(cells.length)) cells.push(continuation('rowspan', false))
      }
      for (const { cell, colspan, rowspan } of sourceCells) {
        fillMarks()
        const columns: number[] = [cells.length]
        cells.push(cell)
        for (let k = 1; k < colspan; k++) {
          fillMarks()
          columns.push(cells.length)
          cells.push(continuation('colspan', cell.header))
        }
        // A cell spanning BOTH ways carries a mark into EACH column it covers,
        // not one for its origin. The renderer resolves a `^` against the cell
        // at the same index above it, so a single mark left the next rowspan in
        // the row resolving against a column it does not own: the gap between
        // them was filled with a cell the source did not have, reported as an
        // invention, and rendered as a `<td>` the table does not have.
        if (rowspan > 1) for (const index of columns) opened.push({ index, rows: rowspan - 1 })
      }
      // A mark past the end of this row's own cells. Placing it still costs
      // nothing - it is a cell the span already owns - but a GAP before it does:
      // the index has to be kept, and an empty cell there is one the source did
      // not have. Only that invention is reported.
      const furthest = marks.size === 0 ? -1 : Math.max(...marks)
      let invented = false
      while (cells.length <= furthest) {
        if (marks.has(cells.length)) cells.push(continuation('rowspan', false))
        else {
          this.context.enter(depth)
          cells.push({ type: 'table_cell', header: false, children: [] })
          invented = true
        }
      }
      if (invented) {
        this.context.report.add('table-degraded', 'Filled a row that is shorter than the spans reaching into it, with a cell the source did not have', 'warning', `${path}/tr[${r + 1}]`, tr[r]!)
      }
      rows.push({ type: 'table_row', cells, ...(rowAttrs[r] ? { attrs: rowAttrs[r] } : {}) })
      carried = [...carried.map((entry) => ({ ...entry, rows: entry.rows - 1 })).filter((entry) => entry.rows > 0), ...opened]
    })
    return rows
  }

  /**
   * Drop a body cell's alignment where the HEAD already says it.
   *
   * A header cell's marker run is the COLUMN's default: the renderer reads it
   * off the leading header rows and every cell below inherits what it does not
   * state. So a body cell repeating the column's value spells a thing the
   * document already says, and the shortest source that renders the same table
   * is the one without it - which is also the source a round trip has to come
   * back to, or `| h |\n|:---|\n| a |` grows a marker on every body row each
   * time it passes through HTML.
   *
   * ONLY WHERE THE VALUE AGREES. A body cell that differs from its column keeps
   * its own marker, because that is the only thing that overrides the default.
   *
   * The column walk is the renderer's: a colspan seeds every column it covers,
   * a rowspan holds its columns in the rows below, and among several header
   * rows the last one to state an axis wins.
   *
   * THE HOLD BEGINS IN THE NEXT ROW, WHICH IS `spanGrid`'S BOOKKEEPING. A
   * rowspan opens its columns while the row it starts in is still being
   * walked, so a walk that ages every hold at the end of that same row retires
   * each one a row early: the LAST row a span reaches sees its columns free,
   * every cell after them in that row is read one column to the left, and a
   * body cell whose alignment matches the WRONG column is deleted as inherited.
   * Nothing reports it - from the import's point of view no cell was refused -
   * and the re-render then spells the column the cell was misread into, so an
   * alignment the source carried is silently replaced. `spanGrid` ages the
   * carried marks BEFORE it adds the ones this row opened, and the array
   * indexes it produces are the columns the renderer reads back, so this walk
   * ages holds the same way.
   */
  private dropInheritedCellAlignment(
    built: Array<Array<{ cell: TableCell; colspan: number; rowspan: number }>>,
    leadingHeaderRows: number,
  ): void {
    if (leadingHeaderRows === 0) return
    const columns: Array<{ align?: string; valign?: string }> = []
    const held = new Map<number, number>()
    const opened = new Map<number, number>()
    const walk = (row: Array<{ cell: TableCell; colspan: number; rowspan: number }>, visit: (entry: { cell: TableCell; colspan: number; rowspan: number }, column: number) => void): void => {
      let column = 0
      for (const entry of row) {
        while ((held.get(column) ?? 0) > 0) column++
        visit(entry, column)
        for (let k = column; k < column + entry.colspan; k++) {
          if (entry.rowspan > 1) opened.set(k, Math.max(opened.get(k) ?? 0, entry.rowspan - 1))
        }
        column += entry.colspan
      }
    }
    const endOfRow = (): void => {
      for (const [column, rows] of held) {
        if (rows <= 1) held.delete(column)
        else held.set(column, rows - 1)
      }
      for (const [column, rows] of opened) held.set(column, Math.max(held.get(column) ?? 0, rows))
      opened.clear()
    }
    for (let r = 0; r < built.length; r++) {
      walk(built[r]!, (entry, column) => {
        if (r < leadingHeaderRows) {
          // A COLSPAN HEADER SEEDS EVERY COLUMN IT COVERS, and that is not a
          // guess about tables in general - it is what THIS renderer reads
          // back. Given `|~ H | < | < |< K |` with no marker on any body cell,
          // `renderHtml` writes `text-align: center` on all three columns the
          // header spans, because its own column defaults seed the same run.
          // So a body cell under any of them that repeats `center` spells what
          // the document already says, and dropping it is lossless HERE.
          // Another engine whose renderer stops the default at the header's
          // own column must keep those markers instead - the walk is only ever
          // sound against the renderer it is paired with, and this half of
          // markup-carve/carve-js#1503 was measured, not inherited.
          for (let k = column; k < column + entry.colspan; k++) {
            columns[k] ??= {}
            if (entry.cell.align) columns[k]!.align = entry.cell.align
            if (entry.cell.valign) columns[k]!.valign = entry.cell.valign
          }
          return
        }
        if (entry.cell.align && columns[column]?.align === entry.cell.align) delete entry.cell.align
        if (entry.cell.valign && columns[column]?.valign === entry.cell.valign) delete entry.cell.valign
      })
      endOfRow()
    }
  }

  run(node: P5Node, path: string, depth: number, attrs?: Attrs): BlockNode {
    /*
     * `<caption>` is a DIRECT child of the table and holds the table's own
     * caption, which `table.caption` has a slot for and Carve spells `^ text`
     * after the rows. The row walk below looks only for `tr`, so before this
     * the element was skipped and the caption left the document silently -
     * pandoc emits exactly this shape for every captioned table.
     */
    const captions = (domChildren(node) ?? [])
      .map((n, index) => ({ node: n, index }))
      .filter(({ node: n }) => domTag(n) === 'caption')
    const captionNode = captions[0]?.node
    // The PARSER keeps the first `^ ` line and reads the second as a paragraph,
    // so a table that arrives with two captions loses one either way. Reported
    // rather than dropped in silence, and the same rule as the parser's, so the
    // import and a re-read of its own output agree on which one survives.
    for (const extra of captions.slice(1)) {
      this.context.report.add(
        'table-degraded',
        'Dropped a second <caption>: a table has one caption, and the first one wins',
        'warning',
        this.context.childPath(path, extra.node, extra.index),
        extra.node,
      )
    }
    /*
     * `<colgroup>` has nowhere to land at all. Carve has no column model, and
     * whether it should get one is a language question (carve#1092) rather than
     * this importer's to answer - but the drop can say so meanwhile, and the
     * walk below said nothing: it looks for `tr`, descends through the element
     * and finds none.
     *
     * Only `<colgroup>` is scanned for. "In table" insertion mode answers a
     * `col` start tag by inserting an implied `<colgroup>` first, so
     * `<table><col span="2"><col>` arrives as one wrapper holding both and a
     * `<col>` is never a direct child of a `<table>` after parsing. A `col` arm
     * here could match nothing on any input - the check that cannot fail
     * (carve#755) - so the shape is pinned by a test instead.
     */
    ;(domChildren(node) ?? []).forEach((child, index) => {
      if (domTag(child) !== 'colgroup') return
      this.context.report.add(
        'element-dropped',
        "Dropped <colgroup>: Carve has no column model, and a table's columns are only the cells its rows carry",
        'warning',
        this.context.childPath(path, child, index),
        child,
      )
    })
    const tr: P5Node[] = []
    const group = new Map<P5Node, P5Node>()
    // The sections in document order, collected on the way through rather than
    // read back off the rows: a section with NO rows is one of the table's
    // sections too, and deriving the list from the rows left its attributes
    // unread and unreported.
    const sectionNodes: P5Node[] = []
    const walk = (n: P5Node, section?: P5Node): void => {
      if (domTag(n) === 'tr') {
        tr.push(n)
        if (section) group.set(n, section)
        return
      }
      const isSection = ['thead', 'tbody', 'tfoot'].includes(domTag(n) ?? '')
      if (isSection) sectionNodes.push(n)
      for (const child of domChildren(n) ?? []) walk(child, isSection ? n : section)
    }
    walk(node)
    if (this.context.writing && tr.length === 0) {
      this.context.report.add('table-degraded', 'Dropped a rowless table, including its attributes and caption: Carve source cannot spell a table without rows', 'warning', path, node)
    }
    // The attributes of the SECTIONS, read once and in document order. Only a
    // `<tbody>` has a slot for them - the body group `rowGroups` states - so
    // `rowGroups` takes what it places out of this map and whatever is left is
    // reported. Nothing read them before: a `<tbody id="totals">` fell into the
    // empty `attrs` slot with no diagnostic at all (carve#1210).
    const sectionAttrs = new Map<P5Node, { attrs: Attrs; path: string }>()
    for (const section of sectionNodes) {
      const sectionPath = this.context.childPath(path, section, this.context.indexIn(node, section))
      const sectionOwn = this.context.attrs(section, sectionPath)
      if (sectionOwn) sectionAttrs.set(section, { attrs: sectionOwn, path: sectionPath })
    }
    // The leading run of all-header rows is what PART 10 §T9 gives `scope="col"`;
    // a header cell below it gets `scope="row"`. Computed over the rows rather
    // than per cell, because the run ENDS at the first row carrying a `td` and
    // a cell cannot see that on its own.
    const headerCells = (row: P5Node): P5Node[] =>
      (domChildren(row) ?? []).filter((n) => domTag(n) === 'td' || domTag(n) === 'th')
    const listForm = this.context.listTableForBlockCells && tr.some((row) => headerCells(row).some(holdsBlocks))
    // A row with no cell that no rowspan reaches is dropped before writing (see
    // below), so it must not end the run: the header row after it leads.
    const dropsEmptyRows = this.context.writing && !listForm
    let leadingHeaderRows = 0
    // A rowspan stops at its own row group, so coverage resets at a boundary.
    let coveredThrough = -1
    let coveringGroup: P5Node | undefined
    for (const [r, row] of tr.entries()) {
      if (group.get(row) !== coveringGroup) {
        coveringGroup = group.get(row)
        coveredThrough = -1
      }
      const cells = headerCells(row)
      if (cells.length === 0 && dropsEmptyRows && r > coveredThrough) {
        leadingHeaderRows += 1
        continue
      }
      if (cells.length === 0 || !cells.every((n) => domTag(n) === 'th')) break
      for (const cell of cells) {
        const span = this.spanCount(cell, 'rowspan', 65534, 0)
        coveredThrough = Math.max(coveredThrough, span === 0 ? Infinity : r + span - 1)
      }
      leadingHeaderRows += 1
    }

    // How many rows are left in each row's own group, INCLUDING it. Computed
    // once: asking per cell meant scanning the whole table for each one, which
    // is quadratic in the row count.
    const remainingInGroup = new Map<P5Node, number>()
    const groupTotals = new Map<P5Node | undefined, number>()
    for (const row of tr) groupTotals.set(group.get(row), (groupTotals.get(group.get(row)) ?? 0) + 1)
    const groupSeen = new Map<P5Node | undefined, number>()
    for (const row of tr) {
      const section = group.get(row)
      const index = groupSeen.get(section) ?? 0
      groupSeen.set(section, index + 1)
      remainingInGroup.set(row, (groupTotals.get(section) ?? 1) - index)
    }

    const ownAlignment = new Map<TableCell, Pick<TableCell, 'align' | 'valign'>>()
    const built: Array<Array<{ cell: TableCell; colspan: number; rowspan: number }>> = tr.map((row, r) =>
      (domChildren(row) ?? []).filter((n) => domTag(n) === 'td' || domTag(n) === 'th').map((cell, c) => {
        const cellPath = `${path}/tr[${r + 1}]/${domTag(cell)}[${c + 1}]`
        const colspan = this.spanCount(cell, 'colspan', 1000, 1)
        // A rowspan stops at its ROW GROUP in HTML, and `rowspan="0"` means
        // exactly "to the end of it". Both are resolved against the group the
        // row is actually in, so a `<tfoot>` below the body is not swallowed by
        // a cell the layout stops at the body's last row - not only the `0`
        // form, which was the half this handled first.
        const declaredRowspan = this.spanCount(cell, 'rowspan', 65534, 0)
        const left = remainingInGroup.get(row) ?? 1
        let rowspan = declaredRowspan === 0 ? left : Math.min(declaredRowspan, left)
        // And it stops at the head the RENDERER will synthesize. Carve derives
        // the head from the leading run of all-header rows, so a span reaching
        // out of that run lands in a `<thead>` with its other rows in the
        // `<tbody>` - which browsers clip, making the written table say
        // something the source table did not. Clipped here instead, where it
        // can be reported: the alternative is a document that claims a grid it
        // does not render.
        if (r < leadingHeaderRows && r + rowspan > leadingHeaderRows) {
          this.context.report.add(
            'table-degraded',
            'Clipped a rowspan at the header rows: Carve derives the head from the leading header rows, and a span leaving them crosses a boundary browsers clip anyway',
            'warning',
            cellPath,
            cell,
          )
          rowspan = leadingHeaderRows - r
        }
        const cellAttrs = this.context.attrs(cell, cellPath)
        // A `scope` the renderer would regenerate from position is the
        // generator's own output, not something the author typed: importing it
        // writes it back as if they had. Only a value position cannot explain
        // survives.
        const scope = cellAttrs?.keyValues?.scope
        if (scope !== undefined) {
          const positional = r < leadingHeaderRows && domTag(group.get(row)) !== 'tfoot' ? 'col' : 'row'
          // Only the POSITIONAL value goes. Every other one is kept wherever
          // the cell sits, including below the header rows: `header_cell` has
          // an attribute slot now, after its markers (§5 T10), so such a cell
          // is spelled `|={scope=rowgroup}A|` and re-reads as the header cell
          // it was. It used to be dropped and reported, because the only shape
          // available then was `|{scope=…}=A|` - a DATA cell whose content is
          // the literal `=A` - and keeping the value there traded a header cell
          // for an attribute.
          if (scope === positional) {
            delete cellAttrs!.keyValues!.scope
            if (Object.keys(cellAttrs!.keyValues!).length === 0) delete cellAttrs!.keyValues
          }
        }
        // THE MARKER RUN IS THE CELL'S OWN FIELD, so a mapped `text-align` /
        // `vertical-align` is moved out of the attribute block and onto the
        // cell. A presentational `align` / `valign` beside it is dropped: CSS
        // beats the presentational attribute in HTML, and keeping both would
        // emit the same axis twice, in two spellings, from one source.
        const alignment = this.context.cellAlignment.get(cell)
        for (const key of ['align', 'valign'] as const) {
          if (alignment?.[key] === undefined) continue
          if (cellAttrs?.keyValues?.[key] === undefined) continue
          this.context.report.refuseAttribute(cell, cellPath, key, ': a mapped CSS declaration already sets it', 'info', false)
          delete cellAttrs.keyValues[key]
          if (Object.keys(cellAttrs.keyValues).length === 0) delete cellAttrs.keyValues
        }
        const kept = cellAttrs && (cellAttrs.id || cellAttrs.classes || cellAttrs.keyValues) ? cellAttrs : undefined
        let content: Pick<TableCell, 'children' | 'blocks'>
        if (listForm) {
          content = { children: [], blocks: this.context.blocks(domChildren(cell) ?? [], cellPath, depth + 1) }
        } else {
          content = this.context.withCellDepth(() => ({ children: this.context.blockInlines(domChildren(cell) ?? [], cellPath, depth + 1) }))
        }
        const built: TableCell = {
          type: 'table_cell' as const,
          header: domTag(cell) === 'th',
          ...content,
          ...(alignment?.align ? { align: alignment.align as 'left' | 'right' | 'center' } : {}),
          ...(alignment?.valign ? { valign: alignment.valign as 'top' | 'middle' | 'bottom' } : {}),
          ...(kept ? { attrs: kept } : {}),
        }
        if (listForm) ownAlignment.set(built, { ...(built.align ? { align: built.align } : {}), ...(built.valign ? { valign: built.valign } : {}) })
        return { cell: built, colspan, rowspan }
      }),
    )
    this.dropInheritedCellAlignment(built, leadingHeaderRows)
    // A `<tr>`'s own attributes have a slot - `table_row.attrs`, which the
    // writer spells on the closing pipe and every renderer emits on the `<tr>`
    // - and went in silence before this.
    const rowAttrs = tr.map((row, r) => {
      const own = this.context.attrs(row, `${path}/tr[${r + 1}]`)
      // A list-table row is an outer item, and no renderer reads attributes there.
      if (own && listForm) {
        this.context.report.add('attribute-dropped', `Dropped ${this.context.attrNames(own).join(', ')} on <tr>: a list table row has no attribute slot`, 'info', `${path}/tr[${r + 1}]`, row)
        return undefined
      }
      return own
    })
    const rows = this.spanGrid(tr, built, rowAttrs, path, depth)
    // A row with no cell has no pipe spelling: `|` alone is prose and `||` is
    // one empty cell (CARVE-P9-082), so writing it would invent a cell.
    if (dropsEmptyRows) {
      const hadRows = rows.length > 0
      for (let r = rows.length - 1; r >= 0; r--) {
        if (rows[r]!.cells.length > 0) continue
        if (r < leadingHeaderRows) leadingHeaderRows -= 1
        this.context.report.add('structure-unspellable', 'Dropped a row with no cells: Carve has no spelling for it', 'warning', `${path}/tr[${r + 1}]`, tr[r]!)
        rows.splice(r, 1)
        group.delete(tr[r]!)
        tr.splice(r, 1)
      }
      if (hadRows && rows.length === 0) {
        this.context.report.add('table-degraded', 'Dropped a rowless table, including its attributes and caption: Carve source cannot spell a table without rows', 'warning', path, node)
      }
    }
    const unspellableBefore = this.context.unspellable.length
    const rowGroups = this.rowGroups.run(node, tr, rows, group, leadingHeaderRows, path, sectionAttrs)
    if (rowGroups) {
      const table: Table = { type: 'table', rows, rowGroups, ...(attrs ? { attrs } : {}) }
      if (listForm || !preservesTableRowGroups(table, tableSourceAttrs(table))) {
        this.context.unspellable.push({ node, path, message: 'A table with an explicit head/body/foot grouping has no Carve spelling; the written table keeps only the structure a reader derives from its rows' })
      }
    }
    // A list table has no slot for the grouping on either exit, so the AST exit
    // reports what only the writing exit reports for a pipe table.
    if (listForm && !this.context.writing) {
      for (const { node: lost, path: lostPath, message } of this.context.unspellable.splice(unspellableBefore)) {
        this.context.report.add('structure-unspellable', message, 'warning', lostPath, lost)
      }
    }
    // Whatever `rowGroups` did not place. A `<thead>` and a `<tfoot>` have no
    // slot at all - the field states the head and foot as COUNTS - and a
    // `<tbody>`'s attributes reach nothing when the field itself is not kept.
    const sectionsWithRows = new Set(tr.map((row) => group.get(row)))
    for (const [section, own] of sectionAttrs) {
      const tag = domTag(section) ?? 'tbody'
      // Unclaimed section attributes have no slot in the retained partition.
      const reason = tag !== 'tbody'
        ? 'the section cannot be represented in the retained row partition'
        : sectionsWithRows.has(section)
          ? 'the row grouping this body belongs to was not kept, and nothing else holds it'
          : 'the empty body could not be retained in the row partition'
      this.context.report.add('attribute-dropped', `Dropped ${this.context.attrNames(own.attrs).join(', ')} on <${tag}>: ${reason}`, 'warning', own.path, section)
    }
    /*
     * THE CAPTION IS NUMBERED WHERE THE AUTHOR PUT IT (PART 12 §16,
     * markup-carve/carve#1560). A step counts among ALL of the parent's child
     * nodes, and the clause's three exemptions - an item among the items, a row
     * among the rows, a cell among the cells of its row - are the whole of it,
     * because the importer reads those parents through a shape of its own. A
     * table has at most one caption, so there is nothing to renumber and no
     * exemption to claim.
     *
     * The literal `caption[1]` this replaces never consulted a position at all,
     * and what it printed was the caption's rank among the captions - the one
     * basis the clause forbids, and the reading a reader also gets from
     * resolving the path as XPath. It agreed with the child index only for a
     * table written with no whitespace: `<table>` on its own line puts a text
     * node first, so the caption is the SECOND child and `caption[1]` named a
     * node the reader does not have. The second-caption row below already
     * counted this way, so one element spoke under two bases.
     */
    const caption = captionNode
      ? this.context.captionInlines(
          captionNode,
          `${path}/caption[${captions[0]!.index + 1}]`,
          depth + 1,
        )
      : undefined
    if (listForm) {
      // A list-table row is the list of its cells, so a row with none has no spelling.
      const kept = rows.filter((row, r) => {
        if (row.cells.length > 0) return true
        this.context.report.add('structure-unspellable', 'Dropped a row with no cells: a list table row is the list of its cells', 'warning', `${path}/tr[${r + 1}]`, tr[r]!)
        return false
      })
      return listTableOf(kept, ownAlignment, caption, attrs, this.context.writing)
    }
    const separatorWidths = this.separatorWidths(node, path)
    return { type: 'table', rows, ...(separatorWidths ? { separatorWidths } : {}), ...(rowGroups ? { rowGroups } : {}), ...(caption ? { caption } : {}), ...(attrs ? { attrs } : {}) }
  }

  /**
   * `data-carve-col-widths` -> `table.separatorWidths` (PART 10 §13a).
   *
   * The attribute's PRESENCE is the distinction it restores, so an EMPTY array
   * is not a value to keep: a separator row needs at least one cell, and a tree
   * carrying `[]` would claim a row no source spells.
   *
   * THE WHOLE CARRIER IS REFUSED where any entry is not a run of decimal digits
   * or any entry exceeds `MAX_CARRIED_SEPARATOR_WIDTH` ([CARVE-P10-016]). Not a
   * partial read and not a clamp to the bound: both put a separator row on the
   * page whose widths nobody wrote, and refusing leaves the table correct in its
   * other spelling - the `|=` header form, which is what the field's absence
   * means.
   */
  private separatorWidths(node: P5Node, path: string): number[] | undefined {
    const widths = this.context.carriedSeparatorWidths(node)
    if (widths !== undefined || this.context.carrierValue(node, 'col-widths') === undefined) return widths
    this.context.report.add('attribute-dropped', 'Dropped invalid col-widths carrier on <table>', 'warning', path, node)
    return undefined
  }

}
/**
 * A cell that holds blocks a pipe-table cell would flatten: a list, a code
 * block, a quotation, a table, a definition list, or a second paragraph.
 */
function holdsBlocks(cell: P5Node): boolean {
  let paragraphs = 0
  // Iterative: the scan runs before the walk that enforces the depth limit.
  const stack = [...(domChildren(cell) ?? [])]
  while (stack.length > 0) {
    const node = stack.pop()!
    const tag = domTag(node)
    if (tag === undefined) continue
    if (tag === 'ul' || tag === 'ol' || tag === 'pre' || tag === 'blockquote' || tag === 'table' || tag === 'dl') return true
    if (tag === 'p' && ++paragraphs > 1) return true
    stack.push(...(domChildren(node) ?? []))
  }
  return false
}

const SPAN_MARKER_ITEMS = { rowspan: '^', colspan: '<' } as const

/**
 * The pipe-table grid, written as the `::: list-table` it is equivalent to
 * (docs/html-import-contract.md, "A table whose cells hold blocks can be
 * written as a list table").
 */
function listTableOf(
  rows: TableRow[],
  ownAlignment: Map<TableCell, Pick<TableCell, 'align' | 'valign'>>,
  caption: InlineNode[] | undefined,
  attrs: Attrs | undefined,
  writing: boolean,
): Admonition {
  // A placeholder is a header cell when the cell it continues is one.
  const header: boolean[][] = []
  rows.forEach((row, r) => {
    header[r] = []
    row.cells.forEach((cell, c) => {
      header[r]![c] =
        cell.span === 'rowspan' ? (header[r - 1]?.[c] ?? false)
        : cell.span === 'colspan' ? (header[r]![c - 1] ?? false)
        : cell.header
    })
  })
  const leading = (r: number): number => {
    let n = 0
    while (n < rows[r]!.cells.length && header[r]![n]) n++
    return n
  }
  let headerRows = 0
  while (headerRows < rows.length && leading(headerRows) === rows[headerRows]!.cells.length) headerRows++
  let headerCols = rows.length > headerRows ? Infinity : 0
  for (let r = headerRows; r < rows.length; r++) headerCols = Math.min(headerCols, leading(r))

  const items: ListItem[] = rows.map((row, r) => {
    const cells: ListItem[] = row.cells.map((cell, c) => {
      if (cell.span) {
        return { type: 'list_item', children: [{ type: 'paragraph', children: [{ type: 'text', value: SPAN_MARKER_ITEMS[cell.span] }] }] }
      }
      let children = cell.blocks ?? []
      const only = children.length === 1 ? children[0] : undefined
      // The escape is the writer's: a bare `^` or `<` item is a span marker. The
      // published tree holds the text, as it does for a pipe-table cell.
      if (writing && only?.type === 'paragraph' && !only.attrs && only.children.length === 1) {
        const text = only.children[0]!
        if (text.type === 'text' && !text.attrs && (text.value === '^' || text.value === '<')) {
          children = [{ ...only, children: [{ type: 'escaped_text', value: text.value }] }]
        }
      }
      const keyValues: Record<string, string> = { ...cell.attrs?.keyValues }
      const order = cell.attrs?.order ? [...cell.attrs.order] : undefined
      const put = (key: string, value: string | undefined): void => {
        if (value === undefined || key in keyValues) return
        keyValues[key] = value
        order?.push(key)
      }
      if (cell.header && r >= headerRows && c >= headerCols) put('header', '')
      const own = ownAlignment.get(cell)
      put('align', own?.align)
      put('valign', own?.valign)
      const itemAttrs: Attrs = {
        ...cell.attrs,
        ...(Object.keys(keyValues).length > 0 ? { keyValues } : {}),
        ...(order ? { order } : {}),
      }
      const hasAttrs = itemAttrs.id !== undefined || (itemAttrs.classes?.length ?? 0) > 0 || itemAttrs.keyValues !== undefined
      return { type: 'list_item', children, ...(hasAttrs ? { attrs: itemAttrs } : {}) }
    })
    const tight = !cells.some((item) => item.children.length > 1)
    return { type: 'list_item', children: [{ type: 'list', ordered: false, tight, items: cells }] }
  })

  const keyValues: Record<string, string> = { ...attrs?.keyValues }
  const order = attrs?.order ? [...attrs.order] : undefined
  const count = (key: string, n: number): void => {
    if (n <= 0) return
    keyValues[key] = String(n)
    order?.push(key)
  }
  count('header-rows', headerRows)
  count('header-cols', headerCols)
  const tableAttrs: Attrs = { ...attrs, ...(Object.keys(keyValues).length > 0 ? { keyValues } : {}), ...(order ? { order } : {}) }
  const hasAttrs = tableAttrs.id !== undefined || (tableAttrs.classes?.length ?? 0) > 0 || tableAttrs.keyValues !== undefined
  return {
    type: 'admonition',
    kind: 'list-table',
    ...(caption && caption.length > 0 ? { title: caption } : {}),
    children: [{ type: 'list', ordered: false, tight: true, items }],
    ...(hasAttrs ? { attrs: tableAttrs } : {}),
  }
}
