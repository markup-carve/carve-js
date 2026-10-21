import type { Lexer } from './parse-lexer.js'
import type { InlineSource } from './parse.js'
import type { LinkDef } from './inline-resolution.js'
import type { Attrs, Figure, InlineNode, Position, Table, TableCell, TableRow } from './ast.js'

type RawCell = Parameters<typeof import('./parse.js').tableBlockHelpers.joinFragment>[0]

export interface TableBlockHost {
  parseInline(text: string, abbrDefs: Map<string, string>, linkDefs?: Map<string, LinkDef>, source?: InlineSource, captionContext?: boolean): InlineNode[]
  recordAttachedCaption(lexer: Lexer, index: number): void
  parseCaptionInline(lexer: Lexer, firstLine: string): InlineNode[]
}

export function createTableBlockParser(helpers: typeof import('./parse.js').tableBlockHelpers) {
  const { RE_CAPTION, RE_TABLE_CONT, inlineSource, isBlankLine, isGfmDelimiterRow, isTableRow, joinFragment, openVerbatimRun, parseCellMarkers, resolveSpanGrid, rowAttrsFromLine, splitTableRowSpans, stripPositions, stripPositionsOutsideRow, trimCellPadding } = helpers

  return function parseTable(host: TableBlockHost, lexer: Lexer): Table | Figure {
    // Collect raw cell source first; a `+` continuation row appends its
    // non-empty fragments to the previous row's *source* so an inline
    // construct spanning the line boundary is one logical cell. Inline
    // parsing happens once, after merging.
    const rawRows: RawCell[][] = []
    const continuationCounts: number[] = []
    const rowAttrsList: (Attrs | undefined)[] = []
    /** Where a row BEGINS, by row index - its own line, not its first cell's. */
    const rowStarts: Array<{ line: number; column: number; offset: number } | undefined> = []
    /** Where a row ENDS once `+` continuations have extended it, by row index. */
    const rowEnds: Array<{ line: number; column: number; offset: number } | undefined> = []
    let lastRaw: RawCell[] | null = null
    while (
      !lexer.eof() &&
      (isTableRow(lexer.peek()!) || RE_TABLE_CONT.test(lexer.peek()!))
    ) {
      const line = lexer.peek()!
      const lineIndex = lexer.pos
      if (RE_TABLE_CONT.test(line)) {
        if (!lastRaw) break // a continuation with no row to extend
        if (
          rawRows.length === 2 &&
          rawRows[1] === lastRaw &&
          isGfmDelimiterRow(lastRaw) &&
          !isGfmDelimiterRow(rawRows[0]!)
        )
          break
        lexer.consume()
        const continuationLine = ++continuationCounts[rawRows.length - 1]!
        // A row that continues still occupies a CONTIGUOUS run of lines, and no
        // sibling row overlaps it - so unlike its cells, the row can be placed.
        // Recording where it now ends is what makes that possible.
        rowEnds[rawRows.length - 1] = {
          line: lexer.lineNumber(lineIndex),
          column: lexer.lineStartColumn(lineIndex) + line.length,
          offset: lexer.lineOffset(lineIndex) + line.length,
        }
        const contOffset = lexer.lineOffset(lineIndex)
        const contLine = lexer.lineNumber(lineIndex)
        const contColumn = lexer.lineStartColumn(lineIndex)
        const contCanPosition = lexer.hasDocumentOffsets
        const markerIndex = line.indexOf('+')
        const marker = contCanPosition && markerIndex >= 0
          ? { offset: contOffset + markerIndex, line: contLine, column: contColumn + markerIndex }
          : null
        splitTableRowSpans(line, lastRaw.map((c) => c.openRun)).forEach(({ text: src, start }, idx) => {
          const frag = trimCellPadding(src)
          const target: RawCell | undefined = lastRaw![idx]
          if (!frag || !target) return
          const within = contCanPosition ? src.indexOf(frag) : -1
          const at =
            within >= 0 && line.slice(start + within, start + within + frag.length) === frag
              ? { offset: contOffset + start + within, line: contLine, column: contColumn + start + within }
              : null
          const sep = contCanPosition && idx > 0 ? { offset: contOffset + start - 1, line: contLine, column: contColumn + start - 1 } : null
          if (target.span) {
            // The text belongs to the cell the marker resolves into, which only
            // the span walk below can name (T6).
            target.openRun = openVerbatimRun(frag, target.openRun)
            ;(target.joins ??= []).push({ frag, at, marker, sep, line: continuationLine, rowIndex: rawRows.length - 1 })
            return
          }
          joinFragment(target, frag, at, continuationLine, undefined, marker, sep)
        })
        continue
      }
      lexer.consume()
      const { attrs: rowAttrs, body: rowBody } = rowAttrsFromLine(line)
      // Positions are only emitted when this lexer can express a document offset.
      // Verifying the content against the local line is not enough: inside an
      // unmapped container the check passes while the offset means something else.
      const canPosition = lexer.hasDocumentOffsets
      const lineOffset = lexer.lineOffset(lineIndex)
      const lineNo = lexer.lineNumber(lineIndex)
      const lineCol = lexer.lineStartColumn(lineIndex)
      const raw: RawCell[] = splitTableRowSpans(rowBody).map(({ text: src, start }) => {
        const { header, span, align, valign, attrs, content } = parseCellMarkers(src)
        const c: RawCell = { header, raw: content, openRun: openVerbatimRun(content) }
        if (span) c.span = span
        if (align) c.align = align
        if (valign) c.valign = valign
        if (attrs) c.attrs = attrs
        if (canPosition) {
          c.pos = {
            startLine: lineNo,
            endLine: lineNo,
            startColumn: lineCol + start,
            endColumn: lineCol + start + src.length,
            startOffset: lineOffset + start,
            endOffset: lineOffset + start + src.length,
          }
        }
        // Anchor the cell's inline content, but only after checking the content is
        // where we think it is. `\|` unescapes to one character, so a cell holding
        // an escaped pipe is not a verbatim slice and gets no anchor.
        const within = content === '' || !canPosition ? -1 : src.indexOf(content)
        if (within >= 0 && rowBody.slice(start + within, start + within + content.length) === content) {
          c.anchors = [
            {
              from: 0,
              to: content.length,
              offset: lineOffset + start + within,
              line: lineNo,
              column: lineCol + start + within,
            },
          ]
        }
        return c
      })
      rawRows.push(raw)
      continuationCounts.push(0)
      rowAttrsList.push(rowAttrs)
      // The row's own extent, independent of whether its cells keep theirs. A row
      // whose every cell continues has no cell span to start from, and it still
      // occupies these lines.
      rowStarts[rawRows.length - 1] = canPosition
        ? { line: lineNo, column: lineCol, offset: lineOffset }
        : undefined
      rowEnds[rawRows.length - 1] = canPosition
        ? {
            line: lineNo,
            column: lineCol + line.length,
            offset: lineOffset + line.length,
          }
        : undefined
      lastRaw = raw
    }
    // GFM-style header separator: when the SECOND row is a delimiter row -- every
    // cell a run of dashes with optional alignment colons (`---`, `:--`, `--:`,
    // `:-:`) -- the first row becomes the header (rendered in <thead>) and the
    // colons set per-column alignment for the whole column. The delimiter row is
    // dropped. This is in addition to Carve's tight per-cell markers `|=`/`|<`; a
    // delimiter row anywhere else is an ordinary data row.
    // A cell carrying author attributes (`|{.x} ---`) is content, not a plain
    // structural delimiter, so it never makes its row a GFM header separator.
    let separatorWidths: number[] | undefined
    if (
      rawRows.length >= 2 &&
      isGfmDelimiterRow(rawRows[1]!) &&
      !isGfmDelimiterRow(rawRows[0]!)
    ) {
      const aligns = rawRows[1]!.map((c) => {
        // DOMINATED, and narrowed anyway. `isGfmDelimiterCell` above already
        // required `/^:?-+:?$/` of the SAME space-trimmed string, so a cell whose
        // padding is not a space has already stopped the row from being a
        // delimiter row and never reaches here - reverting this one site to the
        // wider trim cannot change the answer. It is narrowed regardless, because
        // one rule spelled two ways is how this class of defect starts: the
        // domination is a property of the code above, not of the rule.
        const t = trimCellPadding(c.raw)
        const left = t.startsWith(':')
        const right = t.endsWith(':')
        return left && right ? 'center' : right ? 'right' : left ? 'left' : undefined
      })
      // PART 12 §3 / [CARVE-P11-066]: the dash runs AS AUTHORED, colons
      // excluded, recorded before the row is dropped. The presence of the array
      // is what says a separator row was written at all, so it is recorded even
      // where every run is the canonical three.
      separatorWidths = rawRows[1]!.map((c) => {
        const t = trimCellPadding(c.raw)
        return t.length - (t.startsWith(':') ? 1 : 0) - (t.endsWith(':') ? 1 : 0)
      })
      rawRows.splice(1, 1)
      continuationCounts.splice(1, 1)
      rowAttrsList.splice(1, 1)
      rowStarts.splice(1, 1)
      rowEnds.splice(1, 1)
      for (const c of rawRows[0]!) c.header = true
      // Column alignment lands on the HEADER cells only, matching what the native
      // `|=<` markers produce. Propagating it onto body cells too made the same
      // logical table parse to two different trees depending on which separator
      // syntax was used, and the writer then serialized the propagated values as
      // per-cell markers the author never wrote (carve#352, corpus 09-tables-3).
      //
      // Nothing is lost: the HTML renderer already inherits column alignment for a
      // body cell whose own align is unset, which is how the native path has always
      // rendered aligned body cells. A genuine per-cell override still sets
      // `c.align` itself and is untouched here.
      rawRows[0]!.forEach((c, i) => {
        const a = aligns[i]
        if (a && !c.align) c.align = a
      })
    }
    if (rawRows.some((rc) => rc.some((c) => c.joins))) {
      // A blocked marker remains a span cell and holds its joined text.
      const grid = rawRows.map((rc, rowIndex) => rc.map((cell) => ({ cell, rowIndex, rowspan: 1, colspan: 1, skip: false })))
      const blocked = new Set<RawCell>()
      const keepBlocked = (cell: RawCell): void => {
        if (!cell.span || blocked.has(cell)) return
        blocked.add(cell)
        delete cell.anchors
        delete cell.wraps
        delete cell.lastMarker
        cell.raw = ''
        cell.openRun = 0
        for (const { frag, at, marker: point, sep, line } of cell.joins ?? []) joinFragment(cell, frag, at, line, undefined, point, sep)
      }
      resolveSpanGrid(
        grid,
        (e) => (e.cell.span === 'rowspan' ? '^' : e.cell.span === 'colspan' ? '<' : null),
        (origin, marker) => {
          if (!marker.cell.joins?.length) return
          keepBlocked(origin.cell)
          for (const { frag, at, marker: point, sep, line } of marker.cell.joins) joinFragment(origin.cell, frag, at, line, marker.rowIndex - origin.rowIndex, point, sep, grid[marker.rowIndex]!.indexOf(marker) - grid[origin.rowIndex]!.indexOf(origin))
        },
      )
      for (const row of grid) for (const e of row) if (!e.skip && e.cell.joins?.length) keepBlocked(e.cell)
    }
    const rows: TableRow[] = rawRows.map((rc, idx) => {
      const row: TableRow = {
        type: 'table_row',
        ...(continuationCounts[idx] ? { continuationLines: continuationCounts[idx] } : {}),
        cells: rc.map((c) => {
          const cellWraps = c.wraps?.length
            ? new Map(c.wraps.map(wrap => [wrap.offset, { line: wrap.line, ...(wrap.row ? { row: wrap.row } : {}), ...(wrap.col ? { col: wrap.col } : {}), ...(wrap.pos ? { pos: wrap.pos } : {}) }]))
            : undefined
          const children = c.span && !c.raw ? [] : c.anchors?.length
            ? host.parseInline(c.raw, lexer.abbrDefs, lexer.linkDefs, inlineSource({
                baseOffset: c.anchors[0]!.offset,
                startLine: c.anchors[0]!.line,
                startColumn: c.anchors[0]!.column,
                anchoredRanges: c.anchors,
                ...(cellWraps ? { cellWraps } : {}),
              }))
            : host.parseInline(c.raw, lexer.abbrDefs, lexer.linkDefs, inlineSource({
                ...(cellWraps ? { cellWraps } : {}),
              }))
          // Empty earlier continuation lines have no fragment to join. The
          // first text fragment still names its own continuation line.
          if (c.span && c.joins?.[0]?.line && c.joins[0].line > 1 && children.length) {
            children.unshift({ type: 'cell_wrap', line: c.joins[0].line })
          }
          const cell: TableCell = {
            type: 'table_cell',
            header: c.header,
            children: !c.anchors?.length ? stripPositions(children) : children,
          }
          if (c.span) cell.span = c.span
          if (c.align) cell.align = c.align
          if (c.valign) cell.valign = c.valign
          if (c.attrs) cell.attrs = c.attrs
          if (c.pos) cell.pos = c.pos
          return cell
        }),
      }
      // A row owns its complete source line, including its pipe delimiters.
      //
      // A `+` continuation breaks that, because the extended cell loses its own
      // span - its content sits in two column ranges on non-adjacent lines. The
      // ROW is still one contiguous range that no sibling row overlaps, so it is
      // placed from where it starts to where the continuation leaves it. Only
      // when every cell continued does the start come from the row's own line
      // rather than a cell, since there is no cell span left to take it from.
      const spans = rc.map((c) => c.pos)
      const end = rowEnds[idx]
      if (end) {
        const first = rowStarts[idx] ?? spans.find(Boolean)
        const startLine = 'startLine' in (first ?? {}) ? (first as Position).startLine : undefined
        const rowStart = first
          ? 'line' in first
            ? { line: first.line, column: first.column, offset: first.offset }
            : {
                line: startLine!,
                column: (first as Position).startColumn!,
                offset: (first as Position).startOffset!,
              }
          : undefined
        if (rowStart) {
          row.pos = {
            startLine: rowStart.line,
            endLine: end.line,
            startColumn: rowStart.column,
            endColumn: end.column,
            startOffset: rowStart.offset,
            endOffset: end.offset,
          }
        }
      } else {
        const first = spans[0]
        const last = spans[spans.length - 1]
        if (
          first &&
          last &&
          spans.every(Boolean) &&
          first.startColumn !== undefined &&
          last.endColumn !== undefined &&
          first.startOffset !== undefined &&
          last.endOffset !== undefined
        ) {
          row.pos = {
            startLine: first.startLine,
            endLine: last.endLine,
            startColumn: first.startColumn,
            endColumn: last.endColumn,
            startOffset: first.startOffset,
            endOffset: last.endOffset,
          }
        }
      }
      const ra = rowAttrsList[idx]
      if (ra) row.attrs = ra
      if (row.pos?.startOffset !== undefined && row.pos.endOffset !== undefined) {
        for (const cell of row.cells) stripPositionsOutsideRow(cell.children ?? [], row.pos.startOffset, row.pos.endOffset)
      }
      return row
    })
    const table: Table = { type: 'table', rows }
    if (separatorWidths !== undefined) table.separatorWidths = separatorWidths
    // Optional caption ^ ...
    let lookahead = 0
    while (!lexer.eof() && isBlankLine(lexer.peek(lookahead))) lookahead++
    const next = lexer.peek(lookahead)
    if (next) {
      const cap = RE_CAPTION.exec(next)
      // §4: a caption attaches only when it immediately follows the block
      // or is separated by at most ONE blank line.
      if (cap && lookahead <= 1) {
        host.recordAttachedCaption(lexer, lexer.pos + lookahead)
        for (let i = 0; i <= lookahead; i++) lexer.consume()
        table.caption = host.parseCaptionInline(lexer, cap[1]!)
      }
    }
    return table
  }
}
