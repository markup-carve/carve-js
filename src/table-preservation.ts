import { fromAstJson, toAstJson, type AstJsonDocument } from './ast-json.js'
import { ALL_OWNED_CHILD_FIELDS as AST_CHILD_FIELDS } from './owned-child-fields.js'

export type PreservationTarget = 'html' | 'markdown' | 'plain' | 'ansi'
export interface PreservationDiagnostic {
  code: 'table-field-degraded'
  path: string
  field: string
  message: string
}
export interface TablePreservationReport {
  assessment: 'table-structure-v1'
  target: PreservationTarget
  complete: false
  checked: readonly string[]
  unchecked: readonly string[]
  diagnostics: PreservationDiagnostic[]
  totalDiagnostics: number
  truncated: boolean
  maxDiagnostics: number
}
export interface PreservationOptions {
  maxDiagnostics?: number
  strictPreservation?: boolean
}

export class PreservationError extends Error {
  constructor(readonly report: TablePreservationReport) {
    super(`output degrades ${report.totalDiagnostics} assessed table field(s)`)
    this.name = 'PreservationError'
  }
}

type RecordValue = Record<string, unknown>
const record = (value: unknown): value is RecordValue =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
const populated = (value: unknown): boolean => record(value)
  ? Object.values(value).some(populated)
  : Array.isArray(value) ? value.length > 0 : value !== undefined && value !== null


