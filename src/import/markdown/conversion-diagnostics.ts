import { tableSourceAttrs, tableNeedsDelimiterHeader, preservesTableRowGroups, preservesTableColumns } from '../../table/table-source-metadata.js'
import type { Document, Position, Table } from '../../ast.js'
import { codeTerminated } from '../../verbatim-payload.js'
import { SourceUnspellableError } from '../../source/source-unspellable-error.js'

export interface ConversionDiagnostic {
  code: 'structure-unspellable' | 'field-unspellable'
  node: string
  field?: string
  message: string
  pos?: Required<Pick<Position, 'startLine' | 'endLine' | 'startColumn' | 'endColumn' | 'startOffset' | 'endOffset'>>
}
export interface ConversionDiagnostics {
  diagnostics: ConversionDiagnostic[]
  totalDiagnostics: number
  truncated: boolean
}
export interface CarveConversionResult {
  value?: string
  report: ConversionDiagnostics
}

function wirePos(value: unknown): ConversionDiagnostic['pos'] | undefined {
  if (!value || typeof value !== 'object') return undefined
  const pos = value as Position
  if (![pos.startLine, pos.endLine, pos.startColumn, pos.endColumn].every((part) => Number.isSafeInteger(part) && part! >= 1)) return undefined
  if (![pos.startOffset, pos.endOffset].every((part) => Number.isSafeInteger(part) && part! >= 0)) return undefined
  return { startLine: pos.startLine, endLine: pos.endLine, startColumn: pos.startColumn!, endColumn: pos.endColumn!, startOffset: pos.startOffset!, endOffset: pos.endOffset! }
}

