import type { Document, Position } from '../ast.js'

const PREFIX = /[ \t]*> ?|[ \t]*: +|[ \t]*\[\^[^\]]+\]: +|[ \t]*(?:[-*.]|[0-9]+[.)]|[a-zA-Z]+[.)]) /y
const ITEM_MARKER = /([ \t]*)([-*.]|[0-9]+[.)]|[a-zA-Z]+[.)])(?:\{[^}]*\})?( +)/y
const DESCRIPTION_MARKER = /: +/y

/**
 * Start each list, list item and description at its owner's content column
 * (CARVE-P12-013, carve#5063, carve#5976): the leading indentation on its opening line is inside the span,
 * from the column where the owning item, description, footnote or fence puts
 * its content. Runs on codepoint offsets, after `toCodepointPositions`.
 * Per-line tables keep it linear in deeply nested lines.
 */
export function anchorListsAtOwnerColumns(doc: Document, source: string): void {
  let built = false
  const astral = /[\ud800-\udbff]/.test(source)
  // Codepoint offset to UTF-16 index and back; identity for BMP-only input.
  const toUnit: number[] = []
  const toPoint = new Uint32Array(astral ? source.length + 1 : 0)
  const lineStarts: number[] = [0]
  let length = 0
  // Built on the first list, so a document without one pays nothing.
  const build = (): void => {
    built = true
    let point = 0
    for (let unit = 0; unit < source.length; unit++) {
      if (astral) {
        toUnit[point] = unit
        toPoint[unit] = point
      }
      const code = source.charCodeAt(unit)
      if (astral && code >= 0xd800 && code <= 0xdbff) {
        const low = source.charCodeAt(unit + 1)
        if (low >= 0xdc00 && low <= 0xdfff) toPoint[++unit] = point
      }
      point++
      if (code === 10 || (code === 13 && source.charCodeAt(unit + 1) !== 10)) lineStarts.push(point)
    }
    if (astral) {
      toUnit[point] = source.length
      toPoint[source.length] = point
    }
    length = point
  }
  const unitOf = (offset: number): number => astral ? toUnit[offset]! : offset
  const pointOf = (unit: number): number => astral ? toPoint[unit]! : unit
  const charAt = (offset: number): string => source[unitOf(offset)]!
  const isBlank = (offset: number): boolean => charAt(offset) === ' ' || charAt(offset) === '\t'

  const lineOf = (offset: number): number => {
    let low = 0
    let high = lineStarts.length - 1
    while (low < high) {
      const mid = (low + high + 1) >> 1
      if (lineStarts[mid]! <= offset) low = mid
      else high = mid - 1
    }
    return low
  }
  // `columns` is null on a line without a tab, where a column is its offset from the line start.
  interface Line { start: number; width: number; columns: number[] | null; prefixEnds: number[] }
  const columnAt = (entry: Line, index: number): number =>
    entry.columns ? entry.columns[index] ?? 0 : index >= 0 && index <= entry.width ? index : 0
  const lines = new Map<number, Line>()
  const line = (offset: number): Line => {
    const index = lineOf(offset)
    let entry = lines.get(index)
    if (entry) return entry
    const start = lineStarts[index]!
    const end = index + 1 < lineStarts.length ? lineStarts[index + 1]! : length
    let columns: number[] | null = null
    for (let at = start; at < end; at++) {
      if (charAt(at) !== '\t') continue
      columns = [0]
      for (let k = start, column = 0; k < end; k++) {
        column = charAt(k) === '\t' ? column + (4 - column % 4) : column + 1
        columns.push(column)
      }
      break
    }
    const prefixEnds = [start]
    PREFIX.lastIndex = unitOf(start)
    for (let match = PREFIX.exec(source); match && match[0] !== ''; match = PREFIX.exec(source)) {
      prefixEnds.push(pointOf(PREFIX.lastIndex))
    }
    entry = { start, width: end - start, columns, prefixEnds }
    lines.set(index, entry)
    return entry
  }
  const visualColumn = (offset: number): number => {
    if (!built) build()
    const entry = line(offset)
    return columnAt(entry, offset - entry.start)
  }
  const openerColumn = (pos: Position | undefined): number | null => {
    if (typeof pos?.startOffset !== 'number') return null
    if (!built) build()
    return pos.startOffset <= length ? visualColumn(pos.startOffset) : null
  }
  const itemColumn = (pos: Position | undefined): number | null => {
    if (!built) build()
    if (typeof pos?.startOffset !== 'number' || pos.startOffset > length) return null
    ITEM_MARKER.lastIndex = unitOf(pos.startOffset)
    const marker = ITEM_MARKER.exec(source)
    return marker ? visualColumn(pos.startOffset + marker[1]!.length) + marker[2]!.length + marker[3]!.length : null
  }
  const descriptionColumn = (pos: Position | undefined): number | null => {
    if (!built) build()
    if (typeof pos?.startOffset !== 'number' || pos.startOffset > length) return null
    DESCRIPTION_MARKER.lastIndex = unitOf(pos.startOffset)
    const separator = DESCRIPTION_MARKER.exec(source)
    return separator ? visualColumn(pos.startOffset) + separator[0].length : null
  }
  const anchor = (pos: Position | undefined, owner: number | null): void => {
    if (!built) build()
    if (typeof pos?.startOffset !== 'number' || pos.startOffset > length) return
    let at = pos.startOffset
    while (at < length && isBlank(at)) at++
    const entry = line(pos.startOffset)
    const { start, prefixEnds } = entry
    let runStart = at
    while (runStart > start && isBlank(runStart - 1)) runStart--
    // The prefixes the line opens with, cut at the marker: text past them is content, not indentation.
    let prefixEnd = start
    for (const end of prefixEnds) if (end <= at) prefixEnd = end
    if (prefixEnd < runStart) return
    const column = owner ?? 0
    if (columnAt(entry, at - start) < column) return
    let offset = prefixEnd
    while (offset < at && columnAt(entry, offset + 1 - start) <= column) offset++
    pos.startOffset = offset
    if (pos.startColumn !== undefined) pos.startColumn = offset - start + 1
  }
  const walk = (value: unknown, owner: number | null): void => {
    if (Array.isArray(value)) {
      for (const item of value) walk(item, owner)
      return
    }
    if (!value || typeof value !== 'object') return
    const node = value as Record<string, unknown> & { type?: string; pos?: Position }
    switch (node.type) {
      case 'list':
        anchor(node.pos, owner)
        for (const item of (node['items'] as Array<{ pos?: Position; children?: unknown }> | undefined) ?? []) {
          anchor(item.pos, owner)
          walk(item.children, itemColumn(item.pos))
        }
        return
      case 'definition_list':
        for (const item of (node['items'] as Array<{ definitions?: unknown[][]; definitionSpans?: (Position | undefined)[] }> | undefined) ?? []) {
          ;(item.definitions ?? []).forEach((definition, index) => {
            const span = item.definitionSpans?.[index] ?? (definition[0] as { pos?: Position } | undefined)?.pos
            walk(definition, descriptionColumn(span))
            // A description is a container too (carve#5976).
            if (item.definitionSpans?.[index]) anchor(item.definitionSpans[index], owner)
          })
        }
        return
      case 'div':
      case 'admonition':
        walk(node['children'], openerColumn(node.pos))
        return
      case 'block_quote':
        walk(node['children'], node['fenced'] === true ? openerColumn(node.pos) : owner)
        return
      case 'section':
      case 'line_block':
      case 'figure_group':
      case 'directive':
        walk(node['children'], owner)
        return
      case 'figure':
        walk(node['target'], owner)
        return
      case 'table':
        for (const row of (node['rows'] as Array<{ cells: Array<{ blocks?: unknown }> }>)) {
          for (const cell of row.cells) if (cell.blocks) walk(cell.blocks, owner)
        }
        return
      case 'heading':
      case 'paragraph':
      case 'code_block':
      case 'thematic_break':
      case 'image':
      case 'abbreviation_def':
      case 'link_reference_definition':
      case 'citation_definition':
      case 'raw_block':
      case 'comment':
        return
    }
    for (const [key, child] of Object.entries(node)) {
      if (key !== 'pos' && child && typeof child === 'object') walk(child, owner)
    }
  }
  walk(doc.children, null)
  const notes = doc.footnoteDefPos
  for (const [label, blocks] of Object.entries(doc.footnoteDefs ?? {})) {
    const column = openerColumn(notes?.[label])
    walk(blocks, column === null ? null : column + 2)
  }
}
