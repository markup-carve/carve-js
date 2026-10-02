import type { Document, Position, Table } from './ast.js'
import { codeTerminated } from './verbatim-payload.js'
import { SourceUnspellableError } from './source-unspellable-error.js'

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

function preservesRowGroupPartition(table: Table): boolean {
  const groups = table.rowGroups!
  const kv = table.attrs?.keyValues
  if (kv?.['header-rows'] === undefined && kv?.['footer-rows'] === undefined) return false
  const rowCount = (value: string | undefined): number | undefined => {
    if (value === undefined) return 0
    if (value.trim() === '') return 1
    return /^\d+$/.test(value.trim()) ? Number(value.trim()) : undefined
  }
  const headRows = rowCount(kv?.['header-rows'])
  const footRows = rowCount(kv?.['footer-rows'])
  if (headRows === undefined || footRows === undefined || headRows + footRows > table.rows.length) return false
  const body = groups.bodies[0]
  return body !== undefined && groups.headRows === headRows && groups.footRows === footRows && groups.bodies.length === 1
    && body.headRows === 0 && body.bodyRows === table.rows.length - headRows - footRows
    && body.rowHeadColumns === undefined
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
  const stack: Array<{ value: unknown; inlineOnly: boolean }> = [{ value: ast, inlineOnly: false }]
  while (stack.length) {
    const { value, inlineOnly } = stack.pop()!
    if (Array.isArray(value)) { for (let i = value.length - 1; i >= 0; i--) stack.push({ value: value[i], inlineOnly }); continue }
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
    if (type === 'paragraph' && Array.isArray(node.children) && node.children.length === 1 && ['image', 'comment'].includes((node.children[0] as { type?: string }).type ?? '')) report('structure-unspellable', 'Carve source spells the paragraph content as a block')
    if ((type === 'figure' || type === 'table') && node.shortCaption !== undefined) report('field-unspellable', 'Carve source cannot spell a short caption', 'shortCaption')
    if (type === 'figure' && (node.target as { type?: string } | undefined)?.type === 'table') report('structure-unspellable', 'Carve source cannot spell a figure wrapper around a table')
    if (type === 'table' && node.rowGroups) {
      if (!preservesRowGroupPartition(node as unknown as Table)) {
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
    if (type === 'table_cell' && node.blocks !== undefined) report('field-unspellable', 'Carve table cells cannot hold blocks', 'blocks')
    // A canonical fence needs a break before its closer, so a payload that ends
    // mid-line gains one on the way out (CARVE-P12-064).
    if (type === 'code_block' && typeof node.content === 'string' && !codeTerminated(node.content)) report('field-unspellable', 'Carve source cannot spell a code payload without a final line break', 'content')
    if (type === 'math' && node.label !== undefined) report('field-unspellable', 'Carve source cannot spell an equation label', 'label')
    if (type === 'math' && node.number !== undefined) report('field-unspellable', 'Carve source cannot spell an equation number', 'number')
    for (const [key, child] of Object.entries(node)) {
      if (key === 'pos' || key === 'attrs' || key === 'payload' || key === 'shortCaption') continue
      stack.push({ value: child, inlineOnly: inlineOnly || key === 'caption' || (type === 'table_cell' && key === 'children') })
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