/** Assess a validated Carve AST JSON tree. This is separate from render losses. */
export function assessTablePreservation(
  ast: unknown,
  target: PreservationTarget,
  options: PreservationOptions = {},
): TablePreservationReport {
  if (!['html', 'markdown', 'plain', 'ansi'].includes(target)) throw new RangeError('unsupported preservation target')
  const maximum = options.maxDiagnostics ?? 100
  if (!Number.isSafeInteger(maximum) || maximum < 0) throw new RangeError('maxDiagnostics must be a non-negative safe integer')
  const diagnostics: PreservationDiagnostic[] = []
  let totalDiagnostics = 0
  const add = (path: string, field: string, message: string): void => {
    totalDiagnostics++
    if (diagnostics.length < maximum) diagnostics.push({ code: 'table-field-degraded', path, field, message })
  }
  const normalized = toAstJson(fromAstJson(ast as AstJsonDocument))
  const stack: [unknown, string][] = [[normalized, '']]
  while (stack.length) {
    const [value, path] = stack.pop()!
    if (Array.isArray(value)) {
      for (let i = value.length - 1; i >= 0; i--) stack.push([value[i], `${path}/${i}`])
      continue
    }
    if (!record(value)) continue
    if (value.type === 'table') {
      const rows = Array.isArray(value.rows) ? value.rows.filter(record) : []
      if (target !== 'html') {
        if (populated(value.caption)) add(path, 'caption', 'Caption text survives, but its table-caption association is flattened.')
        if (populated(value.shortCaption)) add(path, 'shortCaption', 'The short caption is not emitted.')
        const fullHeader = (row: RecordValue): boolean => Array.isArray(row.cells) && row.cells.some(cell => record(cell) && cell.header === true) && row.cells.every(cell => record(cell) && (cell.header === true || cell.span !== undefined))
        let leadingHeaders = 0
        while (leadingHeaders < rows.length && fullHeader(rows[leadingHeaders]!)) leadingHeaders++
        const groups = value.rowGroups
        const bodies = record(groups) && Array.isArray(groups.bodies) ? groups.bodies : []
        const body = bodies[0]
        const implicitGroups = record(groups) && groups.headRows === leadingHeaders && groups.footRows === 0 && bodies.length === 1 && record(body) && body.headRows === 0 && body.bodyRows === rows.length - leadingHeaders && (body.rowHeadColumns === undefined || body.rowHeadColumns === 0) && !populated(body.attrs) && !populated(groups.headAttrs) && !populated(groups.footAttrs)
        if (populated(groups) && !implicitGroups) add(path, 'rowGroups', 'Explicit table head, body, and foot grouping is not preserved.')
        if (populated(value.attrs)) add(path, 'attrs', 'Table attributes are not emitted.')
        if (populated(value.columns)) add(path, 'columns', 'Column metadata is not fully preserved.')
        const aligns: unknown[] = []
        let sawHeader = false
        for (const row of rows) {
          const isHeader = fullHeader(row)
          if (isHeader && !sawHeader) aligns.length = 0
          if (Array.isArray(row.cells)) row.cells.forEach((cell, c) => {
            if (record(cell) && cell.align !== undefined && (isHeader || (!sawHeader && aligns[c] === undefined))) aligns[c] = cell.align
          })
          if (isHeader) sawHeader = true
        }
        const columnAligns: unknown[] = []
        const headerEnd = record(groups) && typeof groups.headRows === 'number' ? groups.headRows : leadingHeaders
        for (const row of rows.slice(0, headerEnd)) {
          if (Array.isArray(row.cells)) row.cells.forEach((cell, c) => {
            if (!record(cell) || cell.span !== undefined || cell.align === undefined) return
            const extent = typeof cell.colspan === 'number' ? cell.colspan : 1
            for (let k = c; k < c + extent; k++) columnAligns[k] = cell.align
          })
        }
        const columns = Array.isArray(value.columns) ? value.columns : []
        let selectedHeader = false
        rows.forEach((row, r) => {
          const rowPath = `${path}/rows/${r}`
          const cells = Array.isArray(row.cells) ? row.cells.filter(record) : []
          const isHeader = fullHeader(row)
          if (populated(row.attrs)) add(rowPath, 'attrs', 'Row attributes are not emitted.')
          const retainsHeader = target === 'markdown' ? isHeader && !selectedHeader
            : target === 'ansi' && cells.every(cell => cell.header === true)
          if (isHeader && target === 'markdown' && !selectedHeader && r > 0) add(rowPath, 'rowOrder', 'The header row moves ahead of preceding data rows.')
          if (isHeader && target === 'markdown') selectedHeader = true
          cells.forEach((cell, c) => {
            if (cell.span !== undefined) return
            const cellPath = `${rowPath}/cells/${c}`
            if (typeof cell.rowspan === 'number' && cell.rowspan > 1) add(cellPath, 'rowspan', 'The merged cell becomes independent rows.')
            if (typeof cell.colspan === 'number' && cell.colspan > 1) add(cellPath, 'colspan', 'The merged cell becomes independent columns.')
            if (cell.header === true && !retainsHeader) add(cellPath, 'header', 'The header-cell role is not preserved in the output format.')
            if (populated(cell.blocks)) add(cellPath, 'blocks', 'Block cell content is flattened into a text cell.')
            if (populated(cell.attrs)) add(cellPath, 'attrs', 'Cell attributes are not emitted.')
            if (cell.valign !== undefined) add(cellPath, 'valign', 'Vertical cell alignment is not emitted.')
            const column = columns[c]
            const effectiveAlign = cell.align ?? columnAligns[c] ?? (record(column) ? column.align : undefined)
            if (target === 'markdown' ? (effectiveAlign ?? 'left') !== (aligns[c] ?? 'left') : effectiveAlign !== undefined && effectiveAlign !== 'left') add(cellPath, 'align', 'Per-cell alignment is not preserved.')
          })
        })
      } else if (populated(value.shortCaption)) {
        add(path, 'shortCaption', 'The short caption is not emitted by the HTML renderer.')
      }
    }
    if (typeof value.type === 'string') {
      for (let i = AST_CHILD_FIELDS.length - 1; i >= 0; i--) {
        const key = AST_CHILD_FIELDS[i]!
        if (key in value) stack.push([value[key], `${path}/${key}`])
      }
    } else {
      // Definition maps and non-node records own nodes too.
      for (const [key, child] of Object.entries(value).reverse()) {
        stack.push([child, `${path}/${key.replace(/~/g, '~0').replace(/\//g, '~1')}`])
      }
    }
  }
  const report: TablePreservationReport = {
    assessment: 'table-structure-v1', target, complete: false,
    checked: ['table spans', 'caption association', 'short captions', 'header roles and row order', 'row groups', 'table/row/cell attributes', 'column metadata', 'block cells', 'horizontal and vertical cell alignment'],
    unchecked: ['non-table semantics', 'assets', 'host behavior', 'final PDF artifacts', 'source spelling', 'extension-generated tables'],
    diagnostics, totalDiagnostics, maxDiagnostics: maximum, truncated: totalDiagnostics > diagnostics.length,
  }
  if (options.strictPreservation && totalDiagnostics > 0) throw new PreservationError(report)
  return report
}