/** Report AST structures and fields the canonical writer cannot spell. */
export function renderCarveWithConversionReport(
  ast: Document,
  render: (ast: Document) => string,
  maxDiagnostics = 100,
): CarveConversionResult {
  if (!Number.isSafeInteger(maxDiagnostics) || maxDiagnostics < 0) throw new RangeError('maxDiagnostics must be a nonnegative integer')
  const diagnostics: ConversionDiagnostic[] = []
  let totalDiagnostics = 0
  const add = (entry: ConversionDiagnostic): void => {
    totalDiagnostics++
    if (diagnostics.length < maxDiagnostics) diagnostics.push(entry)
  }
  const preservedHeaderCells = new WeakSet<object>()
  const stack: Array<{ value: unknown; inlineOnly: boolean; directCellChildren: boolean; listDepth: number; hosted: boolean }> = [{ value: ast, inlineOnly: false, directCellChildren: false, listDepth: 0, hosted: false }]
  while (stack.length) {
    const { value, inlineOnly, directCellChildren, listDepth, hosted } = stack.pop()!
    if (Array.isArray(value)) { for (let i = value.length - 1; i >= 0; i--) stack.push({ value: value[i], inlineOnly: inlineOnly && !(directCellChildren && i === value.length - 1 && value[i]?.type === 'hard_break'), directCellChildren: false, listDepth, hosted }); continue }
    if (!value || typeof value !== 'object') continue
    const node = value as Record<string, unknown>
    const type = node.type
    const pos = wirePos(node.pos)
    const report = (code: ConversionDiagnostic['code'], message: string, field?: string): void => add({ code, node: type as string, message, ...(field ? { field } : {}), ...(pos ? { pos } : {}) })
    if (type === 'section') report('structure-unspellable', 'Carve source cannot spell an explicit section')
    if (type === 'block_extension') report('structure-unspellable', 'Carve source can only spell the block extension fallback')
    if (type === 'small_caps') report('structure-unspellable', 'Carve source cannot spell small caps')
    if (type === 'ruby') report('structure-unspellable', 'Carve source cannot spell ruby annotations')
    if (type === 'hard_break' && inlineOnly) report('structure-unspellable', 'Carve source cannot spell a hard break in a single-line slot')
    if (type === 'link_reference_definition' && node.href === '') {
      if (node.title !== undefined) report('field-unspellable', 'An empty reference definition cannot spell a title', 'title')
      if (node.attrs && typeof node.attrs === 'object' && Object.keys(node.attrs).length > 0) {
        report('field-unspellable', 'An empty reference definition cannot spell attributes', 'attrs')
      }
    }
    if (type === 'paragraph' && Array.isArray(node.children) && node.children.length === 1 && ['image', 'comment'].includes((node.children[0] as { type?: string }).type ?? '')) report('structure-unspellable', 'Carve source spells the paragraph content as a block')
    if (type === 'list' && node.tight === true && Array.isArray(node.items)) {
      for (const item of node.items as Array<{ children?: Array<{ type?: string }>; pos?: Position }>) {
        if (listDepth === 0 && !hosted) continue
        if (!Array.isArray(item.children) || !item.children.some((child, index) => index > 0 && child.type === 'paragraph' && (item.children?.[index - 1]?.type === 'block_quote' || item.children?.[index - 1]?.type === 'list'))) continue
        const itemPos = wirePos(item.pos)
        add({ code: 'structure-unspellable', node: 'list_item', message: 'Carve source writes this nested tight item loose to preserve its blocks', ...(itemPos ? { pos: itemPos } : {}) })
      }
    }
    if ((type === 'figure' || type === 'table') && node.shortCaption !== undefined) report('field-unspellable', 'Carve source cannot spell a short caption', 'shortCaption')
    if (type === 'figure' && (node.target as { type?: string } | undefined)?.type === 'table') report('structure-unspellable', 'Carve source cannot spell a figure wrapper around a table')
    if (type === 'table' && tableNeedsDelimiterHeader(node as unknown as Table)) {
      for (const cell of (node as unknown as Table).rows[0]!.cells) preservedHeaderCells.add(cell)
    }
    if (type === 'table' && (node.columns as unknown[] | undefined)?.length) {
      const table = node as unknown as Table
      if (!preservesTableColumns(table, tableSourceAttrs(table))) {
        report('field-unspellable', 'The canonical Carve writer cannot preserve these table columns with the retained attributes', 'columns')
      }
    }
    if (type === 'table' && node.rowGroups) {
      const table = node as unknown as Table
      if (!preservesTableRowGroups(table, tableSourceAttrs(table))) {
        report('field-unspellable', 'The canonical Carve writer cannot preserve this explicit table row-group partition', 'rowGroups')
      }
      const groups = node.rowGroups as { headAttrs?: object; footAttrs?: object; bodies: Array<{ attrs?: object }> }
      const fields: Array<[string, object | undefined]> = [
        ['rowGroups.headAttrs', groups.headAttrs], ['rowGroups.footAttrs', groups.footAttrs],
        ...groups.bodies.map((body, i): [string, object | undefined] => [`rowGroups.bodies[${i}].attrs`, body.attrs]),
      ]
      for (const [field, attrs] of fields) {
        if (attrs && Object.values(attrs).some((value: unknown) => typeof value === 'string' || (value !== null && typeof value === 'object' && Object.keys(value).length > 0))) {
          report('field-unspellable', 'Carve source cannot spell table section attributes', field)
        }
      }
    }
    if (type === 'table_cell' && node.span !== undefined && node.header === true && !preservedHeaderCells.has(node)) report('field-unspellable', 'Carve span markers cannot preserve a placeholder cell’s header flag', 'header')
    if (type === 'table_cell' && node.blocks !== undefined) report('field-unspellable', 'Carve table cells cannot hold blocks', 'blocks')
    // A canonical fence needs a break before its closer, so a payload that ends
    // mid-line gains one on the way out (CARVE-P12-064).
    if (type === 'code_block' && typeof node.content === 'string' && !codeTerminated(node.content)) report('field-unspellable', 'Carve source cannot spell a code payload without a final line break', 'content')
    if (type === 'raw_block' && typeof node.content === 'string' && !codeTerminated(node.content)) report('field-unspellable', 'Carve source cannot spell a raw payload without a final line break', 'content')
    if (type === 'math' && node.label !== undefined) report('field-unspellable', 'Carve source cannot spell an equation label', 'label')
    if (type === 'math' && node.number !== undefined) report('field-unspellable', 'Carve source cannot spell an equation number', 'number')
    for (const [key, child] of Object.entries(node)) {
      if (key === 'pos' || key === 'attrs' || key === 'payload' || key === 'shortCaption') continue
      stack.push({ value: child, inlineOnly: type === 'table_cell' && node.span !== undefined ? false : inlineOnly || (type === 'table_cell' && (key === 'children' || key === 'blocks')), directCellChildren: type === 'table_cell' && key === 'children' && node.span === undefined, listDepth: listDepth + (type === 'list' ? 1 : 0), hosted: hosted || (type === 'definition_list' && key === 'items') || (type === 'document' && key === 'footnoteDefs') })
    }
  }
  let output: string | undefined
  try { output = render(ast) }
  catch (error) {
    if (!(error instanceof SourceUnspellableError)) throw error
    const pos = wirePos((error.node as { pos?: unknown } | undefined)?.pos)
    add({ code: 'structure-unspellable', node: error.nodeType, message: error.reason, ...(pos ? { pos } : {}) })
  }
  return { ...(output === undefined ? {} : { value: output }), report: { diagnostics, totalDiagnostics, truncated: totalDiagnostics > diagnostics.length } }
}
